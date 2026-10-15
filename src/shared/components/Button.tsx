import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "danger";
}

const VARIANT_CLASSES = {
  primary: "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700",
  secondary: "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700",
  danger: "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/80",
} as const;

export function Button({ variant = "secondary", type = "button", className = "", ...props }: ButtonProps): React.JSX.Element {
  return <button type={type} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`} {...props} />;
}
