// PlaceholderScreen - the ghost composition for not-yet-built routes (S3):
// 72px paper-tone circle + 40px muted icon + Heading title + Body secondary
// line. ZERO interactive elements - the shell geometry never changes when
// real screens land (D-66).
import type { ReactNode } from "react";

export interface PlaceholderScreenProps {
  icon: ReactNode;
  title: string;
  body: string;
}

export function PlaceholderScreen({ icon, title, body }: PlaceholderScreenProps) {
  return (
    <section
      aria-label={`${title} placeholder`}
      data-testid="placeholder-screen"
      className="flex flex-1 flex-col items-center justify-center px-md text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted"
      >
        {icon}
      </span>
      <h2 className="mt-lg text-heading text-ink">{title}</h2>
      <p className="mt-xs max-w-[420px] text-body text-ink-secondary">{body}</p>
    </section>
  );
}
