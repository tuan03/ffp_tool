import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  return <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-5">
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="mt-1.5 max-w-[75ch] text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </header>;
}
