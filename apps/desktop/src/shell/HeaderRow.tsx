// HeaderRow - content-pane header: h56, Heading title left, actions slot
// right, bottom hairline. Screens compose it as the first element of their
// body; the offline banner renders directly beneath (S3 contract).
import type { ReactNode } from "react";

export interface HeaderRowProps {
  title: string;
  actions?: ReactNode;
}

export function HeaderRow({ title, actions }: HeaderRowProps) {
  return (
    <header
      data-testid="header-row"
      className="flex h-14 shrink-0 items-center justify-between gap-md border-b border-hairline px-lg"
    >
      <h1 className="truncate text-heading text-ink">{title}</h1>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-sm">{actions}</div>}
    </header>
  );
}
