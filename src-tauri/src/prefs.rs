// The page's preferences (theme, "Beträge ausblenden", the idle limit, the
// bank chosen last, the shell's own switches): prefs.json in the data folder,
// the very file and format the Electron shell kept (its main.cjs).
//
// The page reads them synchronously — layout.tsx's pre-paint script needs the
// theme before the first frame — and Tauri's IPC is asynchronous, so the whole
// map goes into the window's initialization script (shell::boot_script), and
// the bridge's set/del come back here to be written.
//
// Deliberately narrow, as before: `fints.*` keys, short string values, a
// bounded count. Preferences, not data.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

use crate::paths::data_root;

const VALUE_MAX: usize = 4096;
const MAX_KEYS: usize = 200;

pub struct Prefs(Mutex<BTreeMap<String, String>>);

/// `fints.` and 1–80 of [A-Za-z0-9_.-]: PREF_KEY in the Electron shell's preload.cjs.
pub fn valid_key(key: &str) -> bool {
  let Some(rest) = key.strip_prefix("fints.") else { return false };
  !rest.is_empty() && rest.len() <= 80 && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

impl Prefs {
  pub fn load() -> Self {
    let mut map = BTreeMap::new();
    if let Ok(text) = fs::read_to_string(data_root().join("prefs.json")) {
      if let Ok(serde_json::Value::Object(raw)) = serde_json::from_str::<serde_json::Value>(&text) {
        for (key, value) in raw {
          if map.len() >= MAX_KEYS {
            break;
          }
          if let serde_json::Value::String(v) = value {
            if valid_key(&key) && v.len() <= VALUE_MAX {
              map.insert(key, v);
            }
          }
        }
      }
    }
    Prefs(Mutex::new(map))
  }

  pub fn snapshot(&self) -> BTreeMap<String, String> {
    self.0.lock().unwrap().clone()
  }

  pub fn get(&self, key: &str) -> Option<String> {
    self.0.lock().unwrap().get(key).cloned()
  }

  /// Everything at once ("Girovo zurücksetzen", reset.rs): only `keep` stays,
  /// in memory as on disk. Answers whether it is on disk.
  pub fn replace(&self, keep: &[(&str, &str)]) -> bool {
    let mut map = self.0.lock().unwrap();
    map.clear();
    for (key, value) in keep {
      map.insert(key.to_string(), value.to_string());
    }
    write(&map)
  }

  /// Sets or (None) deletes a key; answers whether it is on disk.
  pub fn set(&self, key: &str, value: Option<&str>) -> bool {
    if !valid_key(key) {
      return false;
    }
    let mut map = self.0.lock().unwrap();
    match value {
      Some(v) => {
        if v.len() > VALUE_MAX {
          return false;
        }
        if map.get(key).map(String::as_str) == Some(v) {
          return true;
        }
        if !map.contains_key(key) && map.len() >= MAX_KEYS {
          return false;
        }
        map.insert(key.to_string(), v.to_string());
      }
      None => {
        if map.remove(key).is_none() {
          return true;
        }
      }
    }
    write(&map)
  }
}

/// A temp file renamed over prefs.json, so a crash leaves the old file, never
/// half a new one; Windows refuses the rename while a scanner holds the
/// target, so a few short retries.
fn write(map: &BTreeMap<String, String>) -> bool {
  let file = data_root().join("prefs.json");
  let tmp = data_root().join(format!("prefs.json.{}.tmp", std::process::id()));
  let text = match serde_json::to_string_pretty(map) {
    Ok(t) => t,
    Err(_) => return false,
  };
  let written = (|| -> std::io::Result<()> {
    let mut f = fs::File::create(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()
  })();
  if written.is_err() {
    let _ = fs::remove_file(&tmp);
    return false;
  }
  for attempt in 0..4 {
    match fs::rename(&tmp, &file) {
      Ok(()) => return true,
      Err(_) if attempt < 3 => std::thread::sleep(Duration::from_millis(20 * (attempt + 1))),
      Err(_) => break,
    }
  }
  let _ = fs::remove_file(&tmp);
  false
}

#[cfg(test)]
mod tests {
  use super::valid_key;

  #[test]
  fn keys_are_narrow() {
    assert!(valid_key("fints.theme"));
    assert!(valid_key("fints.userId.12030000"));
    assert!(!valid_key("fints."));
    assert!(!valid_key("theme"));
    assert!(!valid_key("fints.a b"));
    assert!(!valid_key(&format!("fints.{}", "a".repeat(81))));
  }
}
