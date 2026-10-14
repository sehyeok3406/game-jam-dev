import type { MultiplayerSettings } from './types.ts';
import { COOP_REFERENCE_HTML } from './reference-game.ts';

export function multiplayerInstructions(
  settings: MultiplayerSettings | null | undefined,
) {
  if (settings === undefined) return '';
  if (settings === null)
    return '\n## 멀티 모듈 제거\n\n온라인 선언과 SDK 의존을 제거하고 기존 게임을 혼자 실행할 수 있게 수정한다. 원본 입력과 현재 플레이 방은 바꾸지 않는다.\n';
  return `\n## 프로젝트 온라인 멀티플레이 · 필수 실행 계약\n\n설정: ${JSON.stringify(settings)}\n- 2~${settings.maxPlayers}인 협동과 1인 로컬 플레이를 모두 구현한다. 온라인 방 관리·닉네임·준비/시작 UI는 앱이 제공한다.\n- 아래 JSON 선언과 GameJamMultiplayer.register 어댑터를 사용한다. SDK 소스, 서버 주소, 토큰, WebSocket, 외부 라이브러리를 HTML에 넣지 않는다. 앱이 SDK를 먼저 설치한다. 앱 밖에서는 SDK 존재를 확인해 안내한다.\n- createState({players,seed,random,solo})는 직렬화 가능한 초기 상태를 반환한다. validateInput(input)은 유효한 입력에 true를 반환한다. step(state,{inputs,dt,tick,players,random,solo})는 방장만 실행한다. dt는 초 단위이며 inputs는 {playerId,input,sequence,fresh} 배열이다. 빈 입력 {}은 중립 입력이다.\n- render(state,{selfId,solo,interpolation,active})는 표시용 사본을 그리며 공통 상태를 변경하지 않는다. getOutcome(state)는 진행 중 null, 종료하면 JSON 결과를 반환한다. GameJamMultiplayer.sendInput(input)으로 조작 상태를 보낸다. 입력은 1KiB, 스냅샷은 32KiB 이하로 유지한다.\n- 적 생성·피해·획득·점수·승패·시간·난수 결과는 모두 state에 넣고 step에서 계산한다. DOM 이벤트나 rAF에서 공통 상태를 바꾸지 않는다. Math.random 대신 제공된 random을 사용한다. 비공개 정보 대전·랭킹·영구 저장은 구현하지 않는다.\n- 키를 놓거나 포커스를 잃으면 입력을 해제한다. 1인 모드에서도 목표와 승패가 동작해야 한다. 일회성 동작은 상태 안에서 이전 입력·식별자를 비교해 중복 처리하지 않는다.\n- 아래 예제는 작동하는 API 참조다. 예제 게임을 그대로 복사하는 대신 사용자 지침의 게임 규칙을 이 계약으로 구현한다. maxPlayers는 요청한 ${settings.maxPlayers}명으로 선언한다.\n\n${COOP_REFERENCE_HTML}\n`;
}
