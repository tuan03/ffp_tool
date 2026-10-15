import type { GptSeoJob } from "../../types";
import { getStatusPresentation } from "../seo-queue-view-model";

export function QueueStatusBadge({ status }: { readonly status: GptSeoJob["status"] }): React.JSX.Element {
  const presentation = getStatusPresentation(status);
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${presentation.badgeClassName}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${presentation.dotClassName}`} />{presentation.label}
  </span>;
}
