import { Outlet, createRootRoute, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { getBootstrapState } from "../lib/session-seam";
import { useAuth } from "../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  useActiveBusiness,
} from "../business/ActiveBusinessProvider";
import { Sidebar } from "../shell/Sidebar";
import { BusinessSwitcher } from "../shell/BusinessSwitcher";
import { OfflineBanner } from "../shell/OfflineBanner";
import { ToastHost } from "../shell/ToastHost";
import { ARCHIVED_BANNER } from "../lib/strings/shell";

// Root frame (plan 03-06): unauthenticated surfaces render bare; the
// authenticated app mounts the FULL chrome - sidebar with business switcher,
// content pane with archived/offline banners, toast host exactly once.
// data-shell-root lets tests prove navigation swaps content WITHOUT
// remounting the root.

function RootLayout() {
  const auth = useAuth();
  const router = useRouter();
  const routerAdapter = {
    getCurrentPath: () => router.state.location.pathname,
    navigate: (opts: { to: string }) => router.navigate({ to: opts.to }),
  };

  // The active-business provider mounts for AUTHENTICATED sessions only -
  // its listing query needs an authenticated client; login/bootstrap stay
  // chrome-free.
  return (
    <div data-shell-root>
      {auth.status === "authenticated" && auth.client !== null ? (
        <ActiveBusinessProvider dataClient={auth.client} router={routerAdapter}>
          <AuthenticatedShell navigate={(to) => void routerAdapter.navigate({ to })} />
        </ActiveBusinessProvider>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

function AuthenticatedShell({ navigate }: { navigate: (to: string) => void }) {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = auth.role === "admin" || auth.role === "super_admin";

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        activePath={pathname}
        role={auth.role}
        fullName={auth.profile?.full_name ?? null}
        email={auth.profile?.email ?? null}
        onSignOut={() => void auth.signOut()}
        onNavigate={navigate}
        switcher={
          <BusinessSwitcher
            businesses={biz.businesses}
            activeBusinessId={biz.activeBusinessId}
            isLoading={biz.isLoading}
            isAdmin={isAdmin}
            onSwitch={(id) => biz.switchBusiness(id)}
            onManage={() => navigate("/businesses")}
          />
        }
      />
      <main className="flex min-w-0 flex-1 flex-col bg-paper">
        {biz.isArchived && (
          <div
            role="status"
            data-testid="archived-banner"
            className="flex shrink-0 items-center gap-sm bg-paper px-lg py-xs text-caption text-ink-secondary"
          >
            {ARCHIVED_BANNER}
          </div>
        )}
        <OfflineBanner />
        <Outlet />
      </main>
      <ToastHost />
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
