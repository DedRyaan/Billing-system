import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient } from "../../lib/test/fake-client";
import { ActiveBusinessProvider, useActiveBusiness } from "../../business/ActiveBusinessProvider";

const BID = "cccccccc-3333-3333-3333-333333333333";
const SESSION = { access_token: "at", refresh_token: "rt" };

function Probe() {
  const biz = useActiveBusiness();
  return (
    <output data-testid="p">
      {biz.activeBusinessId}:{String(biz.isArchived)}:{String(biz.isLoading)}
    </output>
  );
}

describe("probe", () => {
  it("archived listing yields isArchived true", async () => {
    const client = makeScriptedClient({
      session: SESSION,
      tables: {
        businesses: [
          {
            id: BID,
            legal_name: "Alpha Traders Pvt Ltd",
            trade_name: null,
            gstin: "",
            number_format: "seq",
            prefix: null,
            address: null,
            state: "27",
            phone: null,
            email: null,
            registration_type: "regular",
            logo_path: null,
            archived_at: "2026-02-02T00:00:00Z",
            created_at: "",
          },
        ],
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = (await import("@testing-library/react")).render(
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider
          dataClient={client}
          router={{ getCurrentPath: () => "/", navigate: vi.fn() }}
        >
          <Probe />
        </ActiveBusinessProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-testid='p']")!.textContent).toContain("true");
    });
    console.log("PROBE:", container.querySelector("[data-testid='p']")!.textContent);
  });
});
