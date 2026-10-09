export type HostChecks = {
  runtimeValid: boolean;
  serverOwnership: 'absent' | 'owned' | 'unverified';
  tunnelOwnership: 'absent' | 'owned' | 'unverified';
  localHealthy: boolean;
  publicHealthy: boolean;
  portChecked: boolean;
  serverFile: boolean;
  nodeReady: boolean | null;
  nodeVersion: string;
  cloudflaredReady: boolean | null;
};
export type HostReport = {
  schemaVersion: 1;
  checkedAt: string;
  status: string;
  code: string;
  publicUrl: string;
  port: number;
  checks: HostChecks;
};
export type SelfHostState = {
  supported: boolean;
  stage:
    | 'off'
    | 'preparing'
    | 'starting'
    | 'checking'
    | 'ready'
    | 'problem'
    | 'stopping';
  message: string;
  code: string;
  publicUrl: string;
  checkedAt?: string;
  checks?: HostChecks;
  closeBehavior: 'ask' | 'background' | 'stop';
  dataDirectory: string;
  projects: {
    id: string;
    name: string;
    projectId: string;
    inviteAvailable: boolean;
  }[];
};
export type SelfHostApi = {
  getSelfHost: () => Promise<SelfHostState>;
  runSelfHost: (
    action: 'prepare' | 'start' | 'check' | 'stop' | 'restart',
  ) => Promise<SelfHostState>;
  setSelfHostCloseBehavior: (
    value: SelfHostState['closeBehavior'],
  ) => Promise<SelfHostState>;
  copySelfHostInfo: (
    id: string,
    kind: 'connection' | 'invite',
  ) => Promise<void>;
  getSelfHostPrompt: () => Promise<string>;
  revealSelfHostData: () => Promise<void>;
  onSelfHostChanged: (listener: (state: SelfHostState) => void) => () => void;
  onSelfHostOpen: (listener: () => void) => () => void;
};
