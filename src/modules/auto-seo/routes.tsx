import { useNavigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import type { AutoSeoClient, AutoSeoHandoverHandler } from "./types";
import { AutoSeoPage } from "./ui/AutoSeoPage";

function AutoSeoRoutePage({
  client,
  onHandoverToSeo,
}: {
  readonly client: AutoSeoClient;
  readonly onHandoverToSeo?: AutoSeoHandoverHandler;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <AutoSeoPage
      client={client}
      onHandoverToSeo={onHandoverToSeo}
      navigate={navigate}
    />
  );
}

export function createAutoSeoRoutes(
  client: AutoSeoClient,
  onHandoverToSeo?: AutoSeoHandoverHandler,
): RouteObject[] {
  return [
    {
      path: "auto-seo",
      element: (
        <AutoSeoRoutePage
          client={client}
          onHandoverToSeo={onHandoverToSeo}
        />
      ),
    },
  ];
}
