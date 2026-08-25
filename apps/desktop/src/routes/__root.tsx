import { Outlet, createRootRoute } from "@tanstack/react-router";

// Root frame - minimal chrome slot this tracer slice; full sidebar/header
// shell lands in plan 03-06. data-shell-root lets tests prove navigation
// swaps content WITHOUT remounting the root.
function RootLayout() {
  return (
    <div data-shell-root>
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
