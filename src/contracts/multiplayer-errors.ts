export const entry = (
  phase: string,
  message: string,
  hint: string,
  retryable = false,
) => ({ phase, message, hint, retryable });
export const PLAY_ERRORS = {
  'GC-MP-001': entry(
    'game-config',
    '함께 플레이할 수 없는 게임 설정이에요.',
    '작업 지시에 함께 플레이를 요청해 게임을 수정한 뒤 다시 확인해주세요.',
  ),
  'GC-MP-002': entry(
    'game-data',
    '게임에서 잘못된 정보를 보냈어요.',
    '게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.',
  ),
  'GC-MP-003': entry(
    'project',
    '먼저 공동 프로젝트에 연결해주세요.',
    '함께할 친구와 같은 공동 프로젝트에 들어가주세요.',
    true,
  ),
  'GC-MP-004': entry(
    'validation',
    '함께 플레이 검사를 통과하지 못했어요.',
    '게임을 수정한 뒤 다시 검사해주세요.',
  ),
  'GC-MP-005': entry(
    'connection',
    '게임 연결이 끊어졌어요.',
    '자동으로 다시 연결하고 있어요. 계속되면 인터넷과 서버 실행 상태를 확인해주세요.',
    true,
  ),
  'GC-MP-006': entry(
    'connection-timeout',
    '게임에 연결하는 데 너무 오래 걸려요.',
    '인터넷과 서버 실행 상태를 확인한 뒤 다시 참가해주세요.',
    true,
  ),
  'GC-MP-007': entry(
    'server',
    '함께 플레이 서버를 사용할 수 없어요.',
    '앱과 협업 서버를 업데이트하고 서버가 실행 중인지 확인해주세요.',
    true,
  ),
  'GC-MP-008': entry(
    'permission',
    '이 플레이를 할 권한이 없어요.',
    '프로젝트 관리자에게 참여 권한을 확인해주세요.',
  ),
  'GC-MP-009': entry(
    'room',
    '이 방을 찾을 수 없어요.',
    '방 목록을 새로 확인하거나 새 방을 만들어주세요.',
    true,
  ),
  'GC-MP-010': entry(
    'capacity',
    '지금은 방이나 참여자를 더 추가할 수 없어요.',
    '빈자리가 있는 방에 참가하거나 사용하지 않는 방을 닫아주세요.',
    true,
  ),
  'GC-MP-011': entry(
    'start',
    '아직 게임을 시작할 수 없어요.',
    '두 명 이상 참가하고 모두 준비하면 방장이 시작할 수 있어요.',
    true,
  ),
  'GC-MP-012': entry(
    'game-version',
    '서로 다른 버전의 게임을 열었어요.',
    '현재 창을 닫고 최신 게임으로 새 방을 만들어주세요.',
  ),
  'GC-MP-013': entry(
    'loading',
    '게임을 준비하는 데 너무 오래 걸려요.',
    '게임 창을 다시 열어주세요. 반복되면 게임의 시작 부분을 수정해야 해요.',
    true,
  ),
  'GC-MP-014': entry(
    'registration',
    '이 게임의 함께 플레이 기능이 준비되지 않았어요.',
    '작업 지시에 함께 플레이를 요청해 게임의 연결 방식을 수정해주세요. 연결 코드를 직접 입력할 필요는 없어요.',
  ),
  'GC-MP-015': entry(
    'input',
    '캐릭터 조작을 처리하지 못했어요.',
    '조작을 멈추고 게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.',
  ),
  'GC-MP-016': entry(
    'simulation',
    '게임 규칙을 계산하다가 문제가 생겼어요.',
    '오류 정보를 복사해 게임 수정을 요청해주세요.',
  ),
  'GC-MP-017': entry(
    'render',
    '게임 화면을 그리지 못했어요.',
    '게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.',
  ),
  'GC-MP-018': entry(
    'outcome',
    '게임의 종료 결과를 처리하지 못했어요.',
    '오류 정보를 복사해 게임 수정을 요청해주세요.',
  ),
  'GC-MP-019': entry(
    'data-size',
    '게임이 한 번에 너무 많은 정보를 보냈어요.',
    '오류 정보를 복사해 게임 수정을 요청해주세요.',
  ),
  'GC-MP-020': entry(
    'protocol',
    '게임 정보를 읽을 수 없어요.',
    '앱과 서버를 업데이트한 뒤 방에 다시 참가해주세요.',
  ),
  'GC-MP-021': entry(
    'stale-session',
    '이전 플레이의 연결이 남아 있어요.',
    '게임 창을 닫고 현재 방에 다시 참가해주세요.',
    true,
  ),
  'GC-MP-022': entry(
    'overload',
    '게임 정보를 보내는 속도를 따라가지 못하고 있어요.',
    '잠시 후 다시 참가해주세요. 반복되면 게임 정보 전송량을 줄여야 해요.',
    true,
  ),
  'GC-MP-023': entry(
    'host-progress',
    '방장의 게임이 잠시 멈췄어요.',
    '잠시 기다려주세요. 계속되면 방장이 게임을 다시 열어주세요.',
    true,
  ),
  'GC-MP-024': entry(
    'recovery-timeout',
    '제한 시간 안에 게임을 다시 연결하지 못했어요.',
    '모두 다시 준비하거나 새 방을 만들어주세요.',
    true,
  ),
  'GC-MP-025': entry(
    'game-runtime',
    '게임을 실행하다가 문제가 생겼어요.',
    '게임을 다시 열어주세요. 반복되면 오류 정보를 전달해주세요.',
  ),
  'GC-MP-026': entry(
    'app-boundary',
    '이 창에서는 해당 작업을 할 수 없어요.',
    '앱의 게임 창에서 다시 시도해주세요.',
  ),
  'GC-MP-027': entry(
    'resource',
    '게임에 필요한 외부 파일을 사용할 수 없어요.',
    '이미지와 소리 등을 HTML 안에 포함해 게임을 다시 만들어주세요.',
  ),
  'GC-MP-028': entry(
    'diagnostics',
    '오류 기록을 파일로 저장하지 못했어요.',
    '앱이 열려 있는 동안 오류 정보를 복사해 보관해주세요. 저장 공간과 폴더 권한도 확인해주세요.',
  ),
  'GC-MP-029': entry(
    'unexpected',
    '플레이 중 예상하지 못한 문제가 생겼어요.',
    '오류 정보를 복사한 뒤 게임을 다시 열어주세요.',
  ),
  'GC-MP-030': entry(
    'connection-method',
    '이 게임은 프로젝트와 다른 방식으로 연결하려고 해요.',
    '같은 게임의 연결 방식을 앱의 함께 플레이로 수정해주세요. 서버 설정이나 연결 코드를 직접 입력할 필요는 없어요.',
  ),
  'GC-MP-031': entry(
    'request-conflict',
    '선택한 자료의 함께 플레이 요구가 서로 달라요.',
    '이번 구현 지시에 온라인 여부와 참여 인원을 적거나 기능 라이브러리에서 설정해주세요.',
  ),
  'GC-MP-032': entry(
    'server-compatibility',
    '현재 서버는 함께 플레이를 지원하지 않아요.',
    '프로젝트 관리자가 협업 서버를 업데이트한 뒤 다시 참가해주세요.',
  ),
} as const;
export type PlayErrorCode = keyof typeof PLAY_ERRORS;
export type PlayFailure = {
  schema: 1;
  id: string;
  at: string;
  code: PlayErrorCode;
  phase: string;
  message: string;
  hint: string;
  retryable: boolean;
  details: PlayDetails;
};
export type PlayDetails = Record<string, string | number | boolean>;

export const PLAY_ERROR_HINTS = Object.fromEntries(
  Object.entries(PLAY_ERRORS).map(([code, value]) => [
    code,
    [value.message, value.hint],
  ]),
) as unknown as {
  [K in PlayErrorCode]: readonly [string, string];
};
