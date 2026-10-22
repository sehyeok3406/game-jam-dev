export type UpdateState = {
  status:
    | 'unconfigured'
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'current'
    | 'ready'
    | 'installing'
    | 'error';
  currentVersion: string;
  repository: string | null;
  available: boolean;
  automatic: boolean;
  message: string;
  lastCheckedAt?: number;
  releaseName?: string;
  errorCode?: string;
};
export type TestUsersState = {
  supported: boolean;
  isTestUser: boolean;
  nickname?: string;
  maxWindows: number;
  windows: TestUserWindow[];
};
export type TestUserWindow = {
  id: string;
  nickname: string;
  memberId: string;
  projectId: string;
  role: 'editor' | 'viewer';
  status: 'starting' | 'ready' | 'closed' | 'failed';
  message?: string;
};
export type LaunchTestUsersInput = {
  count: number;
  nicknamePrefix: string;
  role: 'editor' | 'viewer';
};
