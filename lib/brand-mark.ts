// The Girovo mark, "G€": a G whose left side carries the euro sign's two
// bars. One geometry for every place the mark appears — the masthead plate
// (components/shell/BrandMark.tsx), the favicon (app/layout.tsx), the app
// icon and the installer images (scripts/build-brand-assets.mjs) and the
// update window (build/update-window/UpdateWindow.cs, which repeats these
// numbers in WPF path syntax).
//
// Drawn on a 512 grid inside a rounded plate. All strokes are round-capped;
// the G is a 136-radius arc around (274, 256), open to the upper right, whose
// lower end turns inward as the G's bar. The euro bars cross its left side
// and stand out past it, as on a "€".

export const MARK_GRID = 512;
/** Corner radius of the plate on the 512 grid (the app icon's squircle-ish corner). */
export const MARK_PLATE_RADIUS = 112;

/** The G: the arc and the bar its lower end turns into. */
export const MARK_ARC = 'M361.4 151.8A136 136 0 1 0 405.1 292H280';
export const MARK_ARC_WIDTH = 46;
/** The euro sign's two bars. */
export const MARK_BARS = 'M100 222H244M100 292H208';
export const MARK_BAR_WIDTH = 40;

/** The mark as a standalone SVG document: `ink` on a `plate`-coloured rounded square. */
export function markSvg({ plate, ink, size }: { plate: string; ink: string; size?: number }): string {
  const dims = size ? ` width="${size}" height="${size}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_GRID} ${MARK_GRID}"${dims}>` +
    `<rect width="${MARK_GRID}" height="${MARK_GRID}" rx="${MARK_PLATE_RADIUS}" fill="${plate}"/>` +
    `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${MARK_ARC}" stroke-width="${MARK_ARC_WIDTH}"/>` +
    `<path d="${MARK_BARS}" stroke-width="${MARK_BAR_WIDTH}"/>` +
    `</g></svg>`
  );
}
