// Copying text — an IBAN, a reference, the "Kontodaten" block.
//
// navigator.clipboard is the right API but not always there: it needs a secure
// context (a self-hosted install opened over http://<lan-ip> has none), and
// the desktop shell answers permission requests from a deny-by-default
// handler. So a failed or missing writeText falls back to the old
// document.execCommand('copy'), which needs neither — only a selection and
// the user's click that started the copy.

/** How long writeText may take before it is treated as refused. */
const WRITE_TIMEOUT_MS = 1000;

async function writeWithApi(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A permission handler that never answers would leave the promise
    // pending forever and the copy button without feedback. After a second
    // the fallback still runs inside the click's user activation.
    return await Promise.race([
      clipboard.writeText(text).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Copies through a hidden textarea and execCommand('copy').
 *
 * The textarea goes inside the open dialog (or menu, or popover) the copy
 * was started from: a modal <dialog> makes the rest of the page inert
 * (nothing outside can be focused or selected), a focus trap would pull
 * focus straight back out of a textarea appended to <body>, and a menu that
 * closes when focus leaves it would close mid-copy. Nothing is painted in
 * between: append, copy and remove run in one task.
 *
 * A `copy` listener puts the exact text on the clipboard as plain text,
 * independent of what the selection ends up being. Selection and focus are
 * restored afterwards, so a copy button inside a form leaves the caret
 * where it was.
 */
function writeWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges: Range[] = [];
  if (selection) for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
  const field =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? { el: active, start: active.selectionStart, end: active.selectionEnd, dir: active.selectionDirection }
      : null;

  const host =
    (active?.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [popover]') as HTMLElement | null) ??
    document.body;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', ''); // no on-screen keyboard on touch devices
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  // On screen but invisible: some engines refuse to select text that is
  // clipped away or display:none. 12pt keeps iOS from zooming in on focus.
  Object.assign(area.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    margin: '0',
    opacity: '0',
    pointerEvents: 'none',
    fontSize: '12pt',
    contain: 'strict',
  } satisfies Partial<CSSStyleDeclaration>);

  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  let ok = false;
  host.appendChild(area);
  document.addEventListener('copy', onCopy, true);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    area.remove(); // focus falls back to <body> with it
    if (active && active.isConnected) {
      try {
        active.focus({ preventScroll: true });
        if (field && field.start != null && field.end != null) {
          field.el.setSelectionRange(field.start, field.end, field.dir ?? undefined);
        }
      } catch {
        // Not every input type has a selection (type=email throws); focus is enough.
      }
    }
    if (selection && !field) {
      selection.removeAllRanges();
      for (const r of ranges) selection.addRange(r);
    }
  }
  return ok;
}

/**
 * Puts `text` on the clipboard. Resolves true when it got there (as far as
 * the browser lets us know), false otherwise — never rejects, so a copy
 * button can just show "Kopiert" or an error.
 *
 * Call it from the click handler itself: both paths depend on the user
 * activation that click grants.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (await writeWithApi(value)) return true;
  try {
    return writeWithExecCommand(value);
  } catch {
    return false;
  }
}
