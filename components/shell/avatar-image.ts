// A picture from the user's disk, made into what the profile chip shows: the
// middle square of it, AVATAR_IMAGE_SIDE pixels, as a small WebP data URL
// (JPEG where the browser cannot write WebP). Done in the page, so the file
// itself never goes anywhere: only the small square reaches the vault, and
// the vault keeps it encrypted (lib/vault.ts).

import { AVATAR_IMAGE_MAX, AVATAR_IMAGE_SIDE, isAvatarImage } from '@/lib/avatars';

/** Why a file could not become a picture: not an image the browser can open, or still too big after shrinking. */
export class AvatarImageError extends Error {
  constructor(readonly reason: 'unreadable' | 'too-large') {
    super(reason);
    this.name = 'AvatarImageError';
  }
}

/** The square to show for `file`, as a data URL the vault accepts (isAvatarImage). */
export async function avatarFromFile(file: Blob): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new AvatarImageError('unreadable');
  let bitmap: ImageBitmap;
  try {
    // Turned the way the camera meant it (EXIF), like every other viewer.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new AvatarImageError('unreadable');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) throw new AvatarImageError('unreadable');
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_IMAGE_SIDE;
    canvas.height = AVATAR_IMAGE_SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AvatarImageError('unreadable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The middle square: a portrait keeps the face, a landscape its centre.
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, AVATAR_IMAGE_SIDE, AVATAR_IMAGE_SIDE,
    );
    let url = canvas.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.88);
    if (url.length > AVATAR_IMAGE_MAX) throw new AvatarImageError('too-large');
    if (!isAvatarImage(url)) throw new AvatarImageError('unreadable');
    return url;
  } finally {
    bitmap.close();
  }
}
