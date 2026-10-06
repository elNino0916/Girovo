// What a user can put on their profile chip instead of their initials
// (components/shell/ProfileMenu.tsx): one of the line icons, or a picture of
// their own. Kept in the vault (lib/vault.ts), so it belongs to one bank login
// on this machine, like the account names — and, encrypted with them, never
// leaves it.
//
// Pure and dependency-free, like lib/categories.ts: shared by the browser and
// by the vault's sanitiser on the server, which drops anything not described
// here.

export const AVATAR_IDS = [
  'piggy', 'cat', 'leaf', 'flower', 'mountain', 'wave', 'coffee', 'music', 'rocket', 'anchor', 'star',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

/** The user's own picture, kept beside the choice as `avatarImage`. */
export const OWN_PICTURE = 'own';

/** What the chip shows: a line icon, or the user's own picture. */
export type AvatarChoice = AvatarId | typeof OWN_PICTURE;

export const isAvatarId = (v: unknown): v is AvatarId =>
  typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);

export const isAvatarChoice = (v: unknown): v is AvatarChoice => v === OWN_PICTURE || isAvatarId(v);

/** The side of a picture as it is kept: twice the panel's 44px avatar, and some. */
export const AVATAR_IMAGE_SIDE = 128;

/**
 * The longest picture the vault keeps, in characters of its data URL. A
 * 128px WebP takes about 10 000; the cap leaves room for a busy photo without
 * letting a picture crowd out the rest of the vault (512 KB in all).
 */
export const AVATAR_IMAGE_MAX = 64 * 1024;

/** A picture as the vault keeps it: a small WebP, JPEG or PNG as a base64 data URL — nothing else. */
export const isAvatarImage = (v: unknown): v is string =>
  typeof v === 'string'
  && v.length <= AVATAR_IMAGE_MAX
  && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);
