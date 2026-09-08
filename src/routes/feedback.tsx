import { createFileRoute } from "@tanstack/react-router";
import ComingSoon from "@components/screen/ComingSoon";

export const Route = createFileRoute("/feedback")({
  component: ComingSoon,
});
