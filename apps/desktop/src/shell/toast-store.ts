// toast-store - framework-free pub/sub behind ToastHost (S9 contract).
//
// Stack caps at 3 (oldest evicted); auto-dismiss 5s (errors 8s) scheduled by
// the store itself so timing is testable standalone with fake timers.
// Toasts are reserved for FAILURES and reversible-destructive acts - routine
// saves are silent (A5); rollback copy is owned by strings modules and
// screens compose showToast rather than hand-rolling feedback (T-3-24).
import { mutationFailureToast } from "../lib/strings/global";

export type ToastVariant = "error" | "info" | "success";

export interface ToastInput {
  variant?: ToastVariant;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface Toast extends Required<Pick<ToastInput, "message">> {
  id: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

const MAX_STACK = 3;
const DISMISS_MS = 5000;
const ERROR_DISMISS_MS = 8000;

let seq = 0;
let toasts: Toast[] = [];
/** Stable snapshot for useSyncExternalStore (must be referentially cached). */
let snapshot: readonly Toast[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<(toasts: readonly Toast[]) => void>();

function emit(): void {
  snapshot = [...toasts];
  for (const fn of listeners) fn(snapshot);
}

/** Standard failure toast - the ONLY success-adjacent copy allowed (A5). */
export function showMutationFailure(entity: string, retry: () => void): string {
  return showToast({
    variant: "error",
    message: mutationFailureToast(entity),
    actionLabel: "Retry",
    onAction: retry,
  });
}

export function showToast(input: ToastInput): string {
  const id = `toast-${++seq}`;
  const variant = input.variant ?? "info";
  const toast: Toast = {
    id,
    variant,
    message: input.message,
    ...(input.actionLabel !== undefined ? { actionLabel: input.actionLabel, onAction: input.onAction } : {}),
  };
  toasts = [...toasts, toast].slice(-MAX_STACK);
  // Evicted entries' timers die with their ids.
  if (!toasts.some((t) => t.id === id)) return id;
  const ttl = variant === "error" ? ERROR_DISMISS_MS : DISMISS_MS;
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ttl),
  );
  emit();
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(fn: (toasts: readonly Toast[]) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Referentially-stable snapshot getter for useSyncExternalStore. */
export function getToastSnapshot(): readonly Toast[] {
  return snapshot;
}

export function currentToasts(): readonly Toast[] {
  return snapshot;
}

/** Test isolation helper - clears stack AND pending timers. */
export function resetToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  emit();
}
