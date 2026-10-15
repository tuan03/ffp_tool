import { NavLink } from "react-router-dom";

import { AppIcon } from "../../shared/components/AppIcon";
import { buildStoreAwarePath } from "../../shared/active-store";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import type { AppIconName } from "../../shared/components/AppIcon";

interface NavigationDestination {
  readonly path: string;
  readonly label: string;
  readonly icon: AppIconName;
  readonly isStoreAware?: boolean;
}

export const NAVIGATION_GROUPS: readonly { readonly label: string; readonly destinations: readonly NavigationDestination[] }[] = [
  { label: "Thu thập & sản phẩm", destinations: [
    { path: "/amazon-crawler", label: "Distributed Crawler", icon: "crawler" },
    { path: "/pinterest-pod", label: "Pinterest POD Studio", icon: "image" },
    { path: "/customization", label: "Customizer", icon: "settings" },
  ] },
  { label: "SEO", destinations: [
    { path: "/auto-seo", label: "Auto SEO", icon: "seo", isStoreAware: true },
    { path: "/gpt-seo", label: "SEO Queue", icon: "queue", isStoreAware: true },
    { path: "/seo-review", label: "SEO Review", icon: "review", isStoreAware: true },
    { path: "/seo-performance", label: "SEO Performance", icon: "chart", isStoreAware: true },
  ] },
  { label: "Marketing & review", destinations: [
    { path: "/ads-intelligence", label: "Ads Intelligence", icon: "ads", isStoreAware: true },
    { path: "/review-studio", label: "Review Studio", icon: "star" },
  ] },
];

interface AppSidebarProps {
  readonly activeStoreId: string;
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly isMobileViewport?: boolean;
  readonly isMobileOpen?: boolean;
  readonly onMobileClose?: () => void;
}

export function AppSidebar({ activeStoreId, isCollapsed: isDesktopCollapsed, onToggle, isMobileViewport = false, isMobileOpen = false, onMobileClose = () => {} }: AppSidebarProps): React.JSX.Element {
  const isCollapsed = isDesktopCollapsed && !isMobileViewport;
  const sidebarRef = useDialogFocus<HTMLElement>({ isOpen: isMobileViewport && isMobileOpen, onClose: onMobileClose });
  return <aside ref={sidebarRef} tabIndex={-1} role={isMobileViewport ? "dialog" : undefined} aria-modal={isMobileViewport && isMobileOpen ? true : undefined} aria-label="Menu chính" className={`fixed inset-y-0 left-0 z-50 h-dvh shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:z-auto ${isMobileOpen ? "flex" : "hidden md:flex"} ${isCollapsed ? "w-16" : "w-[232px]"}`}>
    <NavLink to="/amazon-crawler" onClick={onMobileClose} aria-label="FFP Tool — Distributed Crawler" className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-semibold tracking-tight text-white">FP</span>
      {!isCollapsed && <span className="text-[15px] font-semibold tracking-tight text-slate-900">FFP Tool<span className="mt-0.5 block text-xs font-normal text-slate-500">Không gian vận hành</span></span>}
    </NavLink>
    <nav id="app-navigation" aria-label="Điều hướng ứng dụng" className="min-h-0 flex-1 overflow-y-auto px-2 py-5">
      {NAVIGATION_GROUPS.map((group, index) => <div key={group.label} className={index ? "mt-5 border-t border-slate-100 pt-5" : ""}>
        {!isCollapsed && <p className="mb-2 px-3 text-xs font-medium text-slate-500">{group.label}</p>}
        <div className="space-y-1">{group.destinations.map(destination => <NavLink key={destination.path}
          data-navigation-link
          onClick={onMobileClose}
          to={destination.isStoreAware ? buildStoreAwarePath(destination.path, activeStoreId) : destination.path}
          className={({ isActive }) => `group relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[13px] transition-colors ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"} ${isCollapsed ? "justify-center" : ""}`}
          title={isCollapsed ? destination.label : undefined}>
          <AppIcon name={destination.icon} className="h-[18px] w-[18px] shrink-0" />
          <span className={isCollapsed ? "sr-only" : ""}>{destination.label}</span>
          {isCollapsed && <span aria-hidden="true" className="pointer-events-none fixed left-[72px] z-50 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">{destination.label}</span>}
        </NavLink>)}</div>
      </div>)}
    </nav>
    <div className="shrink-0 border-t border-slate-200 p-2">
      <button type="button" onClick={isMobileViewport ? onMobileClose : onToggle} aria-controls="app-navigation" aria-expanded={isMobileViewport ? isMobileOpen : !isCollapsed} aria-label={isMobileViewport ? "Đóng menu" : isCollapsed ? "Mở rộng menu" : "Thu gọn menu"} title={isMobileViewport ? "Đóng menu" : isCollapsed ? "Mở rộng menu" : "Thu gọn menu"}
        className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 ${isCollapsed ? "justify-center" : ""}`}>
        <AppIcon name="panel" className={`h-[18px] w-[18px] shrink-0 ${isCollapsed ? "rotate-180" : ""}`} />
        {!isCollapsed && <span>{isMobileViewport ? "Đóng menu" : "Thu gọn menu"}</span>}
      </button>
    </div>
  </aside>;
}
