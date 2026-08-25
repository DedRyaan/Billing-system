import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrolling; TanStack Router calls window.scrollTo
// during navigation - stub it to keep console clean.
window.scrollTo = (() => {}) as typeof window.scrollTo;
