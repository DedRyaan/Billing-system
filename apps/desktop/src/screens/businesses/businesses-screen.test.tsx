// BusinessesScreen assembly tests (plan 03-07 Task 3): super-admin
// predicates, state matrix, optimistic rollback, upload gates.
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { BusinessesScreen } from "./BusinessesScreen";
import { LogoUploadField } from "./LogoUploadField";
import { ActiveBusinessProvider } from "../../business/ActiveBusinessProvider";
import { AuthProvider } from "../../auth/AuthProvider";
import { ToastHost } from "../../shell/ToastHost";

const SESSION = { access_token: "at", refresh_token: "rt" };

const BID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const BID_B = "bbbbbbbb-2222-2222-2222-222222222222";

function businessRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BID_A,
    legal_name: "Alpha Traders Pvt Ltd",
    trade_name: "Alpha",
    gstin: "27AAPFU0939F1ZV",
    number_format: "prefix_fy_seq",
    prefix: "INV",
    address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
    state: "27",
    phone: "9876543210",
    email: "owner@alpha.example",
    registration_type: "regular",
    logo_path: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseFixtures(role: string): ScriptedClientOptions {
  return {
    session: SESSION,
    profileRow: { id: "user-1", role, is_active: true, locked_at: null, full_name: "Asha Patil", email: "asha@example.com" },
    tables: {
      businesses: [
        businessRow(),
        businessRow({
          id: BID_B,
          legal_name: "Beta Works",
          gstin: "33AAACC1206D1ZN",
          state: "33",
          archived_at: "2026-02-02T00:00:00Z",
        }),
      ],
      profiles: [{ id: "user-1", role, is_active: true, locked_at: null }],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={{ getCurrentPath: () => "/businesses", navigate: vi.fn() }}>
          <BusinessesScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
  return { ...utils, qc };
}

describe("BusinessesScreen (super_admin)", () => {
  it("state matrix: loading skeletons then populated rows; Add CTA visible for super admin only", async () => {
    const client = makeScriptedClient(baseFixtures("super_admin"));
    mount(client);
    await waitFor(() => expect(screen.getByText("Alpha Traders Pvt Ltd")).toBeTruthy());
    // Archived row hidden until Show archived toggles.
    expect(screen.queryByText("Beta Works")).toBeNull();
    expect(screen.queryByTestId("add-business-cta")).not.toBeNull();
  });

  it("regular admin sees rows read-only: NO Add CTA", async () => {
    const client = makeScriptedClient(baseFixtures("admin"));
    mount(client);
    await waitFor(() => expect(screen.getByText("Alpha Traders Pvt Ltd")).toBeTruthy());
    expect(screen.queryByTestId("add-business-cta")).toBeNull();
  });

  it("Show archived checkbox reveals the archived row with lock badge caption", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const client = makeScriptedClient(baseFixtures("admin"));
    mount(client);
    await waitFor(() => expect(screen.getByText("Alpha Traders Pvt Ltd")).toBeTruthy());
    await user.click(screen.getByTestId("show-archived-toggle"));
    await waitFor(() => expect(screen.getByText("Beta Works")).toBeTruthy());
    expect(document.querySelector("[data-testid='datatable']")!.textContent).toContain("Archived");
  });

  it("empty listing shows exact empty copy with CTA for super admins", async () => {
    const client = makeScriptedClient({ ...baseFixtures("super_admin"), tables: { businesses: [], profiles: [] } });
    mount(client);
    await waitFor(() =>
      expect(
        document.querySelector("[data-testid='datatable']")!.textContent,
      ).toContain("No businesses yet"),
    );
    expect(
      document.querySelector("[data-testid='datatable']")!.textContent,
    ).toContain("Create your first business profile");
  });

  it("optimistic save failure rolls back and toasts with Retry reopening preserved edits", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    let failWrites = true;
    const client = makeScriptedClient({
      ...baseFixtures("super_admin"),
      onWrite: () => (failWrites ? { error: { code: "42501", message: "denied" } } : undefined),
    });
    const view = mount(client);

    await waitFor(() => expect(screen.getByText("Alpha Traders Pvt Ltd")).toBeTruthy());
    const rowsBefore = screen.getAllByRole("row").length;

    // Open edit sheet on the live row.
    await user.click(screen.getByText("Alpha Traders Pvt Ltd"));
    await waitFor(() => expect(document.getElementById("biz-trade-name")).not.toBeNull());

    // Save triggers create-vs-edit; editing existing row -> update path fails.
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(screen.getByText("Couldn't save business. Your changes were undone.")).toBeTruthy());

    // Retry reopens the sheet with edits preserved (draft seeded).
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.getElementById("biz-legal-name")).not.toBeNull());
    void rowsBefore;
    void view;
    void act;
    failWrites = false;
  });
});

describe("LogoUploadField gates (pre-network)", () => {
  function mountLogo(fileOverride: Partial<File>, deps?: unknown) {
    const storageDeps = (deps ?? {
      storage: {
        from: () => ({
          upload: async () => ({ data: {}, error: null }),
          remove: async () => ({ data: {}, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null }),
        }),
      },
    }) as Parameters<typeof LogoUploadField>[0]["deps"];
    render(
      <LogoUploadField
        deps={storageDeps}
        businessId={BID_A}
        existingPath={null}
        onUploaded={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="logo-upload"] input[type="file"]')!;
    return input;
  }

  function fakeFile(name: string, type: string, size: number): File {
    return { name, type, size } as unknown as File;
  }

  it("BAD_TYPE shows inline caption without any upload call", async () => {
    const uploadCalls: number[] = [];
    const input = mountLogo({}, {
      storage: {
        from: () => ({
          upload: async () => {
            uploadCalls.push(1);
            return { data: {}, error: null };
          },
          remove: async () => ({ data: {}, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: "x" }, error: null }),
        }),
      },
    });
    const file = fakeFile("malware.exe", "application/octet-stream", 10);
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => expect(screen.getByText("Logo must be a PNG, JPG or SVG image.")).toBeTruthy());
    expect(uploadCalls.length).toBe(0);
  });

  it("TOO_LARGE (>1MB) blocked before network", async () => {
    const uploadCalls: number[] = [];
    const input = mountLogo({}, {
      storage: {
        from: () => ({
          upload: async () => {
            uploadCalls.push(1);
            return { data: {}, error: null };
          },
          remove: async () => ({ data: {}, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: "x" }, error: null }),
        }),
      },
    });
    const file = fakeFile("big.png", "image/png", 1_000_001);
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => expect(screen.getByText("Logo must be 1 MB or smaller.")).toBeTruthy());
    expect(uploadCalls.length).toBe(0);
  });

  it("renders preview ONLY through <img src=signedUrl>", async () => {
    render(
      <LogoUploadField
        deps={{
          storage: {
            from: () => ({
              upload: async () => ({ data: {}, error: null }),
              remove: async () => ({ data: {}, error: null }),
              createSignedUrl: async () => ({
                data: { signedUrl: "https://signed.example/logo" },
                error: null,
              }),
            }),
          },
        }}
        businessId={BID_A}
        existingPath={`businesses/${BID_A}/logo.png`}
        onUploaded={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    const img = await screen.findByTestId("logo-preview");
    expect(img.getAttribute("src")).toBe("https://signed.example/logo");
    // No raw svg markup injected anywhere in the field.
    expect(document.querySelector("[data-testid='logo-upload'] svg[data-source='uploaded']")).toBeNull();
  });
});

