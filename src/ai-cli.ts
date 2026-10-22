/** Compatibility entrypoint; discovery and read-only probes belong to Node adapters. */
export { findOtherCli, otherCliStatus } from './adapters/node/ai/discovery.ts';
export type { CliCommand } from './adapters/node/ai/discovery.ts';
