export type { SelfHostApi } from '../../contracts/self-host.ts';
export type { SelfHostState } from '../../contracts/self-host.ts';
import type { HostChecks } from '../../contracts/self-host.ts';
export type { HostChecks } from '../../contracts/self-host.ts';
export type HostReport = {
  schemaVersion: 1;
  checkedAt: string;
  status: string;
  code: string;
  publicUrl: string;
  port: number;
  checks: HostChecks;
};
