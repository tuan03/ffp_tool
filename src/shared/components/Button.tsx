import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "danger";
}

const VARIANT_CLASSES = {
  primary: "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700",
  secondary: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
} as const;

export function Button({ variant = "secondary", type = "button", className = "", ...props }: ButtonProps): React.JSX.Element {
  return <button type={type} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`} {...props} />;
}
