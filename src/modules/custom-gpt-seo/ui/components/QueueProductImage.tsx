import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";

export function QueueProductImage({ url }: { readonly url?: string }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const canShowImage = Boolean(url && failedUrl !== url);
  return <span className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 ${canShowImage ? "bg-white" : "bg-slate-50 text-slate-400 dark:bg-slate-800"}`}>
    {canShowImage ? <img src={url} alt="" loading="lazy" className="h-full w-full object-contain p-1" onError={() => setFailedUrl(url ?? null)} /> : <AppIcon name="image" className="h-5 w-5" />}
  </span>;
}
