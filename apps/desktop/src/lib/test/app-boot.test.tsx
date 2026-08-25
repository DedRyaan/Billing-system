// Tracer slice test: boots the REAL route tree through the REAL router +
// query providers and proves the auth branch seam end-to-end. No network.
//
//   (a) unauthenticated mount redirects to /login
//   (b) authenticated mount renders the /dashboard placeholder copy
//   (c) navigating to /bills swaps content WITHOUT remounting the root

import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHistory } from "@tanstack/react-router";
import { renderApp } from "./render-app";

const DASHBOARD_COPY = "Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.";
const BILLS_COPY = "Bill drafting arrives next — blank screen to final number in under 30 seconds.";

describe("app boot tracer", () => {
  it("redirects an unauthenticated mount to /login", async () => {
    await renderApp({ session: "unauthenticated", initialEntry: "/" });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Sign in")).toBeInTheDocument();
  });

  it("renders the dashboard placeholder for an authenticated session", async () => {
    await renderApp({ session: "authenticated", initialEntry: "/" });
    expect(await screen.findByText(DASHBOARD_COPY)).toBeInTheDocument();
  });

  it("swaps to /bills without remounting the root layout", async () => {
    const { container, router } = await renderApp({
      session: "authenticated",
      initialEntry: "/dashboard",
    });
    expect(await screen.findByText(DASHBOARD_COPY)).toBeInTheDocument();

    const rootBefore = container.querySelector("[data-shell-root]");
    expect(rootBefore).not.toBeNull();

    await act(async () => {
      await router.navigate({ to: "/bills" });
    });

    expect(container.querySelector("[data-shell-root]")).toBe(rootBefore);
    expect(screen.getByText(BILLS_COPY)).toBeInTheDocument();
  });

  it("guards protected routes for unauthenticated deep links", async () => {
    const history = createMemoryHistory({ initialEntries: ["/bills"] });
    await renderApp({ session: "unauthenticated", history });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
