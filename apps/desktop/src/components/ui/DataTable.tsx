// DataTable - the CRUD core (D-74, UI-SPEC §DataTable + §State Matrix).
// Toolbar (debounced search / count meta / primary CTA slot) -> table with
// sortable aria-sort headers -> rows h44 with activation semantics. Internal
// states: skeleton-after-150ms loading, empty child, error+Retry panel,
// compact no-results variant. `/` focuses search from the list container.
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, X } from "lucide-react";
import { useDebouncedValue } from "../../lib/hooks/useDebouncedValue";
import { searchNoResultsHeading, SEARCH_NO_RESULTS_BODY, CLEAR_SEARCH } from "../../lib/strings/global";
import { TableRowsSkeleton } from "./Skeletons";
import { ErrorState } from "./EmptyState";
import { CONTROL_CLASSES } from "./Input";

export interface DataTableColumn<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
  numeric?: boolean;
  mono?: boolean;
  truncate?: boolean;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowId: (row: T) => string;
  searchableKeys: ReadonlyArray<keyof T & string>;
  rowKeyLabel: string;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onRowActivate?: ((row: T) => void) | undefined;
  searchPlaceholder?: string | undefined;
  primaryAction?: React.ReactNode | undefined;
  emptyState?: React.ReactNode | undefined;
  /** Optional per-row class (e.g. muted styling for inactive items). */
  getRowClassName?: ((row: T) => string) | undefined;
}

type SortDir = "asc" | "desc";
const TRUNCATE_LIMIT = 32;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  searchableKeys,
  rowKeyLabel,
  isLoading,
  isError,
  onRetry,
  onRowActivate,
  searchPlaceholder = "Search",
  primaryAction,
  emptyState,
  getRowClassName,
}: DataTableProps<T>) {
  const [rawQuery, setRawQuery] = useState("");
  const [query] = useDebouncedValue(rawQuery, 200);
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim().length
    ? rows.filter((r) =>
        searchableKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(query.trim().toLowerCase())),
      )
    : rows;

  const sorted =
    sort === null
      ? filtered
      : [...filtered].sort((a, b) => {
          const av = a[sort.key as keyof T];
          const bv = b[sort.key as keyof T];
          const cmp =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av ?? "").localeCompare(String(bv ?? ""));
          return sort.dir === "asc" ? cmp : -cmp;
        });

  const cycleSort = (key: string) => {
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  };

  const onKeyDownWrapper = (e: React.KeyboardEvent) => {
    if (e.key === "/" && document.activeElement === wrapperRef.current) {
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  const body = () => {
    if (isError === true && onRetry) {
      return <ErrorState entity={rowKeyLabel} onRetry={onRetry} />;
    }
    if (isLoading === true) {
      return <TableRowsSkeleton />;
    }
    if (rows.length === 0) {
      return <>{emptyState}</>;
    }
    if (filtered.length === 0) {
      return (
        <div className="mt-lg flex flex-col items-center text-center">
          <Search size={20} aria-hidden="true" className="text-ink-muted" />
          <p className="mt-sm text-body font-semibold text-ink">{searchNoResultsHeading(rawQuery)}</p>
          <p className="text-caption text-ink-secondary">{SEARCH_NO_RESULTS_BODY}</p>
          <button
            type="button"
            onClick={() => setRawQuery("")}
            className="mt-sm text-caption text-accent-hover underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {CLEAR_SEARCH}
          </button>
        </div>
      );
    }
    return (
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-9 border-b border-hairline">
            {columns.map((col) => {
              const activeSort = sort?.key === col.key ? sort.dir : null;
              return (
                <th
                  key={col.key}
                  scope="col"
                  {...(activeSort !== null
                    ? { "aria-sort": activeSort === "asc" ? ("ascending" as const) : ("descending" as const) }
                    : {})}
                  className="px-sm py-xs text-left text-caption uppercase tracking-[0.04em] text-ink-secondary"
                >
                  {col.sortable === true ? (
                    <button
                      type="button"
                      onClick={() => cycleSort(col.key)}
                      className="inline-flex items-center gap-xs uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {col.label}
                      {activeSort === null ? (
                        <ChevronsUpDown size={14} aria-hidden="true" className="text-ink-muted" />
                      ) : activeSort === "asc" ? (
                        <ChevronUp size={14} aria-hidden="true" className="text-accent" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" className="text-accent" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const id = getRowId(row);
            return (
              <tr
                key={id}
                tabIndex={0}
                role="row"
                data-row-id={id}
                onClick={() => onRowActivate?.(row)}
                onFocus={() => undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onRowActivate?.(row);
                  }
                }}
                className={`h-(--height-row) cursor-pointer border-b border-hairline transition-colors duration-(--duration-fast) hover:bg-surface focus-visible:bg-accent-subtle focus-visible:outline-none ${getRowClassName !== undefined ? getRowClassName(row) : ""}`}
              >
                {columns.map((col, idx) => {
                  const raw = String(row[col.key] ?? "");
                  const truncated = col.truncate === true && raw.length > TRUNCATE_LIMIT;
                  return (
                    <td
                      key={col.key}
                      className={`px-sm py-xs text-body text-ink ${col.numeric === true ? "text-right tabular-nums" : ""}`}
                    >
                      <span className={idx === 0 ? "mr-sm inline-flex h-6 w-6 items-center justify-center align-middle" : ""}>
                        {idx === 0 ? raw.slice(0, 1).toUpperCase() : ""}
                      </span>
                      <span
                        title={truncated ? raw : undefined}
                        className={`${col.mono === true ? "font-mono whitespace-nowrap" : ""} ${
                          truncated ? "inline-block max-w-[32ch] overflow-hidden text-ellipsis whitespace-nowrap align-middle" : ""
                        }`}
                      >
                        {idx === 0 && truncated ? raw : raw}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div ref={wrapperRef} data-testid="datatable" tabIndex={0} onKeyDown={onKeyDownWrapper}
      className="focus-visible:outline-none">
      <div className="flex items-center gap-md pb-md">
        <div className="relative w-full max-w-[320px]">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search"
            placeholder={searchPlaceholder}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            className={`h-(--control-md) pl-lg pr-sm ${CONTROL_CLASSES}`}
          />
          {rawQuery.length > 0 && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => setRawQuery("")}
              className="absolute right-sm top-1/2 -translate-y-1/2 text-ink-secondary hover:text-ink"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {query.trim().length > 0 && (
          <span className="text-caption text-ink-secondary">
            {filtered.length} {rowKeyLabel}
          </span>
        )}
        <div className="ml-auto">{primaryAction}</div>
      </div>
      <div className="w-full overflow-x-auto">{body()}</div>
    </div>
  );
}


