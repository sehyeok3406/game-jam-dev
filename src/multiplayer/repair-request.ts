import type { GamejamRequest } from '../gamejam-request.ts';
import { DEFAULT_MULTIPLAYER } from './types.ts';

/** Reuse the normal user request/approval pipeline and preserve the source game. */
export function multiplayerRepairRequest(
  path: string,
  name: string,
  canvasId: string,
  x: number,
  y: number,
): GamejamRequest {
  return {
    canvasId,
    organize: false,
    implement: true,
    sourceMode: 'html-compose',
    inputPaths: [path],
    x,
    y,
    resultName: name,
    htmlResult: { mode: 'new', basePath: path },
    multiplayer: { ...DEFAULT_MULTIPLAYER },
    instructions: {
      organize: '',
      implement:
        '선택한 실제 게임의 규칙·화면·조작·콘텐츠를 유지하면서 온라인 연결만 Game Jam의 함께 플레이로 바꿔줘. 기존 연결 코드 교환, 별도 서버 주소나 연결 서버 설정 입력, 직접 연결 기능을 제거해줘. 앱의 프로젝트 참여자가 방을 만들고 참가해서 바로 테스트할 수 있게 구현해줘. 혼자 연습도 유지하고, 원본은 보존해서 새 버전으로 만들어줘. 게임의 기존 참여 인원을 확인하고 2~4명 범위에서 필요한 인원을 설정해줘.',
    },
  };
}
