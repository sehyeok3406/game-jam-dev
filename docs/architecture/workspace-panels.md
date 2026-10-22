# R05 창·패널 조립 경계

2026-10-21의 기능 단위다. `WorkspacePanels`는 홈/작업 화면에 반복되던 관리 창과 탐색·플러그인 패널을 조립하며 기존 DOM 순서·CSS·표시 상태와 feature gate를 유지한다. `WorkspaceScreen`의 전체 편집 명령·확인 창까지 분리한 것은 아니다.

## 책임

- `usePanelState`: 기존 15개 boolean 표시 상태와 안정된 setter. 문서·프로젝트·초안·서버 상태를 한 전역 Context에 넣지 않는다.
- `WorkspacePanels`: 업데이트·협업·PC 서버, 오프라인 상태, 찾기·탐색·명령·단축키·비교, 플러그인·칸반 보기·상태 관리의 표시/닫힘과 셸 수명 조립. 기존 component props로 그룹 계약을 정의한다. PC 서버는 빌드 상수와 runtime capability로 계속 제한한다.
- `WorkspaceScreen`/각 기능: 프로젝트 전환 전 편집 flush, 협업 연결 후 load, 상태/칸반 저장의 expected 값, plugin 콘텐츠의 문서/게임 UI 데이터와 비동기 명령. 컴포넌트 이동을 이유로 기존 저장 순서나 실패 정책을 바꾸지 않는다.
- `installWorkspaceModalFocus`: 셸이 mount될 때 한 번 설치하고 unmount 시 observer/listener를 제거한다. 실제 열린 DOM의 modal을 찾아 동적으로 추가된 기존 편집 창도 처리한다. CanvasOverlays/workflow 등의 자체 Escape·busy 처리와 native dialog cancel 정책은 각 컴포넌트에 남긴다.

## 포커스와 표시 순서

기존 `.dialog-backdrop` 80, `.modal-backdrop` 1200, `.workflow-modal-backdrop` 1500 등 CSS의 ancestor z-index와 동점의 DOM 순서로 활성 창을 정한다. CSS 숫자나 디자인은 변경하지 않는다. native `showModal` dialog는 브라우저의 top layer와 자체 포커스/Tab 처리를 유지한다.

활성 창의 Tab/Shift+Tab 경계에서 한 번만 순환하고 disabled·hidden·inert·숨긴 컨트롤은 제외한다. 위쪽 창이 닫히면 아래쪽 창의 원래 컨트롤, 마지막 창이 닫히면 연결된 원래 버튼으로 복귀한다. 자동 업데이트처럼 뒤쪽 창이 나중에 열려도 앞 창의 포커스를 가져가지 않으며, 앞 창이 먼저 없어지면 복귀 경로를 이어 보존한다. 닫힌/삭제된 트리거에는 포커스를 강제하지 않는다. 표시되지 않은 Electron 검사 창처럼 focusin이 생략되는 호스트에서도 현재 activeElement를 함께 확인한다.

업데이트의 document Escape listener는 실제 최상위 modal이 업데이트일 때만 닫는다. 협업 창은 busy 중 Escape로 닫지 않고, 정상 상태의 Escape는 해당 창만 닫는다. 기존 command/compare/workflow의 자체 처리도 유지한다. UI debug console은 기존 canvas shortcut 예외처럼 자체 포커스를 유지한다.

modal이 없을 때 canvas drag의 style 변경마다 전체 workspace를 다시 검색하지 않고, 바뀐 subtree에 modal이 생겼는지 확인한다. 실제 창이 열린 동안에는 DOM/가시성 변화를 따라간다. 상태/문서 저장이나 협업 프로토콜은 포커스 처리와 결합하지 않는다.

## 빌드 경로 보완

비활성 PC 서버 번들 검사에서 이전 `DesktopBootstrap` 이동 후 main alias가 `./features/...`만 가리키는 것을 발견했다. renderer의 예전 `../features/...` alias도 이동된 `../../features/...`를 포함하지 못했다. 두 Vite alias를 상대 깊이에 대응하도록 고치고, `WorkspacePanels`에도 정적 `SELF_HOST_ENABLED` 조건을 두었다. `verify-self-host-disabled`가 main/preload/renderer의 관리 코드 제거와 기존 공동 재연결 보존을 실제 번들에서 검사한다. 활성 Windows 배포의 PC 서버 기능은 유지한다.

## 검증 범위

- `workspace-modal-focus.test.mjs`: 실제 jsdom focus/event/observer를 사용하며 geometry만 대체한다. Tab·CSS/DOM 순서·자동 뒤쪽 창·native 우선·숨김·삭제된 트리거·호스트 focusin 생략·구독 해제를 검사한다.
- `run-workspace-panels-ui.mjs`: 실제 App과 격리 fixture에서 협업/자동 업데이트 겹침, 참여 처리 중 Escape 차단·실패, 반복 홈/프로젝트 전환과 구독 수, 명령 창, dark/light·640/1280 레이아웃을 확인한다. 실제 AI/서버 참여나 업데이트 다운로드를 수행하는 fixture가 아니다.
- 기존 integration·ui-review·ui-debug: 실제 문서/IME 저장·충돌 초안·캔버스·패널/플러그인·기존 UI 카탈로그를 연결한다.
- `workspace-panels-packaged.mjs`: 실제 Windows 앱·UUID 프로필·임시 프로젝트의 겹친 관리 창·Tab/Escape/포커스, 명령/플러그인/상태 창, 홈 왕복·완전 재시작과 프로젝트 원문 보존. 기존 game-ui/협업 패키지 검사로 기능 연결을 보완한다.

실행 결과와 패키지 해시는 실행 계획서 23절에 확정한다. R05의 남은 편집/선택 명령 콜백·프로젝트 작업 확인 창·AI/히스토리 패널 조립과 전체 완료 조건은 후속 단위다. R07~R10, F01~F04의 기능 구현도 이번 단위에서 하지 않는다.
