import type { RouteObject } from "react-router-dom";
import type { ModuleApiRunner } from "../module-api";
import { CustomizationManagerPage } from "./ui/CustomizationManagerPage";

export function createCustomizationManagerRoutes(
  moduleApiRunner?: ModuleApiRunner,
  defaultStoreId?: string,
): RouteObject[] {
  return [
    {
      path: "customization",
      element: (
        <CustomizationManagerPage
          moduleApiRunner={moduleApiRunner}
          defaultStoreId={defaultStoreId}
        />
      ),
    },
  ];
}
