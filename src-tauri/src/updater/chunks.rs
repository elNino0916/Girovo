// The chunks a differential update is made of (docs/tauri-updater.md).
//
// Electron's updates downloaded only what changed in the Setup.exe:
// electron-builder wrote a blockmap beside it, and each install kept a copy
// of its own installer (update-base.bin, 355 MB) to compare with. Tauri's
// bundler writes no blockmap, and its installer is one solid LZMA stream —
// a change in the app at its front changes every compressed byte after it.
//
// So the Tauri build ships its installer uncompressed (NSIS compression
// "none": the model, which is most of it, barely shrinks anyway) and CI
// writes the blockmap itself with scripts/blockmap.mjs. In an uncompressed
// installer every file sits as it is, so the chunks of the files already
// installed — the 283 MB model, most of Girovo.exe — reappear in the next
// release's installer. This side cuts those installed files with the very
// same content-defined chunker and checksum, and the update fetches only the
// chunks it does not find on disk. No copy of the old installer is kept.
//
// The chunker: a gear hash over the last 32 bytes, a boundary where its top
// 15 bits are zero, chunks of 8 KiB to 128 KiB (about 40 KiB on average) —
// so a boundary depends on the bytes around it alone, and an insertion moves
// the boundaries after it along with the content instead of changing every
// chunk. The checksum: the first 16 bytes of the chunk's SHA-256, base64.
// scripts/blockmap.mjs is the same code in JavaScript; the shared test vector
// below keeps the two in step.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use sha2::{Digest, Sha256};

use super::logic::Chunk;

/// The blockmap's mark that its chunks are this chunker's — electron-builder's
/// (5.x releases, the way back) are cut otherwise and never match.
pub const CHUNKER: &str = "girovo-cdc-1";

const MIN_CHUNK: usize = 8 * 1024;
const MAX_CHUNK: usize = 128 * 1024;
const BOUNDARY_MASK: u32 = 0xFFFE_0000;

/// 256 pseudo-random words, one per byte value: a splitmix-style counter
/// through murmur3's finaliser, so scripts/blockmap.mjs makes the same table
/// without carrying it.
const GEAR: [u32; 256] = {
  let mut table = [0u32; 256];
  let mut state: u32 = 0;
  let mut i = 0;
  while i < 256 {
    state = state.wrapping_add(0x9E37_79B9);
    let mut z = state;
    z = (z ^ (z >> 16)).wrapping_mul(0x85EB_CA6B);
    z = (z ^ (z >> 13)).wrapping_mul(0xC2B2_AE35);
    z ^= z >> 16;
    table[i] = z;
    i += 1;
  }
  table
};

/// A chunk's checksum: the first 16 bytes of its SHA-256, base64 (24 characters).
pub fn checksum(bytes: &[u8]) -> String {
  B64.encode(&Sha256::digest(bytes)[..16])
}

/// Cuts what `reader` yields into chunks, calling `each(offset, bytes)` for
/// every one in order; answers the total length.
pub fn cut(mut reader: impl Read, mut each: impl FnMut(u64, &[u8])) -> io::Result<u64> {
  let mut block = vec![0u8; 1024 * 1024];
  // The current chunk's bytes from earlier blocks.
  let mut carry: Vec<u8> = Vec::with_capacity(MAX_CHUNK);
  let mut hash: u32 = 0;
  let mut offset: u64 = 0;
  loop {
    let n = match reader.read(&mut block) {
      Ok(0) => break,
      Ok(n) => n,
      Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
      Err(e) => return Err(e),
    };
    let mut start = 0;
    for i in 0..n {
      hash = (hash << 1).wrapping_add(GEAR[block[i] as usize]);
      let len = carry.len() + (i + 1 - start);
      if len >= MAX_CHUNK || (len >= MIN_CHUNK && hash & BOUNDARY_MASK == 0) {
        if carry.is_empty() {
          each(offset, &block[start..=i]);
        } else {
          carry.extend_from_slice(&block[start..=i]);
          each(offset, &carry);
          carry.clear();
        }
        offset += len as u64;
        start = i + 1;
        hash = 0;
      }
    }
    carry.extend_from_slice(&block[start..n]);
  }
  if !carry.is_empty() {
    each(offset, &carry);
    offset += carry.len() as u64;
  }
  Ok(offset)
}

/// The chunks of `bytes`, as a blockmap lists them (file 0).
#[cfg(test)]
pub fn chunks_of(bytes: &[u8]) -> Vec<Chunk> {
  let mut list = Vec::new();
  cut(bytes, |offset, chunk| {
    list.push(Chunk { checksum: checksum(chunk), size: chunk.len() as u64, offset, src: 0 })
  })
  .expect("reading from memory cannot fail");
  list
}

/// The blockmap of `bytes` as scripts/blockmap.mjs writes it, before gzip.
#[cfg(test)]
pub fn blockmap_json(bytes: &[u8]) -> serde_json::Value {
  let chunks = chunks_of(bytes);
  serde_json::json!({
    "version": "2",
    "chunker": CHUNKER,
    "files": [{
      "name": "file",
      "offset": 0,
      "checksums": chunks.iter().map(|c| c.checksum.clone()).collect::<Vec<_>>(),
      "sizes": chunks.iter().map(|c| c.size).collect::<Vec<_>>(),
    }],
  })
}

/// What the installed copy is made of: its files, and the chunks of each
/// (Chunk::src indexes `files`).
pub struct Local {
  pub files: Vec<PathBuf>,
  pub chunks: Vec<Chunk>,
}

// The installed app is Girovo.exe, the model and a few small files; a folder
// far past that is not an install of it, and is not read through.
const MAX_LOCAL_FILES: usize = 10_000;
const MAX_LOCAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// The chunks of every file under `dir` (the install folder), symbolic links
/// left alone. Unreadable files are skipped: whatever is missing is fetched.
pub fn index_local(dir: &Path) -> Local {
  let mut files = Vec::new();
  let mut chunks = Vec::new();
  let mut bytes = 0u64;
  let mut pending = vec![dir.to_path_buf()];
  while let Some(folder) = pending.pop() {
    let Ok(entries) = std::fs::read_dir(&folder) else { continue };
    for entry in entries.flatten() {
      let Ok(kind) = entry.file_type() else { continue };
      let path = entry.path();
      if kind.is_dir() {
        pending.push(path);
        continue;
      }
      if !kind.is_file() || files.len() >= MAX_LOCAL_FILES {
        continue;
      }
      let Ok(meta) = entry.metadata() else { continue };
      if meta.len() == 0 || bytes + meta.len() > MAX_LOCAL_BYTES {
        continue;
      }
      let Ok(file) = File::open(&path) else { continue };
      let src = files.len();
      let before = chunks.len();
      let read = cut(io::BufReader::new(file), |offset, chunk| {
        chunks.push(Chunk { checksum: checksum(chunk), size: chunk.len() as u64, offset, src })
      });
      match read {
        Ok(len) => {
          bytes += len;
          files.push(path);
        }
        Err(_) => chunks.truncate(before),
      }
    }
  }
  Local { files, chunks }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The shared test vector: 1 MiB from xorshift32 seeded with 1, the low byte
  /// of each step. scripts/blockmap.test.mjs asserts the same numbers.
  fn vector() -> Vec<u8> {
    let mut x: u32 = 1;
    (0..1024 * 1024)
      .map(|_| {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        x as u8
      })
      .collect()
  }

  #[test]
  fn the_shared_vector_is_cut_as_scripts_blockmap_mjs_cuts_it() {
    let chunks = chunks_of(&vector());
    let sizes: Vec<u64> = chunks.iter().map(|c| c.size).collect();
    assert_eq!(GEAR[0], 0x92CA_2F0E);
    assert_eq!(GEAR[255], 0x7970_D887);
    assert_eq!(sizes.len(), 29);
    // The first one runs into the 128 KiB limit: the limit is cut alike too.
    assert_eq!(&sizes[..6], [131_072, 28_540, 45_961, 28_067, 20_896, 54_232]);
    assert_eq!(chunks[0].checksum, "nQPCcseVfAyLOTNuui64Eg==");
    assert_eq!(chunks.last().unwrap().checksum, "fGSH0WSt01dpsxq7j9/Ytw==");
    assert_eq!(sizes.iter().sum::<u64>(), 1024 * 1024);
  }

  #[test]
  fn chunks_stay_within_their_limits_and_cover_the_file() {
    let data = vector();
    let chunks = chunks_of(&data);
    let mut at = 0;
    for (i, c) in chunks.iter().enumerate() {
      assert_eq!(c.offset, at);
      assert!(c.size as usize <= MAX_CHUNK);
      assert!(c.size as usize >= MIN_CHUNK || i == chunks.len() - 1);
      at += c.size;
    }
    assert_eq!(at, data.len() as u64);
    // Small reads cut exactly as one big one.
    struct Trickle<'a>(&'a [u8]);
    impl Read for Trickle<'_> {
      fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.0.len().min(buf.len()).min(777);
        buf[..n].copy_from_slice(&self.0[..n]);
        self.0 = &self.0[n..];
        Ok(n)
      }
    }
    let mut trickled = Vec::new();
    cut(Trickle(&data), |offset, bytes| trickled.push((offset, checksum(bytes)))).unwrap();
    assert_eq!(trickled, chunks.iter().map(|c| (c.offset, c.checksum.clone())).collect::<Vec<_>>());
  }

  #[test]
  fn an_insertion_changes_only_the_chunks_around_it() {
    let data = vector();
    let mut changed = data[..300_000].to_vec();
    changed.extend_from_slice(b"a few bytes that were not there before");
    changed.extend_from_slice(&data[300_000..]);
    let before = chunks_of(&data);
    let after = chunks_of(&changed);
    let known: std::collections::HashSet<_> = before.iter().map(|c| c.checksum.clone()).collect();
    let new = after.iter().filter(|c| !known.contains(&c.checksum)).count();
    assert!(new <= 2, "{new} chunks changed");
  }

  #[test]
  fn a_file_cut_on_its_own_finds_its_chunks_inside_a_bigger_one() {
    // The installed model alone, and the same bytes inside the next installer.
    let model = vector();
    let mut installer = vec![7u8; 50_000];
    installer.extend_from_slice(&model);
    installer.extend_from_slice(&[9u8; 20_000]);
    let inside: std::collections::HashSet<_> = chunks_of(&installer).into_iter().map(|c| c.checksum).collect();
    let alone = chunks_of(&model);
    let found: u64 = alone.iter().filter(|c| inside.contains(&c.checksum)).map(|c| c.size).sum();
    // All but the chunks at either end, where the bytes around differ — a
    // few hundred KiB at most, however large the file.
    let lost = model.len() as u64 - found;
    assert!(lost <= 3 * MAX_CHUNK as u64, "{found} of {} bytes found", model.len());
  }

  #[test]
  fn index_local_reads_every_file_of_the_install() {
    let dir = std::env::temp_dir().join(format!("girovo-chunks-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("models")).unwrap();
    std::fs::write(dir.join("Girovo.exe"), &vector()[..200_000]).unwrap();
    std::fs::write(dir.join("models").join("model.onnx"), &vector()[500_000..]).unwrap();
    std::fs::write(dir.join("empty.txt"), b"").unwrap();
    let local = index_local(&dir);
    assert_eq!(local.files.len(), 2, "the empty file is left out");
    for (src, file) in local.files.iter().enumerate() {
      let len = std::fs::metadata(file).unwrap().len();
      let sum: u64 = local.chunks.iter().filter(|c| c.src == src).map(|c| c.size).sum();
      assert_eq!(sum, len);
    }
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
