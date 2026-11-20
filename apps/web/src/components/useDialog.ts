import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Stack of mounted dialogs, top-most last, so Escape closes only the front dialog. */
const dialogStack: symbol[] = [];

/**
 * Shared accessibility behavior for modal dialogs:
 *  - Capture-phase Escape closes only the top-most dialog (and never clears map selection).
 *  - Tab / Shift+Tab stays trapped inside the dialog.
 *  - Focus returns to the element that opened the dialog when it closes.
 */
export function useDialog(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { open?: boolean; disabled?: boolean } = {},
): void {
  const { open = true, disabled = false } = options;
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onCloseRef.current = onClose;
    disabledRef.current = disabled;
  });

  useEffect(() => {
    if (!open) return;
    const token = Symbol('dialog');
    dialogStack.push(token);
    const prevFocus = document.activeElement as HTMLElement | null;

    // Move focus into the dialog if it isn't already inside (respecting autoFocus on children).
    const el = dialogRef.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!disabledRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const idx = dialogStack.lastIndexOf(token);
      if (idx !== -1) dialogStack.splice(idx, 1);
      if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') {
        prevFocus.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, open]);
}
