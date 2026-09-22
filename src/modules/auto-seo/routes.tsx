import type { RouteObject } from "react-router-dom";
import type { AutoSeoClient } from "./types";
import { AutoSeoPage } from "./ui/AutoSeoPage";

export function createAutoSeoRoutes(client: AutoSeoClient): RouteObject[] {
  return [
    {
      path: "auto-seo",
      element: <AutoSeoPage client={client} />,
    },
  ];
}
