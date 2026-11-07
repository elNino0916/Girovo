// A Girovo that quit but never finished, and how this one avoids becoming one.
//
// Seen on the owner's PC (2026-11-06): a copy that had quit kept running with
// one thread left — Windows had begun ending it and was running the
// libraries' exit code, and that waited on the copy's own WebView2 browser
// process, which never answered. Its window already hidden by Tauri's
// cleanup, nothing showed. The next start then attached its page to that
// browser process (WebView2 shares one per data folder) and froze with it.
// The stuck copy only went once its browser process was ended.
//
// So the app ends itself once Tauri's cleanup is done (end_process), without
// the libraries' exit code: everything worth keeping is written by then —
// the files and preferences as they change, telemetry at RunEvent::Exit, the
// installer started by the updater's own exit hook. And a start that finds a
// copy of itself still there (end_stuck_copies) ends it first: a copy that
// were still alive would have taken this start over (the single-instance
// plugin), so any that is left can only be one stuck on its way out.

/// Ends this process with `code`. On Windows directly (TerminateProcess), past
/// the DLLs' exit code that a quitting copy once waited on for good.
pub fn end_process(code: i32) -> ! {
  // A file being written is finished first (files.rs): never cut in half.
  crate::files::settle(std::time::Duration::from_secs(2));
  #[cfg(windows)]
  unsafe {
    use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
    let _ = TerminateProcess(GetCurrentProcess(), code as u32);
  }
  std::process::exit(code)
}

/// Ends any other process of this very exe, and the WebView2 browser processes
/// it started, before this one creates a window. Answers how many it found.
/// Never for a test run (GIROVO_DATA_DIR), which skips the single-instance
/// check and may run beside the installed app.
#[cfg(windows)]
pub fn end_stuck_copies() -> usize {
  use windows::Win32::Foundation::{CloseHandle, HANDLE};
  use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
  use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, QueryFullProcessImageNameW,
    TerminateProcess, WaitForSingleObject,
  };
  use windows::core::PWSTR;

  // A debug build can be made to look anyway (GIROVO_TEST_LEFTOVER=1), to try
  // this with two test copies of its own.
  let test_run = std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty());
  let forced = cfg!(debug_assertions) && std::env::var("GIROVO_TEST_LEFTOVER").as_deref() == Ok("1");
  if test_run && !forced {
    return 0;
  }
  let Ok(me) = std::env::current_exe() else { return 0 };
  let my_name = me.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
  let my_path = me.to_string_lossy().to_string();
  let my_pid = std::process::id();

  // Every process: its id, its parent's, its exe's file name.
  let mut all: Vec<(u32, u32, String)> = Vec::new();
  unsafe {
    let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return 0 };
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
    while more {
      let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
      all.push((entry.th32ProcessID, entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase()));
      more = Process32NextW(snapshot, &mut entry).is_ok();
    }
    let _ = CloseHandle(snapshot);
  }

  let path_of = |process: HANDLE| unsafe {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
      .ok()
      .map(|_| String::from_utf16_lossy(&buf[..len as usize]))
  };
  let end = |pid: u32| unsafe {
    if let Ok(process) = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) {
      let _ = TerminateProcess(process, 1);
      let _ = WaitForSingleObject(process, 3000);
      let _ = CloseHandle(process);
    }
  };

  let mut found = 0;
  for (pid, _, _) in all.iter().filter(|(pid, _, name)| *pid != my_pid && *name == my_name) {
    // Another exe of the same name (a development build, another install) is
    // left alone. A copy too far into its exit to say its path is ours: the
    // installed exe's name, a process that cannot even be asked any more.
    let ours = unsafe {
      match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, *pid) {
        Ok(process) => {
          let same = path_of(process).is_none_or(|p| p.eq_ignore_ascii_case(&my_path));
          let _ = CloseHandle(process);
          same
        }
        Err(_) => true,
      }
    };
    if !ours {
      continue;
    }
    found += 1;
    // Its WebView2 browser first: what the stuck copy waits on, and what this
    // start's page would attach to. Its renderers and helpers go with it.
    for (child, _, _) in all.iter().filter(|(_, parent, n)| parent == pid && n == "msedgewebview2.exe") {
      end(*child);
    }
    end(*pid);
  }
  found
}

#[cfg(not(windows))]
pub fn end_stuck_copies() -> usize {
  0
}
