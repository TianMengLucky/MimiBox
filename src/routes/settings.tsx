import { createFileRoute } from "@tanstack/react-router";
import ComingSoon from "@components/screen/ComingSoon";

export const Route = createFileRoute("/settings")({
  component: ComingSoon,
});
