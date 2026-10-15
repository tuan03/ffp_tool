import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";

export function CopyJobIdButton({ jobId }: { readonly jobId: string }): React.JSX.Element {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(jobId);
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  }
  return <span className="inline-flex min-w-0 items-center gap-1.5">
    <button type="button" title={jobId} aria-label={`Sao chép job ID ${jobId}`} onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1.5 rounded px-1 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100">
      <span className="font-mono">{jobId.length > 16 ? `${jobId.slice(0, 8)}…${jobId.slice(-4)}` : jobId}</span><AppIcon name={copyState === "copied" ? "check" : "copy"} className="h-3 w-3" />
    </button>
    <span role="status" className="text-xs text-slate-500 dark:text-slate-400">{copyState === "copied" ? "Đã sao chép" : copyState === "failed" ? <>Sao chép thủ công: <code className="select-all break-all">{jobId}</code></> : ""}</span>
  </span>;
}
