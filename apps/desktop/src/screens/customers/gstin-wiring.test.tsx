// CR-02 (MSTR-03 end-to-end): the production lookup client must actually be
// composed and handed to CustomerSheet - the debounced machine, dirty-field
// guard and snapshot embedding were previously reachable ONLY through
// injected fakes while end users got no auto-fetch at all.
//
//   (a) VITE_GSTIN_LOOKUP_URL(+KEY) present: typing a structurally valid
//       GSTIN fires ONE lookup after the 600ms debounce, carrying the
//       configured base URL and the x-api-key header; a verified registry
//       payload prefills the untouched legal-name field.
//   (b) config absent: NO network call ever fires (feature stays off).
//
// Also pins readGstinLookupEnv's tolerant contract directly (never throws;
// key optional; header name x-api-key).

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { CustomersScreen } from "./CustomersScreen";
import { ToastHost } from "../../shell/ToastHost";
import { AuthProvider } from "../../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../../business/ActiveBusinessProvider";
import { readGstinLookupEnv } from "../../lib/env";

const SESSION = { access_token: "at", refresh_token: "rt" };
const BID = "cccccccc-3333-3333-3333-333333333333";
const LOOKUP_URL = "https://lookup.example.test/gstins";

function customerRow() {
  return {
    id: "cust-1",
    business_id: BID,
    name: "Ravi Kumar",
    gstin: null,
    phone: null,
    address: null,
    state: "27",
    notes: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
  };
}

function fixtures(): ScriptedClientOptions {
  return {
    session: SESSION,
    profileRow: { id: "user-1", role: "staff", is_active: true, locked_at: null, full_name: "Asha Patil", email: "a@e.in" },
    tables: {
      customers: [customerRow()],
      profiles: [{ id: "user-1", role: "staff", is_active: true, locked_at: null }],
      business_members: [],
      businesses: [
        {
          id: BID,
          legal_name: "Alpha Traders Pvt Ltd",
          trade_name: null,
          gstin: "27AAPFU0939F1ZV",
          number_format: "seq",
          prefix: null,
          address: null,
          state: "27",
          phone: null,
          email: null,
          registration_type: "regular",
          logo_path: null,
          archived_at: null,
          created_at: "",
        },
      ],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router: RouterLike = { getCurrentPath: () => "/customers", navigate: vi.fn() };
  return render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          <CustomersScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

async function openSheetAndTypeGstin(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
  await user.click(screen.getByText("Add customer"));
  await waitFor(() => expect(document.getElementById("cust-gstin")).not.toBeNull());
  // Structurally valid GSTIN (passes validateGstin -> machine arms).
  await user.type(document.getElementById("cust-gstin") as HTMLInputElement, "27AAPFU0939F1ZV");
}

describe("GSTIN auto-fetch production wiring (CR-02)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fires the configured lookup after debounce and prefills the verified party", async () => {
    vi.stubEnv("VITE_GSTIN_LOOKUP_URL", LOOKUP_URL);
    vi.stubEnv("VITE_GSTIN_LOOKUP_API_KEY", "secret-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            legal_name: "Acme Widgets Ltd",
            trade_name: "Acme",
            pradr: { addr: { bno: "12", st: "MG Road", loc: "Pune", stcd: "27", pncd: "411001" } },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    mount(makeScriptedClient(fixtures()));
    await openSheetAndTypeGstin(user);

    // Debounce (600ms) + request land inside the waitFor window.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LOOKUP_URL}?gstin=27AAPFU0939F1ZV`);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");

    // Verified prefill lands in the untouched legal-name field.
    await waitFor(() =>
      expect((document.getElementById("cust-legal-name") as HTMLInputElement).value).toBe(
        "Acme Widgets Ltd",
      ),
    );
  });

  it("makes ZERO network calls when the lookup env is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    mount(makeScriptedClient(fixtures()));
    await openSheetAndTypeGstin(user);

    // Outlast the 600ms debounce: nothing may fire without config.
    await new Promise((r) => setTimeout(r, 800));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("readGstinLookupEnv contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when the URL var is missing/blank and never throws on extra vars", async () => {
    vi.stubEnv("VITE_GSTIN_LOOKUP_URL", "");
    expect(readGstinLookupEnv(import.meta.env as unknown as Record<string, unknown>)).toBeNull();
    vi.unstubAllEnvs();
    expect(readGstinLookupEnv({})).toBeNull();
    expect(readGstinLookupEnv({ VITE_GSTIN_LOOKUP_URL: "   " })).toBeNull();
  });

  it("composes the header only when a key is present", () => {
    expect(readGstinLookupEnv({ VITE_GSTIN_LOOKUP_URL: LOOKUP_URL })).toEqual({ baseUrl: LOOKUP_URL });
    expect(
      readGstinLookupEnv({ VITE_GSTIN_LOOKUP_URL: LOOKUP_URL, VITE_GSTIN_LOOKUP_API_KEY: "k" }),
    ).toEqual({ baseUrl: LOOKUP_URL, apiKeyHeader: { name: "x-api-key", value: "k" } });
  });
});
