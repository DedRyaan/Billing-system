// EmptyState / ErrorState - circle icon -> Heading -> body (max-w 420) ->
// optional CTA / Retry secondary. ErrorState announces via role=alert and uses
// the GLOBAL load-error copy verbatim.
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { LOAD_ERROR_BODY, RETRY } from "../../lib/strings/global";
import { Button } from "./Button";

export function EmptyState({
  icon,
  title,
  copy,
  cta,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-2xl flex flex-col items-center px-md text-center">
      <span
        aria-hidden="true"
        className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-hairline bg-surface text-ink-secondary"
      >
        {icon}
      </span>
      <h2 className="mt-lg text-heading text-ink">{title}</h2>
      <p className="mt-xs max-w-[420px] text-body text-ink-secondary">{copy}</p>
      {cta !== undefined && (
        <div className="mt-lg">
          <Button onClick={cta.onClick}>{cta.label}</Button>
        </div>
      )}
    </div>
  );
}

export function ErrorState({ entity, onRetry }: { entity: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-2xl flex flex-col items-center px-md text-center">
      <span
        aria-hidden="true"
        className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-hairline bg-warning-subtle text-warning"
      >
        <TriangleAlert size={40} />
      </span>
      <h2 className="mt-lg text-heading text-ink">{`Couldn't load ${entity}.`}</h2>
      <p className="mt-xs max-w-[420px] text-body text-ink-secondary">{LOAD_ERROR_BODY}</p>
      <div className="mt-lg">
        <Button variant="secondary" onClick={onRetry}>
          {RETRY}
        </Button>
      </div>
    </div>
  );
}
