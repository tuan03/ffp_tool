import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const activeDialogs: HTMLElement[] = [];
let previousBodyOverflow = "";
const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface DialogFocusOptions {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/** Shared by custom overlays; native <dialog> retains its browser-managed focus. */
export function useDialogFocus<TElement extends HTMLElement = HTMLDivElement>({ isOpen, onClose }: DialogFocusOptions): RefObject<TElement | null> {
  const dialogRef = useRef<TElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeDialogs.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeDialogs.push(dialog);
    const getFocusableElements = (): HTMLElement[] => {
      return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter(element => !element.matches(":disabled, [tabindex='-1']") && element.getClientRects().length > 0);
    };
    (getFocusableElements()[0] ?? dialog).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent): void {
      if (activeDialogs.at(-1) !== dialog || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0] ?? dialog;
      const lastElement = focusableElements.at(-1) ?? dialog;
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (event.shiftKey ? document.activeElement === firstElement : document.activeElement === lastElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const dialogIndex = activeDialogs.indexOf(dialog);
      if (dialogIndex !== -1) activeDialogs.splice(dialogIndex, 1);
      if (activeDialogs.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (returnTarget?.isConnected && returnTarget.getClientRects().length > 0) returnTarget.focus({ preventScroll: true });
    };
  }, [isOpen]);
  return dialogRef;
}
