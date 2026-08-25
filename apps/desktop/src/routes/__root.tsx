import { Outlet, createRootRoute, redirect } from "@tanstack/react-router";
import { getBootstrapState } from "../lib/session-seam";

// Root frame - minimal chrome slot this slice; full sidebar/header shell
// lands in plan 03-06. data-shell-root lets tests prove navigation swaps
// content WITHOUT remounting the root.
function RootLayout() {
  return (
    <div data-shell-root>
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  beforeLoad: ({ location }) => {
    // Bootstrap precedence (D-73): pre-bootstrap, /bootstrap replaces EVERY
    // other route - highest priority, enforced once here at the root.
    if (getBootstrapState() === "unbootstrapped" && location.pathname !== "/bootstrap") {
      throw redirect({ to: "/bootstrap" });
    }
  },
});
