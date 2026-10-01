import { useNavigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import type { AutoSeoClient, AutoSeoHandoverHandler } from "./types";
import { AutoSeoPage } from "./ui/AutoSeoPage";

function AutoSeoRoutePage({
  client,
  onHandoverToSeo,
  backendRunsSeo,
}: {
  readonly client: AutoSeoClient;
  readonly onHandoverToSeo?: AutoSeoHandoverHandler;
  readonly backendRunsSeo?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <AutoSeoPage
      client={client}
      onHandoverToSeo={onHandoverToSeo}
      backendRunsSeo={backendRunsSeo}
      navigate={navigate}
    />
  );
}

export function createAutoSeoRoutes(
  client: AutoSeoClient,
  onHandoverToSeo?: AutoSeoHandoverHandler,
  backendRunsSeo = false,
): RouteObject[] {
  return [
    {
      path: "auto-seo",
      element: (
        <AutoSeoRoutePage
          client={client}
          onHandoverToSeo={onHandoverToSeo}
          backendRunsSeo={backendRunsSeo}
        />
      ),
    },
  ];
}
