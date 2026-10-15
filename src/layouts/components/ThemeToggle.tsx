import { useTheme } from "../../app/providers/ThemeProvider";
import { AppIcon } from "../../shared/components/AppIcon";

export function ThemeToggle(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const actionLabel = isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối";
  return <button type="button" onClick={toggleTheme} aria-label={actionLabel} aria-pressed={isDark} title={actionLabel}
    className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700">
    <AppIcon name={isDark ? "moon" : "sun"} className="h-[18px] w-[18px]" />
    <span className="hidden sm:inline">{isDark ? "Tối" : "Sáng"}</span>
  </button>;
}
