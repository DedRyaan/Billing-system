// useDebouncedValue - stable timer semantics under rapid re-renders: the timer
// RESETS on every change and cleans up on unmount.
import { useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): readonly [T, boolean] {
  const [debounced, setDebounced] = useState(value);
  const [pending, setPending] = useState(false);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
    if (value === debounced) {
      setPending(false);
      return;
    }
    setPending(true);
    const t = setTimeout(() => {
      setDebounced(latest.current);
      setPending(false);
    }, delayMs);
    return () => clearTimeout(t);
  }, [value, debounced, delayMs]);

  return [debounced, pending] as const;
}
