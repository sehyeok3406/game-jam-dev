export const ERROR_CODES = {
  'GC-UPD-001': [
    '업데이트 설정',
    '배포 저장소의 소유자·이름과 앱 빌드 설정을 확인해주세요.',
  ],
  'GC-UPD-003': [
    '업데이트 다운로드',
    '인터넷 연결과 GitHub 릴리스의 RELEASES·nupkg 파일을 확인하고 다시 시도해주세요.',
  ],
  'GC-UPD-004': [
    '업데이트 작업 보호',
    '편집·저장·AI 작업을 마치고 테스트 창과 내장 서버의 다른 참여자가 작업을 종료한 뒤 다시 시도해주세요.',
  ],
  'GC-UPD-005': [
    '업데이트 설치',
    '편집 내용을 저장하고 앱이 정상 응답하는지 확인한 뒤 재시도를 하거나 최신 설치 파일을 이용해주세요.',
  ],
  'GC-UPD-006': [
    '업데이트 설정 저장',
    '앱 사용자 데이터 폴더의 쓰기 권한과 디스크 공간을 확인해주세요.',
  ],
  'GC-AI-008': [
    'AI 연결·인증',
    '선택한 CLI를 설치하고 본인 계정으로 로그인한 뒤 다시 확인해주세요.',
  ],
  'GC-AI-009': [
    'AI 제공자 설정',
    'GPT, Claude, Gemini 중 하나와 해당 CLI에서 지원하는 모델을 선택해주세요.',
  ],
  'GC-AI-010': [
    'AI 협업 서버 버전',
    '편집자 AI 실행·다중 제공자를 사용하려면 앱과 협업 서버를 v0.8.0 이상으로 업데이트해주세요.',
  ],
  'GC-NET-001': [
    '연결 시간 초과',
    '서버 PC와 터널이 실행 중인지 확인해주세요.',
  ],
  'GC-NET-002': ['네트워크 연결', '인터넷 연결과 서버 주소를 확인해주세요.'],
  'GC-NET-003': [
    '서버 응답',
    '서버 주소, 터널 상태와 서버 로그를 확인해주세요.',
  ],
  'GC-NET-004': ['요청 제한', '잠시 기다린 뒤 다시 시도해주세요.'],
  'GC-TEST-002': [
    '앱 창 표시',
    '창 로딩·표시 실패를 확인하고, 기존 앱을 종료한 뒤 최신 버전으로 다시 실행해주세요.',
  ],
  'GC-IMPORT-001': [
    '파일 불러오기',
    '파일 형식, UTF-8 인코딩, 용량 및 프로젝트 편집 권한을 확인해주세요.',
  ],
  'GC-IMPORT-002': [
    '이미지 데이터',
    'PNG, JPG, WebP, GIF 파일의 형식·용량과 프로젝트 내부 이미지 경로를 확인해주세요.',
  ],
  'GC-IMPORT-003': [
    'HTML 불러오기',
    'UTF-8 형식의 단일 HTML 파일(최대 8MB)을 선택해주세요.',
  ],
  'GC-AI-007': [
    'HTML 분석 범위',
    'HTML 게임 한 개를 선택하고 원본 보호와 분석 출처 정보를 확인해주세요.',
  ],
  'GC-APP-001': [
    '앱 처리',
    '문제가 반복되면 작업 ID와 진단 정보를 전달해주세요.',
  ],
  'GC-EDIT-001': ['문서 편집', '최신 문서를 확인한 뒤 다시 시도해주세요.'],
  'GC-COLLAB-001': ['공동 작업', '연결 상태와 역할, 문서 잠금을 확인해주세요.'],
  'GC-TEST-001': [
    '테스트 사용자 실행',
    '관리자 연결 상태, 초대 코드, 참여 인원과 PC의 실행 권한을 확인해주세요.',
  ],
  'GC-AI-001': ['작업 준비', 'AI 연결과 선택한 입력·출력 범위를 확인해주세요.'],
  'GC-AI-002': [
    'CLI 실행',
    '연결 설정을 확인하고 작업 로그의 마지막 오류를 확인해주세요.',
  ],
  'GC-AI-003': [
    '입력 보호',
    'AI가 입력을 변경했습니다. 명세를 확인하고 다시 실행해주세요.',
  ],
  'GC-AI-004': ['출력 범위', '결과 경로와 버전 선택을 확인해주세요.'],
  'GC-AI-005': ['출력 누락', 'AI가 지정된 결과 파일을 모두 작성해야 합니다.'],
  'GC-AI-006': [
    '결과 미변경',
    '작업이 실제 결과를 생성하거나 갱신했는지 확인해주세요.',
  ],
  'GC-MD-001': [
    '문서 형식',
    'Markdown frontmatter의 id/title/type/status/sources를 확인해주세요.',
  ],
  'GC-MD-002': [
    '문서 ID',
    '새 문서는 고유 ID를, 갱신 문서는 기존 ID를 사용해야 합니다.',
  ],
  'GC-MD-003': ['문서 출처', '실제 입력 메모의 ID를 sources에 기록해주세요.'],
  'GC-HTML-001': [
    'HTML 파싱',
    '코드 블록이나 설명문이 아닌 실행 가능한 HTML 파일을 작성해야 합니다.',
  ],
  'GC-HTML-002': ['HTML 실행', 'HTML의 JavaScript 실행 오류를 수정해주세요.'],
  'GC-HTML-003': [
    'HTML 검증 시간 초과',
    '초기 실행의 무한 반복이나 과도한 작업을 확인해주세요.',
  ],
  'GC-HTML-004': [
    'HTML 실행 프로세스',
    '실행 프로세스 종료 원인을 확인해주세요.',
  ],
  'GC-HTML-005': [
    'HTML 빈 화면',
    '초기 로드 후 실제 화면 요소가 표시되는지 확인해주세요.',
  ],
  'GC-SYNC-001': [
    '입력 버전 충돌',
    '작업 도중 문서가 변경됐습니다. 최신 문서로 다시 실행해주세요.',
  ],
  'GC-IO-001': [
    '결과 반영',
    '폴더 접근 권한과 저장 공간, 협업 연결을 확인해주세요.',
  ],
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;
export type FailureInfo = {
  code: ErrorCode;
  stage: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
  diagnosticPath?: string;
};
export class CanvasError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CanvasError';
    this.code = code;
    this.details = details;
  }
}
export function failureInfo(
  error: unknown,
  fallback: ErrorCode = 'GC-APP-001',
): FailureInfo {
  const message = error instanceof Error ? error.message : String(error);
  const embedded = message.match(/\[(GC-[A-Z]+-\d{3})\]/)?.[1] as
    | ErrorCode
    | undefined;
  const code =
    error instanceof CanvasError
      ? error.code
      : embedded && embedded in ERROR_CODES
        ? embedded
        : fallback;
  return {
    code,
    stage: ERROR_CODES[code][0],
    message: message.replace(/^\[GC-[A-Z]+-\d{3}\]\s*/, ''),
    hint: ERROR_CODES[code][1],
    details: error instanceof CanvasError ? error.details : {},
  };
}
export function errorText(failure: FailureInfo) {
  return `[${failure.code}] ${failure.message}`;
}
export function redactDiagnostic(value: string) {
  return value
    .replace(
      /("(?:token|api[_-]?key|authorization|secret)"\s*:\s*")[^"\n]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(
      /((?:token|api[_-]?key|authorization|secret)\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
