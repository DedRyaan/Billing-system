import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement scrolling; TanStack Router calls window.scrollTo
// during navigation - stub it to keep console clean.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// vitest runs without globals - RTL auto-cleanup never registers itself.
afterEach(() => {
  cleanup();
});
