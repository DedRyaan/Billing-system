import { createFileRoute, redirect } from "@tanstack/react-router";

// `/` always lands on the dashboard (D-66 shell entry).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
