import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

interface CrawlerDialogProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function CrawlerDialog({ title, isOpen, onClose, children }: CrawlerDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-0 text-slate-100 shadow-2xl backdrop:bg-black/70"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-5 py-3">
        <h2 id={headingId} className="min-w-0 truncate font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Đóng</button>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </dialog>
  );
}
