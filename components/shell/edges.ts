// The left and right padding of a navy masthead whose content lines up with
// the page's 1280px column: the dashboard's, and the one over the login
// screens, so the "€" mark keeps its place when one gives way to the other.
//
// The page column's gutters (1rem / 1.5rem), or more on a window wider than
// the column — whichever is larger. On the right the caption inset is added
// to the gutter exactly as .bar-caption-safe does; that class is not used
// here because, being unlayered, it would beat the column alignment.
//
// The page column is centred beside the scroller's scrollbar, not in the
// whole window (the masthead spans that), so the column maths runs on the
// window minus --sbw (the scrollbar's width, set by the Dashboard; 0 where
// nothing sets it) and the
// right edge gets the scrollbar back on top. The right edge is then the
// largest of: the page's own right edge on a narrow window (gutter +
// scrollbar), the gutter clear of the caption buttons, and the column's edge
// on a wide one — so the cluster ends where the page's tiles end unless the
// caption buttons need the room. (Spelled out in full: Tailwind finds class
// names by reading the source, so they cannot be assembled from pieces.)
export const MASTHEAD_EDGES =
  'pl-[max(1rem,calc((100%_-_var(--sbw,0px)_-_1280px)/2_+_1rem))] ' +
  'sm:pl-[max(1.5rem,calc((100%_-_var(--sbw,0px)_-_1280px)/2_+_1.5rem))] ' +
  'pr-[max(calc(1rem_+_var(--caption-inset)),calc(1rem_+_var(--sbw,0px)),calc((100%_-_var(--sbw,0px)_-_1280px)/2_+_1rem_+_var(--sbw,0px)))] ' +
  'sm:pr-[max(calc(1.5rem_+_var(--caption-inset)),calc(1.5rem_+_var(--sbw,0px)),calc((100%_-_var(--sbw,0px)_-_1280px)/2_+_1.5rem_+_var(--sbw,0px)))]';
