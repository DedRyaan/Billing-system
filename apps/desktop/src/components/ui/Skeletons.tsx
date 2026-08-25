// Skeletons - table-row shimmer blocks; appear ONLY after a 150ms delay so
// fast loads never flash; container aria-busy + skeletons aria-hidden; static
// 40% opacity under reduced motion (tokens.css kill-switch handles it).
import { useEffect, useState } from "react";

export function TableRowsSkeleton({ rows = 5 }: { rows?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div aria-busy="true" aria-live="polite" data-testid="table-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-(--height-row) items-center gap-md border-b border-hairline">
          <span
            data-skeleton=""
            aria-hidden="true"
            className="h-6 w-6 rounded-sm animate-skeleton-pulse bg-[color:var(--color-sidebar-hover)]"
          />
          <span data-skeleton="" aria-hidden="true" className="h-4 w-1/3 rounded-sm animate-skeleton-pulse bg-[color:var(--color-sidebar-hover)]" />
          <span data-skeleton="" aria-hidden="true" className="ml-auto h-4 w-24 rounded-sm animate-skeleton-pulse bg-[color:var(--color-sidebar-hover)]" />
        </div>
      ))}
    </div>
  );
}
