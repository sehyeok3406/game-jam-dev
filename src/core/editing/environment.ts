/** Deterministic business inputs; platform adapters supply the defaults. */
export type CommandEnvironment = { now: () => number; id: () => string };
