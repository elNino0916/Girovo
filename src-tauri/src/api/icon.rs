// The asking app's icon for the Girovo API's dialog, as Windows shows it for
// the executable: drawn into 32-bit pixels and written as a small PNG data URL
// the page can put in an <img>. Elsewhere, and for a file without an icon,
// there is none and the page shows its own placeholder.

use std::io::Write;

/// Big enough for the dialog at 200 % without blur.
#[cfg(windows)]
const SIZE: i32 = 48;

pub fn data_url(exe: &str) -> Option<String> {
  let (width, height, rgba) = pixels(exe)?;
  let png = png(width, height, &rgba)?;
  use base64::Engine;
  Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

#[cfg(not(windows))]
fn pixels(_exe: &str) -> Option<(u32, u32, Vec<u8>)> {
  None
}

#[cfg(windows)]
fn pixels(exe: &str) -> Option<(u32, u32, Vec<u8>)> {
  use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDIBits, GetObjectW, HBITMAP,
    HGDIOBJ,
  };
  use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO, PrivateExtractIconsW};

  let path = std::path::Path::new(exe);
  if !path.is_absolute() || !path.is_file() {
    return None;
  }
  // PrivateExtractIconsW takes MAX_PATH characters; a longer path has no icon here.
  let wide: Vec<u16> = exe.encode_utf16().collect();
  if wide.len() >= 260 {
    return None;
  }
  let mut name = [0u16; 260];
  name[..wide.len()].copy_from_slice(&wide);

  unsafe {
    let mut icons = [HICON::default()];
    let found = PrivateExtractIconsW(&name, 0, SIZE, SIZE, Some(&mut icons), None, 0);
    if found == 0 || found == u32::MAX || icons[0].is_invalid() {
      return None;
    }
    let icon = icons[0];
    let mut info = ICONINFO::default();
    let read = GetIconInfo(icon, &mut info);
    let _ = DestroyIcon(icon);
    read.ok()?;
    let color = info.hbmColor;
    let mask = info.hbmMask;
    let release = |b: HBITMAP| {
      if !b.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(b.0));
      }
    };
    // A monochrome icon (no colour bitmap) is too old to be worth drawing.
    if color.is_invalid() {
      release(mask);
      return None;
    }
    let mut bitmap = BITMAP::default();
    let got = GetObjectW(HGDIOBJ(color.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bitmap as *mut BITMAP as *mut _));
    let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);
    if got == 0 || width <= 0 || height <= 0 || width > 256 || height > 256 {
      release(color);
      release(mask);
      return None;
    }
    let dc = CreateCompatibleDC(None);
    let read_bits = |b: HBITMAP| -> Option<Vec<u8>> {
      let mut header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
          biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
          biWidth: width,
          // Negative: rows top to bottom, as PNG has them.
          biHeight: -height,
          biPlanes: 1,
          biBitCount: 32,
          biCompression: BI_RGB.0,
          ..Default::default()
        },
        ..Default::default()
      };
      let mut px = vec![0u8; (width * height * 4) as usize];
      let lines = GetDIBits(dc, b, 0, height as u32, Some(px.as_mut_ptr() as *mut _), &mut header, DIB_RGB_COLORS);
      (lines == height).then_some(px)
    };
    let colors = read_bits(color);
    let masks = if mask.is_invalid() { None } else { read_bits(mask) };
    let _ = DeleteDC(dc);
    release(color);
    release(mask);
    let mut px = colors?;
    // An icon without alpha takes its transparency from the mask (white: see-through).
    let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
    for (i, p) in px.chunks_exact_mut(4).enumerate() {
      p.swap(0, 2);
      if !has_alpha {
        let clear = masks.as_ref().is_some_and(|m| m[i * 4] != 0);
        p[3] = if clear { 0 } else { 255 };
      }
    }
    Some((width as u32, height as u32, px))
  }
}

/// A plain RGBA PNG: no filter, zlib through flate2, CRCs through crc32fast.
pub fn png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
  let row = width as usize * 4;
  if width == 0 || height == 0 || rgba.len() != row * height as usize {
    return None;
  }
  let mut raw = Vec::with_capacity((row + 1) * height as usize);
  for line in rgba.chunks_exact(row) {
    raw.push(0);
    raw.extend_from_slice(line);
  }
  let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
  z.write_all(&raw).ok()?;
  let idat = z.finish().ok()?;

  let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
  let mut ihdr = Vec::with_capacity(13);
  ihdr.extend_from_slice(&width.to_be_bytes());
  ihdr.extend_from_slice(&height.to_be_bytes());
  // 8 bits, RGBA, deflate, no filter method beyond the standard, no interlace.
  ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
  chunk(&mut out, b"IHDR", &ihdr);
  chunk(&mut out, b"IDAT", &idat);
  chunk(&mut out, b"IEND", &[]);
  Some(out)
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
  out.extend_from_slice(&(data.len() as u32).to_be_bytes());
  out.extend_from_slice(kind);
  out.extend_from_slice(data);
  let mut crc = crc32fast::Hasher::new();
  crc.update(kind);
  crc.update(data);
  out.extend_from_slice(&crc.finalize().to_be_bytes());
}
