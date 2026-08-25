// DataTable + Sheet behaviors - RED then GREEN. The CRUD core.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";
import { Sheet } from "./Sheet";

interface Row {
  id: string;
  name: string;
  gstin: string;
  price: number;
}

const ROWS: Row[] = [
  { id: "1", name: "Beta Traders", gstin: "27AAPFU0939F1ZV", price: 2 },
  { id: "2", name: "Alpha Enterprises", gstin: "33AAACC1206D1ZN", price: 1 },
];

const COLS: Array<DataTableColumn<Row>> = [
  { key: "name", label: "Name", sortable: true, truncate: true },
  { key: "gstin", label: "GSTIN", mono: true },
  { key: "price", label: "Amount", sortable: true, numeric: true },
];

function renderTable(
  overrides: Partial<{
    data: Row[];
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    onRowActivate: (r: Row) => void;
    searchPlaceholder: string;
    primaryAction: React.ReactNode;
    emptyState: React.ReactNode;
  }> = {},
) {
  return render(
    <DataTable<Row>
      columns={COLS}
      rows={overrides.data ?? ROWS}
      getRowId={(r) => r.id}
      searchableKeys={["name", "gstin"]}
      rowKeyLabel="items"
      {...(overrides.isLoading !== undefined ? { isLoading: overrides.isLoading } : {})}
      {...(overrides.isError !== undefined ? { isError: overrides.isError } : {})}
      {...(overrides.onRetry ? { onRetry: overrides.onRetry } : {})}
      {...(overrides.onRowActivate ? { onRowActivate: overrides.onRowActivate } : {})}
      {...(overrides.searchPlaceholder ? { searchPlaceholder: overrides.searchPlaceholder } : {})}
      {...(overrides.primaryAction ? { primaryAction: overrides.primaryAction } : {})}
      {...(overrides.emptyState ? { emptyState: overrides.emptyState } : {})}
    />,
  );
}

describe("DataTable", () => {
  it("renders headers and body rows; GSTIN column renders mono", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("Alpha Enterprises")).toBeInTheDocument();
    expect(screen.getByText("27AAPFU0939F1ZV").className).toContain("font-mono");
  });

  it("sortable header cycles unsorted->asc->desc with correct aria-sort and order", async () => {
    renderTable();
    const nameBtn = screen.getByRole("button", { name: "Name" });
    const th = nameBtn.closest("th")!;
    expect(th).not.toHaveAttribute("aria-sort");

    await userEvent.click(nameBtn); // asc
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getAllByRole("row")[1]!).toHaveTextContent("Alpha Enterprises");

    await userEvent.click(nameBtn); // desc
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(screen.getAllByRole("row")[1]!).toHaveTextContent("Beta Traders");
  });

  it("search narrows client-side after debounce and shows filtered count meta", async () => {
    renderTable({ searchPlaceholder: "Search customers" });
    const input = screen.getByPlaceholderText("Search customers");
    await userEvent.type(input, "Alpha");
    await waitFor(() => {
      expect(screen.queryByText("Beta Traders")).toBeNull();
      expect(screen.getByText(/1 items/)).toBeInTheDocument();
    });
  });

  it("no-results compact variant offers Clear search resetting the query", async () => {
    renderTable({ searchPlaceholder: "Search" });
    await userEvent.type(screen.getByRole("textbox"), "zzzz-no-match");
    await screen.findByText(/No results for/);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.getByText("Beta Traders")).toBeInTheDocument());
  });

  it("/ focuses the search box when the list container has focus", async () => {
    renderTable({ searchPlaceholder: "Search" });
    screen.getByTestId("datatable").focus();
    await userEvent.keyboard("/");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("row activation fires on click or Enter for focused rows", async () => {
    const activate = vi.fn();
    renderTable({ onRowActivate: activate });
    const row = screen.getByText("Beta Traders").closest("tr")!;
    row.focus();
    await userEvent.click(row);
    await userEvent.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("error state replaces the body with Retry", async () => {
    const retry = vi.fn();
    renderTable({ isError: true, onRetry: retry });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("loading state shows skeleton rows only after the 150ms delay", async () => {
    vi.useFakeTimers();
    renderTable({ isLoading: true });
    // Not yet - delay holds.
    expect(document.querySelector("[data-skeleton]")).toBeNull();
    await act(async () => vi.advanceTimersByTime(160));
    expect(document.querySelector("[data-skeleton]")).not.toBeNull();
    vi.useRealTimers();
  });

  it("empty renders the provided empty child", () => {
    renderTable({
      data: [],
      emptyState: <div>EMPTY-CHILD</div>,
    });
    expect(screen.getByText("EMPTY-CHILD")).toBeInTheDocument();
  });
});

describe("Sheet", () => {
  function Harness(props: { dirty?: boolean; onSave?: () => void; onClose?: () => void }) {
    return (
      <Sheet
        open
        onClose={props.onClose ?? (() => undefined)}
        title="Edit customer"
        dirty={props.dirty ?? false}
        {...(props.onSave ? { onSave: props.onSave } : {})}
      >
        <input aria-label="First field" />
      </Sheet>
    );
  }

  it("renders a right sheet with title dialog semantics, X close, Cancel+Save footer", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: /Edit customer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("clean Esc closes immediately without any confirm", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("dirty Esc raises Discard-changes confirm; Keep editing stays; Discard proceeds", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} dirty />);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("Discard changes?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("initial focus lands on the first input inside the sheet", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByLabelText("First field")).toHaveFocus());
  });
});

