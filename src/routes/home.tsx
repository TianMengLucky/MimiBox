import { createFileRoute } from "@tanstack/react-router";
import ComingSoon from "@components/screen/ComingSoon";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

function HomeRoute() {
  return <ComingSoon />;
}
