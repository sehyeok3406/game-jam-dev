/** Existing protocol/storage limits shared by validation and server services. */
export const ServerLimits = Object.freeze({
  history: 300,
  receipts: 500,
  files: 500,
  projects: 20,
  members: 20,
  markdownBytes: 2_000_000,
  htmlBytes: 8_000_000,
  assetEncodedBytes: 6_666_800,
  projectBytes: 20_000_000,
  requestBytes: 22_000_000,
});
