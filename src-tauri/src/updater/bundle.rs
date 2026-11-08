// A .girovoupdate: one release for Windows in one file, so it installs with no
// connection at all (docs/updater-v2.md, step 5). It is an ordinary ZIP whose
// entries are stored, not compressed — an installer does not shrink — holding
// the release's signed girovo-update.json, its signature and its Setup.exe.
// Any ZIP tool can look inside; what makes it trustworthy is the signature,
// checked against the keys built into the app (engine.rs check_bundle).
//
// A bundle comes from anywhere, so the reader takes nothing on faith: only the
// plain form this writer makes, every offset and size checked against the
// file, and entries looked up by exact name. A path from inside the ZIP is
// never used for anything.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const EXTENSION: &str = "girovoupdate";

const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const END_SIGNATURE: u32 = 0x0605_4b50;
const LOCAL_LEN: usize = 30;
const CENTRAL_LEN: usize = 46;
const END_LEN: usize = 22;
/// A bundle has three entries; a little room, no more.
const MAX_ENTRIES: usize = 8;
const MAX_DIRECTORY_BYTES: u32 = 64 * 1024;
/// Where a plain ZIP ends and Zip64 would begin: a bundle stays below it.
const ZIP64: u32 = u32::MAX;
const STORED: u16 = 0;
/// 1980-01-01, ZIP's first day: the same bundle comes out byte for byte the same.
const DOS_DATE: u16 = (1 << 5) | 1;
const BUFFER_BYTES: usize = 1024 * 1024;

/// Whether `path` is named like a bundle.
pub fn is_bundle(path: &Path) -> bool {
  path.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
}

// ---- writing ----------------------------------------------------------------------

struct Written {
  name: Vec<u8>,
  crc: u32,
  size: u32,
  at: u32,
}

fn too_large() -> io::Error {
  io::Error::new(io::ErrorKind::InvalidInput, "a bundle stays below 4 GB")
}

fn fits(value: u64) -> io::Result<u32> {
  u32::try_from(value).ok().filter(|v| *v < ZIP64).ok_or_else(too_large)
}

fn position(out: &mut File) -> io::Result<u32> {
  fits(out.stream_position()?)
}

/// One stored entry: its header with the size known, the bytes, then the CRC
/// put back in the header, which is only known once they have gone by.
fn add(out: &mut File, name: &str, mut source: impl Read, size: u64) -> io::Result<Written> {
  if name.is_empty() || !name.bytes().all(|b| b.is_ascii_graphic() && b != b'/' && b != b'\\') {
    return Err(io::Error::new(io::ErrorKind::InvalidInput, "a plain file name"));
  }
  let at = position(out)?;
  let size_field = fits(size)?;
  let mut header = Vec::with_capacity(LOCAL_LEN + name.len());
  header.extend_from_slice(&LOCAL_SIGNATURE.to_le_bytes());
  header.extend_from_slice(&10u16.to_le_bytes()); // the version a stored entry needs
  header.extend_from_slice(&0u16.to_le_bytes()); // no flags
  header.extend_from_slice(&STORED.to_le_bytes());
  header.extend_from_slice(&0u16.to_le_bytes()); // time
  header.extend_from_slice(&DOS_DATE.to_le_bytes());
  header.extend_from_slice(&0u32.to_le_bytes()); // the CRC, below
  header.extend_from_slice(&size_field.to_le_bytes());
  header.extend_from_slice(&size_field.to_le_bytes());
  header.extend_from_slice(&(name.len() as u16).to_le_bytes());
  header.extend_from_slice(&0u16.to_le_bytes()); // no extra field
  header.extend_from_slice(name.as_bytes());
  out.write_all(&header)?;

  let mut crc = crc32fast::Hasher::new();
  let mut left = size;
  let mut buffer = vec![0u8; BUFFER_BYTES];
  while left > 0 {
    let want = buffer.len().min(usize::try_from(left).unwrap_or(usize::MAX));
    let got = source.read(&mut buffer[..want])?;
    if got == 0 {
      return Err(io::ErrorKind::UnexpectedEof.into());
    }
    crc.update(&buffer[..got]);
    out.write_all(&buffer[..got])?;
    left -= got as u64;
  }
  let crc = crc.finalize();
  let end = out.stream_position()?;
  out.seek(SeekFrom::Start(u64::from(at) + 14))?;
  out.write_all(&crc.to_le_bytes())?;
  out.seek(SeekFrom::Start(end))?;
  Ok(Written { name: name.as_bytes().to_vec(), crc, size: size_field, at })
}

fn finish(out: &mut File, written: &[Written]) -> io::Result<()> {
  let start = position(out)?;
  let mut directory = Vec::new();
  for w in written {
    directory.extend_from_slice(&CENTRAL_SIGNATURE.to_le_bytes());
    directory.extend_from_slice(&20u16.to_le_bytes()); // made by
    directory.extend_from_slice(&10u16.to_le_bytes()); // needed
    directory.extend_from_slice(&0u16.to_le_bytes()); // flags
    directory.extend_from_slice(&STORED.to_le_bytes());
    directory.extend_from_slice(&0u16.to_le_bytes()); // time
    directory.extend_from_slice(&DOS_DATE.to_le_bytes());
    directory.extend_from_slice(&w.crc.to_le_bytes());
    directory.extend_from_slice(&w.size.to_le_bytes());
    directory.extend_from_slice(&w.size.to_le_bytes());
    directory.extend_from_slice(&(w.name.len() as u16).to_le_bytes());
    directory.extend_from_slice(&[0u8; 12]); // no extra field, no comment, disk 0, no attributes
    directory.extend_from_slice(&w.at.to_le_bytes());
    directory.extend_from_slice(&w.name);
  }
  out.write_all(&directory)?;
  let mut end = Vec::with_capacity(END_LEN);
  end.extend_from_slice(&END_SIGNATURE.to_le_bytes());
  end.extend_from_slice(&[0u8; 4]); // disk 0, the directory on disk 0
  end.extend_from_slice(&(written.len() as u16).to_le_bytes());
  end.extend_from_slice(&(written.len() as u16).to_le_bytes());
  end.extend_from_slice(&fits(directory.len() as u64)?.to_le_bytes());
  end.extend_from_slice(&start.to_le_bytes());
  end.extend_from_slice(&0u16.to_le_bytes()); // no comment
  out.write_all(&end)
}

/// Writes the bundle to `dest`, whole or not at all: beside it first, then
/// renamed into place.
pub fn write(dest: &Path, manifest: &[u8], sig: &[u8], installer: &Path, installer_name: &str) -> io::Result<()> {
  let mut part: PathBuf = dest.to_path_buf().into_os_string().into();
  part.as_mut_os_string().push(".part");
  let written = (|| {
    let mut out = OpenOptions::new().write(true).create(true).truncate(true).open(&part)?;
    let source = File::open(installer)?;
    let size = source.metadata()?.len();
    let entries = [
      add(&mut out, super::trust::MANIFEST_NAME, manifest, manifest.len() as u64)?,
      add(&mut out, super::trust::SIG_NAME, sig, sig.len() as u64)?,
      add(&mut out, installer_name, source, size)?,
    ];
    finish(&mut out, &entries)?;
    out.sync_all()
  })();
  let done = written.and_then(|()| fs::rename(&part, dest));
  if done.is_err() {
    let _ = fs::remove_file(&part);
  }
  done
}

// ---- reading ----------------------------------------------------------------------

/// Not a bundle this reader takes, or a file that could not be read.
#[derive(Debug, PartialEq, Eq)]
pub struct Damaged;

impl From<io::Error> for Damaged {
  fn from(_: io::Error) -> Self {
    Damaged
  }
}

struct Entry {
  name: Vec<u8>,
  size: u64,
  local: u64,
}

pub struct Bundle {
  file: File,
  directory_at: u64,
  entries: Vec<Entry>,
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
  u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
  u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// The end record: where the bytes before EOF hold one that ends exactly at EOF.
fn find_end(tail: &[u8]) -> Option<usize> {
  (0..=tail.len().checked_sub(END_LEN)?)
    .rev()
    .find(|&at| u32_at(tail, at) == END_SIGNATURE && at + END_LEN + usize::from(u16_at(tail, at + 20)) == tail.len())
}

impl Bundle {
  pub fn open(path: &Path) -> Result<Bundle, Damaged> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let reach = len.min((END_LEN + usize::from(u16::MAX)) as u64);
    file.seek(SeekFrom::Start(len - reach))?;
    let mut tail = vec![0u8; reach as usize];
    file.read_exact(&mut tail)?;
    let end = find_end(&tail).ok_or(Damaged)?;
    let record = &tail[end..end + END_LEN];
    let end_at = len - reach + end as u64;
    let (disk, directory_disk, here, count) = (u16_at(record, 4), u16_at(record, 6), u16_at(record, 8), u16_at(record, 10));
    let (directory_len, directory_at) = (u32_at(record, 12), u32_at(record, 16));
    if disk != 0 || directory_disk != 0 || here != count || count == 0 || usize::from(count) > MAX_ENTRIES {
      return Err(Damaged);
    }
    if directory_len > MAX_DIRECTORY_BYTES || directory_at == ZIP64 || u64::from(directory_at) + u64::from(directory_len) > end_at {
      return Err(Damaged);
    }
    file.seek(SeekFrom::Start(u64::from(directory_at)))?;
    let mut directory = vec![0u8; directory_len as usize];
    file.read_exact(&mut directory)?;

    let mut entries: Vec<Entry> = Vec::with_capacity(usize::from(count));
    let mut at = 0usize;
    for _ in 0..count {
      let head = directory.get(at..at + CENTRAL_LEN).ok_or(Damaged)?;
      let (flags, method) = (u16_at(head, 8), u16_at(head, 10));
      let (compressed, size) = (u32_at(head, 20), u32_at(head, 24));
      let (name_len, extra_len, comment_len) = (usize::from(u16_at(head, 28)), usize::from(u16_at(head, 30)), usize::from(u16_at(head, 32)));
      let (start_disk, local) = (u16_at(head, 34), u32_at(head, 42));
      if u32_at(head, 0) != CENTRAL_SIGNATURE || flags != 0 || method != STORED || compressed != size || start_disk != 0 {
        return Err(Damaged);
      }
      if size == ZIP64 || local == ZIP64 || u64::from(local) >= u64::from(directory_at) {
        return Err(Damaged);
      }
      let name = directory.get(at + CENTRAL_LEN..at + CENTRAL_LEN + name_len).ok_or(Damaged)?.to_vec();
      if name.is_empty() || entries.iter().any(|e| e.name == name) {
        return Err(Damaged);
      }
      entries.push(Entry { name, size: u64::from(size), local: u64::from(local) });
      at += CENTRAL_LEN + name_len + extra_len + comment_len;
    }
    if at != directory.len() {
      return Err(Damaged);
    }
    Ok(Bundle { file, directory_at: u64::from(directory_at), entries })
  }

  /// Puts the file at the first byte of `entry`'s data, after checking its local header.
  fn seek_to_data(&mut self, index: usize) -> Result<(), Damaged> {
    let (local, size, name) = {
      let e = &self.entries[index];
      (e.local, e.size, e.name.clone())
    };
    self.file.seek(SeekFrom::Start(local))?;
    let mut head = [0u8; LOCAL_LEN];
    self.file.read_exact(&mut head)?;
    let (name_len, extra_len) = (usize::from(u16_at(&head, 26)), usize::from(u16_at(&head, 28)));
    if u32_at(&head, 0) != LOCAL_SIGNATURE || u16_at(&head, 8) != STORED || name_len != name.len() {
      return Err(Damaged);
    }
    let mut stated = vec![0u8; name_len];
    self.file.read_exact(&mut stated)?;
    let data = local + (LOCAL_LEN + name_len + extra_len) as u64;
    if stated != name || data + size > self.directory_at {
      return Err(Damaged);
    }
    self.file.seek(SeekFrom::Start(data))?;
    Ok(())
  }

  fn find(&self, name: &str) -> Option<usize> {
    self.entries.iter().position(|e| e.name == name.as_bytes())
  }

  /// The entry `name`'s bytes, or None when there is none. Longer than `max`: damaged.
  pub fn small(&mut self, name: &str, max: usize) -> Result<Option<Vec<u8>>, Damaged> {
    let Some(index) = self.find(name) else { return Ok(None) };
    let size = usize::try_from(self.entries[index].size).map_err(|_| Damaged)?;
    if size > max {
      return Err(Damaged);
    }
    self.seek_to_data(index)?;
    let mut bytes = vec![0u8; size];
    self.file.read_exact(&mut bytes)?;
    Ok(Some(bytes))
  }

  /// Copies the entry `name` of exactly `size` bytes to `to`, answering its
  /// SHA-256 in hex; None when there is no such entry. A copy that fails goes.
  pub fn extract(&mut self, name: &str, size: u64, to: &Path) -> Result<Option<String>, Damaged> {
    let Some(index) = self.find(name).filter(|&i| self.entries[i].size == size) else { return Ok(None) };
    self.seek_to_data(index)?;
    let copied = (|| -> io::Result<String> {
      let mut out = OpenOptions::new().write(true).create(true).truncate(true).open(to)?;
      let mut hash = Sha256::new();
      let mut left = size;
      let mut buffer = vec![0u8; BUFFER_BYTES];
      while left > 0 {
        let want = buffer.len().min(usize::try_from(left).unwrap_or(usize::MAX));
        let got = self.file.read(&mut buffer[..want])?;
        if got == 0 {
          return Err(io::ErrorKind::UnexpectedEof.into());
        }
        hash.update(&buffer[..got]);
        out.write_all(&buffer[..got])?;
        left -= got as u64;
      }
      out.sync_all()?;
      Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
    })();
    match copied {
      Ok(digest) => Ok(Some(digest)),
      Err(_) => {
        let _ = fs::remove_file(to);
        Err(Damaged)
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::super::trust::{MANIFEST_NAME, SIG_NAME};
  use super::*;

  struct Dir(PathBuf);

  impl Dir {
    fn new() -> Dir {
      static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
      let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
      let dir = std::env::temp_dir().join(format!("girovo-bundle-test-{}-{n}", std::process::id()));
      fs::create_dir_all(&dir).unwrap();
      Dir(dir)
    }
    fn at(&self, name: &str) -> PathBuf {
      self.0.join(name)
    }
  }

  impl Drop for Dir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  const SETUP: &str = "Girovo-9.9.9-Setup.exe";

  fn installer() -> Vec<u8> {
    (0..3_000_000u32).map(|i| (i % 251) as u8).collect()
  }

  fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
  }

  /// A bundle in `dir`, as bytes to damage.
  fn made(dir: &Dir) -> (PathBuf, Vec<u8>) {
    let exe = dir.at("in.exe");
    fs::write(&exe, installer()).unwrap();
    let path = dir.at("x.girovoupdate");
    write(&path, b"{manifest}", b"{sig}", &exe, SETUP).unwrap();
    let bytes = fs::read(&path).unwrap();
    (path, bytes)
  }

  /// Where the end record and the first central entry of `bytes` are.
  fn layout(bytes: &[u8]) -> (usize, usize) {
    let end = bytes.len() - END_LEN;
    assert_eq!(u32_at(bytes, end), END_SIGNATURE);
    (end, u32_at(bytes, end + 16) as usize)
  }

  fn damaged(dir: &Dir, bytes: &[u8]) -> bool {
    let path = dir.at("damaged.girovoupdate");
    fs::write(&path, bytes).unwrap();
    let opened = Bundle::open(&path).and_then(|mut b| {
      b.small(MANIFEST_NAME, 1024)?;
      b.extract(SETUP, installer().len() as u64, &dir.at("out.exe"))
    });
    opened.is_err()
  }

  #[test]
  fn what_goes_in_comes_out() {
    let dir = Dir::new();
    let (path, _) = made(&dir);
    let mut bundle = Bundle::open(&path).unwrap();
    assert_eq!(bundle.small(MANIFEST_NAME, 1024).unwrap().unwrap(), b"{manifest}");
    assert_eq!(bundle.small(SIG_NAME, 1024).unwrap().unwrap(), b"{sig}");
    let out = dir.at("out.exe");
    assert_eq!(bundle.extract(SETUP, installer().len() as u64, &out).unwrap().unwrap(), sha(&installer()));
    assert_eq!(fs::read(&out).unwrap(), installer());
    assert!(!dir.at("x.girovoupdate.part").exists(), "nothing left beside it");
  }

  #[test]
  fn the_same_input_makes_the_same_bytes() {
    let (a, b) = (Dir::new(), Dir::new());
    assert_eq!(made(&a).1, made(&b).1);
  }

  #[test]
  fn an_entry_of_another_name_or_size_is_not_there() {
    let dir = Dir::new();
    let (path, _) = made(&dir);
    let mut bundle = Bundle::open(&path).unwrap();
    assert_eq!(bundle.small("other.json", 1024), Ok(None));
    let out = dir.at("out.exe");
    assert_eq!(bundle.extract("Other-Setup.exe", 10, &out), Ok(None));
    assert_eq!(bundle.extract(SETUP, 10, &out), Ok(None), "the signed size, or nothing");
    assert!(!out.exists());
  }

  #[test]
  fn a_small_entry_over_its_limit_counts_as_damage() {
    let dir = Dir::new();
    let (path, _) = made(&dir);
    assert_eq!(Bundle::open(&path).unwrap().small(MANIFEST_NAME, 3), Err(Damaged));
  }

  #[test]
  fn whatever_is_not_a_bundle_is_damaged() {
    let dir = Dir::new();
    for bytes in [&b""[..], b"PK", b"not a zip at all", &[0u8; END_LEN]] {
      assert!(damaged(&dir, bytes), "{bytes:?}");
    }
    assert!(Bundle::open(&dir.at("missing.girovoupdate")).is_err());
  }

  #[test]
  fn a_cut_off_bundle_is_damaged() {
    let dir = Dir::new();
    let (_, bytes) = made(&dir);
    for keep in [bytes.len() - 1, bytes.len() - END_LEN, bytes.len() / 2, 40] {
      assert!(damaged(&dir, &bytes[..keep]), "{keep} bytes");
    }
  }

  #[test]
  fn only_the_plain_form_is_taken() {
    let dir = Dir::new();
    let (_, bytes) = made(&dir);
    let (end, central) = layout(&bytes);
    // (offset, bytes put there, what it stands for)
    let edits: Vec<(usize, Vec<u8>, &str)> = vec![
      (central + 8, 1u16.to_le_bytes().to_vec(), "encrypted"),
      (central + 10, 8u16.to_le_bytes().to_vec(), "deflated"),
      (central + 20, 99u32.to_le_bytes().to_vec(), "compressed size unlike its size"),
      (central + 20, u32::MAX.to_le_bytes().to_vec(), "Zip64 size"),
      (central + 42, u32::MAX.to_le_bytes().to_vec(), "Zip64 offset"),
      (central + 42, (bytes.len() as u32).to_le_bytes().to_vec(), "an offset past the file"),
      (central + 34, 1u16.to_le_bytes().to_vec(), "on another disk"),
      (central, [0u8; 4].to_vec(), "no central entry"),
      (end + 8, 2u16.to_le_bytes().to_vec(), "entries unlike the total"),
      (end + 8, 500u16.to_le_bytes().to_vec(), "too many entries"),
      (end + 10, 500u16.to_le_bytes().to_vec(), "too many entries"),
      (end + 12, u32::MAX.to_le_bytes().to_vec(), "a directory past the end"),
      (end + 16, u32::MAX.to_le_bytes().to_vec(), "a Zip64 directory"),
      (0, [0u8; 4].to_vec(), "no local header"),
    ];
    for (at, patch, what) in edits {
      let mut bad = bytes.clone();
      bad[at..at + patch.len()].copy_from_slice(&patch);
      assert!(damaged(&dir, &bad), "{what}");
    }
  }

  #[test]
  fn a_name_twice_is_damage() {
    let dir = Dir::new();
    let path = dir.at("twice.girovoupdate");
    let mut out = OpenOptions::new().write(true).create(true).truncate(true).open(&path).unwrap();
    let entries = [add(&mut out, SIG_NAME, &b"a"[..], 1).unwrap(), add(&mut out, SIG_NAME, &b"b"[..], 1).unwrap()];
    finish(&mut out, &entries).unwrap();
    drop(out);
    assert_eq!(Bundle::open(&path).err(), Some(Damaged));
  }

  #[test]
  fn data_running_into_the_directory_is_damage() {
    let dir = Dir::new();
    let (path, mut bytes) = made(&dir);
    let (end, mut central) = layout(&bytes);
    let directory_at = u32_at(&bytes, end + 16);
    // The installer's central entry and local header, stating a size that runs past the data.
    central += CENTRAL_LEN + MANIFEST_NAME.len();
    central += CENTRAL_LEN + SIG_NAME.len();
    let huge = (directory_at).to_le_bytes();
    bytes[central + 20..central + 24].copy_from_slice(&huge);
    bytes[central + 24..central + 28].copy_from_slice(&huge);
    fs::write(&path, &bytes).unwrap();
    let mut bundle = Bundle::open(&path).unwrap();
    assert_eq!(bundle.extract(SETUP, u64::from(directory_at), &dir.at("out.exe")), Err(Damaged));
  }

  #[test]
  fn only_plain_names_go_in() {
    let dir = Dir::new();
    let exe = dir.at("in.exe");
    fs::write(&exe, b"x").unwrap();
    for name in ["", "a/b.exe", "..\\b.exe", "ä.exe"] {
      assert!(write(&dir.at("x.girovoupdate"), b"m", b"s", &exe, name).is_err(), "{name}");
    }
    assert!(!dir.at("x.girovoupdate").exists());
    assert!(!dir.at("x.girovoupdate.part").exists());
  }

  #[test]
  fn writing_over_an_earlier_bundle_replaces_it() {
    let dir = Dir::new();
    let path = dir.at("x.girovoupdate");
    fs::write(&path, b"earlier").unwrap();
    let exe = dir.at("in.exe");
    fs::write(&exe, b"new").unwrap();
    write(&path, b"m", b"s", &exe, SETUP).unwrap();
    assert_eq!(Bundle::open(&path).unwrap().small(MANIFEST_NAME, 16).unwrap().unwrap(), b"m");
  }

  #[test]
  fn a_bundle_is_known_by_its_ending() {
    assert!(is_bundle(Path::new("C:\\Downloads\\Girovo-6.0.4.girovoupdate")));
    assert!(is_bundle(Path::new("Girovo.GirovoUpdate")));
    assert!(!is_bundle(Path::new("Girovo-6.0.4-Setup.exe")));
    assert!(!is_bundle(Path::new("girovoupdate")));
  }
}
