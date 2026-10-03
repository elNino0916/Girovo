// Where a menu or a popover opens, given the control that opened it.
//
// Kept apart from the DOM so the arithmetic can be tested on its own: the
// hook in components/ui.tsx measures the trigger, the layer and the window,
// and this decides.
//
// Below the trigger by default, flipped above when there is more room there,
// clamped `margin` px from every edge of the window, and scrolling inside
// whatever height that leaves. In the desktop shell one more thing is in the
// way: the OS draws its caption buttons (minimise, maximise, close) over the
// window's top-right corner, on top of everything the page paints, and they
// take every click there. A layer that would reach into that corner — a long
// menu flipped up from the foot of a drawer — stops below the buttons instead
// of sliding under them, so a press on its first row can never minimise or
// close the window.

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export type AnchorInput = {
  /** The trigger's client rect. */
  anchor: { top: number; bottom: number; left: number; right: number };
  /** The layer's width, and the height of its whole content (unscrolled). */
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  placement: Placement;
  /** Between the trigger and the layer. */
  gap?: number;
  /** Kept clear of every window edge. */
  margin?: number;
  /** The caption-button block in the top-right corner of the window; 0 × 0 (or absent) outside the desktop shell. */
  caption?: { width: number; height: number };
};

export type AnchorPosition = { top: number; left: number; maxHeight: number };

/** A layer squeezed by a tiny window still shows a few rows rather than collapsing. */
export const MIN_LAYER_HEIGHT = 120;

export function anchorPosition({
  anchor: r, width: w, height: h, viewportWidth: vw, viewportHeight: vh, placement, gap = 6, margin: m = 8, caption,
}: AnchorInput): AnchorPosition {
  const left = Math.max(m, Math.min(placement.endsWith('end') ? r.right - w : r.left, vw - w - m));

  // The top edge a layer may reach: the margin, or — when its right edge
  // runs into the caption buttons' columns — the margin below them.
  const capW = caption?.width ?? 0;
  const capH = caption?.height ?? 0;
  const underCaption = capW > 0 && capH > 0 && left + w > vw - capW;
  const minTop = underCaption ? capH + m : m;

  const below = vh - r.bottom - gap - m;
  const above = r.top - gap - minTop;
  const wantAbove = placement.startsWith('top');
  const goAbove = wantAbove ? above >= h || above > below : below < h && above > below;
  const maxHeight = Math.max(MIN_LAYER_HEIGHT, goAbove ? above : below);
  const top = goAbove ? r.top - gap - Math.min(h, maxHeight) : r.bottom + gap;
  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.floor(maxHeight) };
}
