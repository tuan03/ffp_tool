import type { RouteObject } from "react-router-dom";
import type { CustomGptClient } from "./service";
import { CustomGptSeoPage } from "./ui/CustomGptSeoPage";

export function createCustomGptSeoRoutes(client: CustomGptClient): RouteObject[] {
  return [{ path: "gpt-seo", element: <CustomGptSeoPage client={client} /> }];
}
