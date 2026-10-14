// Material's bottom sheet can be pulled down to close: on the phone a dialog
// is a bottom sheet with a drag handle (app/android.css, [data-sheet]), and
// the handle is a promise this keeps.
//
// The pull starts only on the sheet's top edge — the handle and the title
// row above the content — so it never fights the sheet's own scrolling. A
// pull far or fast enough closes the sheet the way back and Escape do (the
// topmost layer's own close, components/ui.tsx); a shorter one springs back.

const EDGE_PX = 56;
const CLOSE_PX = 120;
const FLING_PX_PER_MS = 0.6;

function sendEscape(from: Element): void {
  const init = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true } as KeyboardEventInit;
  from.dispatchEvent(new KeyboardEvent('keydown', init));
}

export function installSheetDrag(): void {
  document.addEventListener('pointerdown', (down) => {
    if (down.pointerType === 'mouse' || !down.isPrimary) return;
    const target = down.target as Element | null;
    const sheet = target?.closest<HTMLElement>('[data-sheet]');
    if (!sheet || window.innerWidth >= 640) return;
    // Not on a control in the edge (the close button), and only from the edge.
    if (target?.closest('button, a, input, select, textarea, [role="button"]')) return;
    if (down.clientY - sheet.getBoundingClientRect().top > EDGE_PX) return;

    const startY = down.clientY;
    const startT = performance.now();
    let dy = 0;
    sheet.style.transition = 'none';

    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.translate = `0 ${dy}px`;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      const fast = dy / Math.max(1, performance.now() - startT) > FLING_PX_PER_MS;
      sheet.style.transition = 'translate 0.2s cubic-bezier(0.2, 0, 0, 1)';
      if (e.type === 'pointerup' && (dy > CLOSE_PX || (fast && dy > 24))) {
        sheet.style.translate = '0 100%';
        sendEscape(sheet);
      } else {
        sheet.style.translate = '';
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
}
