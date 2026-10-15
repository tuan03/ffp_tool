import type { SVGProps } from "react";

const ICON_PATHS = {
  crawler: "M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 8h8v8H8z",
  image: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 6-6 4 4 3-3 5 5M8 7h.01",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  seo: "m13 2-3 8H4l7 5-2 7 11-12h-7l3-8",
  queue: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  review: "M9 5H5v16h14v-4M9 3h6v4H9zm2 12 8-8 3 3-8 8-4 1z",
  chart: "M4 3v18h17M8 16v-4m5 4V8m5 8V5",
  ads: "m3 10 15-6v16L3 14v-4Zm4 6 2 6h4l-2-5M21 8v8",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  panel: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 0v18m7-13-3 4 3 4",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  info: "M12 8h.01M12 11v6M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
  warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  refresh: "M20 7V3l-3 3a8 8 0 1 0 3 9M20 3h-5",
  store: "M3 10V4h18v6M3 10h18M5 10v11h14V10M9 21v-7h6v7",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  folder: "M3 6V4h6l3 3h9v13H3V6Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 4v6l4 2",
  lock: "M6 10V7a6 6 0 0 1 12 0v3M4 10h16v12H4zM12 14v4",
  trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  edit: "m4 16 12-12 4 4L8 20l-5 1 1-5Zm9-9 4 4",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  copy: "M8 8h13v13H8zM16 4V2H2v14h2",
  play: "m7 3 15 9-15 9V3Z",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z",
} as const;

export type AppIconName = keyof typeof ICON_PATHS;

interface AppIconProps extends SVGProps<SVGSVGElement> {
  readonly name: AppIconName;
}

export function AppIcon({ name, className = "inline-block h-4 w-4 shrink-0 align-text-bottom", ...props }: AppIconProps): React.JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}><path d={ICON_PATHS[name]} /></svg>;
}
