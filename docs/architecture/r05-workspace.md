# R05 화면 조립과 기능 경계

2026-10-21. 이전 문서 카드·편집 세션·미리보기·선택/섹션/접기 명령·패널·CSS 분리에 이어, 남아 있던 화면 명령과 비동기 상태의 소유권을 분리했다. 저장 형식·IPC·협업 프로토콜·디자인·라이브러리는 변경하지 않는다.

## 소유권

| 경계                                                                   | 소유하는 책임                                                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/App.tsx`                                                           | React Flow provider와 프로젝트 화면 조립                                                                                                       |
| `ui/workspace/WorkspaceScreen.tsx`                                     | 실행 환경, 프로젝트 자료, drawing/game-ui/kanban, 기능 훅과 화면의 명시적 연결. 전역 Context에 상태를 모으지 않음                              |
| `ui/workspace/useProjectLoading.ts`, `useWorkspaceData.ts`             | 증분 자료 읽기 세대·현재 세션 확인·metadata 병합·원래 객체 identity·저장 상태 overlay·개인 viewport 복구                                       |
| `ui/canvas/useCanvasNodes.ts`                                          | 문서/섹션/미리보기/그림/게임 UI/칸반 노드 모델 조립, 기존 measured/dragging/selection 및 노드 identity 보존                                    |
| `ui/canvas/geometry-plan.ts`, `useCanvasGeometry.ts`                   | 상대/절대 좌표 변환, 접힌 문서 저장 높이, 최소 포함 섹션, pending geometry sequence·세션/화면 수명·기존 혼합 배치 저장                         |
| `ui/canvas/useCanvasClipboard.ts`                                      | native/internal 복사 식별자, 문서·그림 사본, 요청 직렬 큐, offset·중복 요청 식별자·프로젝트/화면 인정 범위                                     |
| `ui/workspace/useWorkspaceImport.ts`                                   | 가져오기 목적·확인·busy/error, PC capability, native 파일 선택의 늦은 응답 차단                                                                |
| `ui/canvas/useSelectionActions.ts`                                     | 생성한 노드가 모두 존재할 때 한 번 선택하고 필요 시 화면 맞춤. 고정 시간 지연에 의존하지 않음                                                  |
| `ui/canvas/transfer-plan.ts`, `ui/workspace/useWorkspaceTransfers.ts`  | 문서·그림의 단일 이동 트랜잭션, 이동/결과 폴더 확인 상태, flush·revision 재조회·중복 클릭 방지·늦은 응답 격리                                  |
| `ui/canvas/useCanvasNavigation.ts`, `useNoteCreation.ts`               | 캔버스 전환·viewport·입력 flush·화면 정리, 기존 서버 호환 메모 생성                                                                            |
| `ui/documents/useFileWorkflow.ts`                                      | 속성/상태 저장과 칸반 이동의 중복 방지·기존 revision/expected 값·권한·갱신 인정                                                                |
| `features/kanban/useCanvasKanban.ts`                                   | 개인 보기 설정·legacy 보기 이행·보드 배치/탐색·캔버스별 표시·문서/HTML 보기 모델                                                               |
| `ui/preview/usePreviewWindows.ts`                                      | 미리보기 창의 기존 개인 geometry 저장과 버전 나란히 보기                                                                                       |
| `ui/history/useWorkspaceHistory.ts`                                    | 목록/파일 조회 세대, 필터·선택·복원 확인·복원 busy·현재 화면 검사                                                                              |
| `ui/workspace/useWorkspaceIndex.ts`                                    | 탐색/inspector 자료, authorship/AI 기록의 취소 가능한 조회                                                                                     |
| `ui/ai/useGamejamRequest.ts`, `useAiRequestCommands.ts`, `useAiRun.ts` | 요청 폼/초안, 최종 자료 재확인·요청/승인/작업 생성, CLI 상태·실행 이벤트·준비/취소·완료/닫힘 수명. 실제 CLI 실행 업무는 기존 R06 서비스에 유지 |
| `ui/debug/useWorkspacePreview.ts`                                      | 디버그 미리보기의 샘플 상태 주입. production 업무 상태에 별도 저장소를 만들지 않음                                                             |

화면은 `WorkspaceCanvas`, `WorkspaceCanvasTools`, `WorkspaceContextMenus`, `WorkspaceHeader`, `WorkspaceSettings`, `WorkspaceInspector`, `WorkspaceAiPanels`, `WorkspaceAiDialogs`, `WorkspaceHistoryPanels`, `WorkspaceTransferDialogs`로 나뉜다. 각 화면은 typed props와 기능 콜백을 받고 해당 DOM·접근성·버튼 상태를 그린다. 동적 컴포넌트 함수를 렌더 중에 생성하지 않으므로 편집기/iframe을 재마운트하지 않는다. 기존 provider 경계·DOM 순서·클래스·CSS import 순서를 유지한다.

## 비동기 명령의 인정 범위

- `useSelectionScope`의 root/saveScope/sessionId/epoch/canvas/home/방문 순번과 `useViewLifetime`의 mounted 여부를 사용한다. A → B → A 왕복도 이전 작업의 확인을 되살리지 않는다.
- 읽기 응답·busy·확인창·선택·알림은 시작한 화면에만 반영한다. 이미 backend가 저장한 작업을 취소/되돌렸다고 보고하지 않는다.
- 히스토리 파일 읽기는 마지막 요청만 인정한다. 복원은 captured editor flush 뒤 다시 수명을 확인하고, 렌더 전에 다시 클릭해도 한 번만 시작한다.
- 드래그는 각 노드의 pending sequence를 따로 확인한다. 먼저 시작한 저장이 늦게 완료되어도 이후 드래그의 임시 좌표를 지우지 않는다. 같은 드래그의 자료 갱신이 끝난 뒤 섹션 소속 확인창을 연다. 중복 reload는 한 번으로 합쳤다.
- 문서/그림 복사본·이미지 가져오기는 실제 노드 생성 뒤 선택한다. 붙여넣기의 native 큐·copyId/contextId/requestId·32px 반복 offset·문서와 그림의 단일 배치·원래 Undo 단위를 보존한다.
- AI 준비 중 editor flush가 끝나기 전에 프로젝트 세션이 바뀌면 다른 세션에서 CLI를 시작하지 않는다. 준비 busy와 시작 ticket도 프로젝트 방문별로 격리해 이전 응답이 새 세션의 busy를 남기거나 해제하지 못하게 한다.
- `useProjectLifetime`은 같은 프로젝트의 캔버스 탭 전환을 허용하고 요청 시작 때 캡처한 AI 목적지를 유지한다. 프로젝트/세션/홈 전환과 왕복에는 만료된다. 이미 실행 중인 AI의 결과와 예약·승인 업무는 R06 서비스의 기존 규칙을 따른다.

## 갱신과 편집 상태

DocumentSaveQueue가 원본 저장 상태를 계속 소유한다. 새 전역 save store나 서버 확인본 복제본을 만들지 않는다. DocumentCard/useDocumentEditing의 IME·초안·flush·sequence를 재구현하지 않는다.

노드 조립에 들어가는 저장·히스토리 열기·속성·미리보기 geometry 콜백은 해당 수명 안에서 identity를 유지하고 실행 시 최신 port를 읽는다. UI 상태가 바뀔 때마다 전체 노드 계산을 새로 유발하지 않으며, 기존 effect의 자료 의존성과 노드별 identity 비교를 유지한다.

## 검증 연결

`tests/workspace-commands.test.mjs`의 15개 회귀는 좌표/높이/revision·최소 섹션·혼합 이동 계획, StrictMode에서 생성 선택/왕복 만료, 조회 역순, 복원 중 세션 변경/이중 클릭, 가져오기 후 프로젝트 전환, 캔버스 전환 중 늦은 조회, 동시 드래그 pending, refresh 후 소속 확인, callback identity/최신 port, AI 준비 중 세션 변경·준비 busy 격리·프로젝트 수명과 캔버스 전환을 검사한다.

실제 UI·integration·Windows package 결과와 남은 외부 환경 검증은 `REFACTORING_PLAN_2026-10-20.md` 27절을 참조한다. 기록은 `out/r05-final-*.log`, `out/r05-final-suites.json`, `out/refactoring-package-*-r05-final-2026-10-21.json`에 둔다. 모든 프로젝트·프로필은 임시/격리 자료이며 AI 실행 연동은 mock CLI다.
