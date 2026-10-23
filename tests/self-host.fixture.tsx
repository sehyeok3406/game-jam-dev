import { useState } from 'react';
import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createRoot } from 'react-dom/client';
import { ProjectHome } from '../src/ui/ProjectHome';
import { SelfHostDialog } from '../src/features/self-host/SelfHostDialog';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { SelfHostState } from '../src/features/self-host/types';
import '../src/index.css';
const projectId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const projects = [
  {
    id: 'local:qa',
    kind: 'local' as const,
    name: 'QA 로컬 프로젝트',
    root: 'C:\\QA',
    lastOpenedAt: 1,
  },
  {
    id: `shared:${projectId}`,
    projectId,
    kind: 'shared' as const,
    role: 'admin' as const,
    name: 'QA 공동 프로젝트',
    serverUrl: 'https://old.example',
    lastOpenedAt: 2,
  },
];
let state: SelfHostState = {
  autoStart: false,
  supported: true,
  stage: 'off',
  message: 'Cloudflare 연결 도구가 필요합니다. 연결 도구 준비를 눌러주세요.',
  code: 'GC-HOST-004',
  publicUrl: '',
  closeBehavior: 'ask',
  dataDirectory: 'C:\\QA\\server-data',
  projects: [],
  checkedAt: new Date().toISOString(),
  checks: {
    runtimeValid: true,
    serverOwnership: 'absent',
    tunnelOwnership: 'absent',
    localHealthy: false,
    publicHealthy: false,
    portChecked: true,
    serverFile: true,
    nodeReady: true,
    nodeVersion: 'v24',
    cloudflaredReady: false,
  },
};
const listeners = new Set<(value: SelfHostState) => void>();
const qa = {
  copyFailure: false,
  copyDelay: 0,
  copied: [] as string[],
  applied: [] as string[],
  actions: [] as string[],
  share: [] as string[],
  failDiagnosis: () => {
    state = {
      ...state,
      stage: 'problem',
      code: 'GC-HOST-099',
      diagnosticFailure: true,
      message: '서버 상태를 확인하지 못했습니다.',
    };
    listeners.forEach((listener) => listener(state));
  },
  state: (stage: 'off' | 'ready' | 'problem' | 'checking') => {
    state = {
      ...state,
      stage,
      diagnosticFailure: false,
      publicUrl: 'https://qa.trycloudflare.com',
      message:
        stage === 'ready'
          ? '인터넷 연결을 확인했습니다.'
          : '외부 연결을 확인하지 못했습니다.',
      code: stage === 'problem' ? 'GC-HOST-010' : '',
      checks: {
        ...state.checks!,
        serverOwnership: stage === 'off' ? 'absent' : 'owned',
        tunnelOwnership: stage === 'off' ? 'absent' : 'owned',
        localHealthy: stage !== 'off',
        publicHealthy: stage === 'ready',
        cloudflaredReady: true,
      },
      projects: [
        {
          id: projects[1].id,
          name: projects[1].name,
          projectId,
          inviteAvailable: true,
        },
      ],
    };
    listeners.forEach((listener) => listener(state));
  },
};
const api = createDevGameCanvasApi();
api.copyText = async (text) => {
  if (qa.copyDelay)
    await new Promise((resolve) => setTimeout(resolve, qa.copyDelay));
  if (qa.copyFailure) throw new Error('Synthetic native clipboard failure');
  qa.copied.push(text);
};
api.listProjects = async () => projects;
api.listProjectFolders = async () => [];
api.selfHost = {
  startSelfHostOnLaunch: async () => state.autoStart,
  setSelfHostAutoStart: async (autoStart) => (state = { ...state, autoStart }),
  getSelfHost: async () => state,
  runSelfHost: async (action) => {
    qa.actions.push(action);
    if (action === 'prepare')
      state = {
        ...state,
        code: '',
        message: '준비 완료',
        checks: { ...state.checks!, cloudflaredReady: true },
      };
    else if (action === 'start' || action === 'restart') qa.state('ready');
    else if (action === 'stop') qa.state('off');
    listeners.forEach((listener) => listener(state));
    return state;
  },
  onSelfHostChanged: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onSelfHostOpen: () => () => {},
  setSelfHostCloseBehavior: async (closeBehavior) => {
    state = { ...state, closeBehavior };
    return state;
  },
  getSelfHostPrompt: async () =>
    `QA AI 요청문: 단계: ${state.stage}, 최근 검사: ${state.checkedAt}. 계정 가입 불필요. 단계별 문제 해결을 도와줘.`,
  copySelfHostInfo: async (_id, kind) => {
    qa.copied.push(kind);
  },
  revealSelfHostData: async () => {},
};
api.inspectConnectionInfo = async (text) => {
  const info = JSON.parse(text);
  if (
    info.projectId !== projectId ||
    new URL(info.serverUrl).protocol !== 'https:'
  )
    throw new Error('프로젝트를 찾을 수 없습니다.');
  return {
    id: projects[1].id,
    name: projects[1].name,
    serverUrl: info.serverUrl,
    previousUrl: projects[1].serverUrl,
  };
};
api.applyConnectionInfo = async (text) => {
  qa.applied.push(text);
};
window.gameCanvas = api;
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: async () => {
      throw new Error('Browser clipboard permission denied');
    },
  },
});
(window as typeof window & { selfHostQa: typeof qa }).selfHostQa = qa;
function Fixture() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  document.documentElement.dataset.theme = theme;
  return (
    <>
      <ProjectHome
        openSelfHost={() => setOpen(true)}
        opened={async () => {}}
        join={() => {}}
        recover={() => {}}
        updates={() => {}}
        theme={theme}
        toggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      {open && (
        <SelfHostDialog
          close={() => setOpen(false)}
          share={async (id) => {
            qa.share.push(id);
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider runtime={createPreviewRuntime(api)}>
    <Fixture />
  </RuntimeProvider>,
);
