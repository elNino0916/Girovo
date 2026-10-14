// Material's ripple and the top app bar's scroll state, for the Android page.
//
// The ripple spreads from where the finger landed to the farthest corner of
// what was pressed, and fades once the finger lifts (app/android.css,
// [data-ripple]). It is drawn as the element's own background image, so it
// needs no extra element, follows the element's corners and changes none of
// its layout.
//
// The top app bar takes a container colour once the page scrolls under it
// (<html data-scrolled>, Material's on-scroll container colour).

const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], summary';
/** Pressables with a pressed state of their own: the switch's handle, the navigation bar's pill. */
const OWN_STATE = '[role="switch"], [data-nav-item], [data-segmented] > button';

function ripple(): void {
  document.addEventListener(
    'pointerdown',
    (down) => {
      if (!down.isPrimary || down.button > 0) return;
      const el = (down.target as Element | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el || el.matches(OWN_STATE) || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
      const box = el.getBoundingClientRect();
      const x = down.clientX - box.left;
      const y = down.clientY - box.top;
      const max = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
      el.style.setProperty('--m3e-ripple-x', `${x}px`);
      el.style.setProperty('--m3e-ripple-y', `${y}px`);
      el.style.setProperty('--m3e-ripple-max', `${max}px`);
      // Restart: a second press on the same element begins a new ripple.
      el.removeAttribute('data-ripple');
      void el.offsetWidth;
      el.dataset.ripple = 'in';

      const lift = () => {
        window.removeEventListener('pointerup', lift);
        window.removeEventListener('pointercancel', lift);
        // Let a quick tap's ripple reach the edge before it fades.
        setTimeout(() => {
          if (el.dataset.ripple !== 'in') return;
          el.dataset.ripple = 'out';
          el.addEventListener(
            'animationend',
            () => {
              if (el.dataset.ripple === 'out') el.removeAttribute('data-ripple');
            },
            { once: true },
          );
        }, 120);
      };
      window.addEventListener('pointerup', lift);
      window.addEventListener('pointercancel', lift);
    },
    { passive: true },
  );
}

function scrollState(): void {
  const root = document.documentElement;
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.('[data-scroll-root]')) return;
      const scrolled = el.scrollTop > 0;
      if (scrolled !== root.hasAttribute('data-scrolled')) root.toggleAttribute('data-scrolled', scrolled);
    },
    { capture: true, passive: true },
  );
}

export function installRipple(): void {
  ripple();
  scrollState();
}
