// Bank brand marks — abstract chips in each group's brand color, used wherever
// a real logo file isn't present under public/logos.

export type BrandMark = {
  bg: string;
  mark: string;
  /** Foreground for the monogram; defaults to white. */
  fg?: string;
  /** Optional accent bar along the bottom edge. */
  accent?: string;
};

export const BRANDS: Record<string, BrandMark> = {
  sparkasse: { bg: '#e8412c', mark: 'S' },
  vrbank: { bg: '#0a4a8a', mark: 'VR', accent: '#f60' },
  deutschebank: { bg: '#0018a8', mark: 'slash' },
  commerzbank: { bg: '#ffcc33', mark: 'C', fg: '#1a1a1a' },
  postbank: { bg: '#ffcc00', mark: 'P', fg: '#0066b3' },
  ing: { bg: '#ff6200', mark: 'i' },
  dkb: { bg: '#1482c8', mark: 'DKB' },
  comdirect: { bg: '#fff04b', mark: 'c', fg: '#00376c' },
  hypovereinsbank: { bg: '#e20015', mark: 'HV' },
  targobank: { bg: '#00549f', mark: 'T' },
  norisbank: { bg: '#d51130', mark: 'n' },
  consorsbank: { bg: '#002e5c', mark: 'C', accent: '#21e6c1' },
  sparda: { bg: '#e3001b', mark: 'S' },
  psd: { bg: '#00589c', mark: 'PSD' },
  apobank: { bg: '#003366', mark: 'a' },
  gls: { bg: '#7ab41d', mark: 'GLS', fg: '#173d0a' },
  triodos: { bg: '#008996', mark: 't' },
  ethikbank: { bg: '#5a8f22', mark: 'e' },
  oldenburgische: { bg: '#0f2d5a', mark: 'OLB' },
  degussa: { bg: '#1c3f94', mark: 'D' },
  santander: { bg: '#ec0000', mark: 'S' },
  generic: { bg: '#4c5f57', mark: '€' },
};

// Marks that are too dark to sit on the dark theme directly (navy/black
// wordmarks, measured per file) get an invert+hue-rotate in dark mode.
// Colorful marks (Sparkasse red, comdirect yellow, DKB blue, …) render as-is.
// Deutsche Bank's deep blue square sits at well under 3:1 on the navy-black
// surfaces and all but vanishes, so it is flipped too.
export const DARK_INVERT = new Set([
  'vrbank', 'ing', 'gls', 'apobank', 'psd', 'norisbank',
  'commerzbank', 'hypovereinsbank', 'degussa', 'targobank', 'deutschebank',
]);

// Logo files drawn for a dark ground: comdirect's yellow wordmark all but
// disappears on white. In light mode they are set in one dark colour, the way
// a brand prints its single-colour logo (globals.css) — not on a plate of the
// masthead's navy, which is the app's own identity. On the dark theme they
// show as drawn.
export const ON_DARK = new Set(['comdirect']);

/**
 * The app a brand's customers approve in, where one name holds for the whole
 * brand — the login form names it as an example ("z. B. S-pushTAN") before
 * the PIN is typed. Brands whose banks differ, or whose app is not known for
 * certain, are left out on purpose: the form then just says "Banking-App".
 */
export const APPROVAL_APP: Record<string, string> = {
  sparkasse: 'S-pushTAN',
  vrbank: 'SecureGo plus',
  gls: 'SecureGo plus',
  ing: 'Banking to go',
  dkb: 'DKB-App',
  postbank: 'BestSign',
  commerzbank: 'photoTAN',
  comdirect: 'photoTAN',
  deutschebank: 'photoTAN',
  norisbank: 'photoTAN',
  consorsbank: 'SecurePlus',
};
