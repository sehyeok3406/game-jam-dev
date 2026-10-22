# Game Jam! 서비스 확장을 위한 리팩토링 실행 계획

작성일: 2026-10-20 (KST)  
기준: C:\git\game-jam-dev, package.json v0.27.0, HEAD 81e998b 및 조사 당시 미커밋 변경사항  
상태: R00~R08 완료. R09·R10 주요 구현과 Windows 검증을 마쳤고, 완료 재검토의 오류 로그 익명화·교차 OS 복원 fixture 보완 2건도 반영했다. R09 실제 외부 S3 복구·Windows→Linux 복원, R10 실제 Linux 실행 실증은 계속 대기 중이다. 전체 완료로 보고하지 않는다. 최신 보완 결과와 남은 조건은 44절을 참조한다.

## 1. 목표와 이번 계획의 기준

목표는 **현재 개인용 앱의 기능과 데이터를 보존하면서, Render에서 운영하는 팀 협업 서비스와 향후 웹 편집기를 같은 제품으로 유지보수할 수 있게 만드는 것**이다.

제품 방향은 다음을 기준으로 한다.

- 개인은 로컬 데스크톱 앱에서 무료로 작업한다. 개인 작업을 로그인·구독·서버 연결에 종속시키지 않는다.
- 사용자는 자신의 PC에 연결된 AI CLI를 사용한다. 초기 서버는 AI 사용량 판매나 AI 실행을 담당하지 않는다.
- 유료 가치는 운영자가 제공하는 팀 협업·저장·권한·복구에 둔다. 실제 가격과 좌석 계산 방식은 별도 결정이다.
- 첫 운영 서버는 Render의 Node 서비스 1개와 영구 디스크를 사용한다.
- 웹 편집은 이후 같은 기능 API와 서버를 사용하도록 확장한다. 현재 별도 웹 뷰어의 게시·읽기 흐름은 유지한다.
- iOS는 후속 단계다. 공통 데이터·API 계약을 재사용할 수 있게 준비하되, React 화면을 SwiftUI에 그대로 재사용한다고 전제하지 않는다.
- 기존 PC 협업 서버 기능의 무료 제공 범위는 별도 제품 결정이다. 구조 정리 과정에서 기능을 제거하거나 유료로 바꾸지 않는다.

**구조의 기본 선택:** 저장소와 npm 패키지를 현재처럼 하나로 유지하고, 코드 안에서 역할을 나누는 모듈형 구조를 사용한다. 공통 규칙, 데스크톱 실행, 서버 통신, 저장, 화면을 분리한다. 패키지 수와 서비스 수를 먼저 늘리지 않는다.

첫 리팩토링에서는 Electron/React/Vite/Forge, Markdown 파일 형식, SQLite 저장 방식, 협업 프로토콜 v1을 유지한다. 새 프레임워크, CRDT, PostgreSQL, Redis, 별도 작업 서버 도입은 측정 결과나 새로운 요구가 생겼을 때 별도 작업으로 결정한다.

## 2. 조사 범위와 확인된 기준선

### 2.1 조사 방법

src, scripts, tests, tools의 파일 목록과 정적 import 관계를 조사했다. 진입점, 주요 대형 파일, 저장·복구·협업·AI·화면·패키징 흐름과 관련 테스트를 상세히 읽었다. README와 주요 구현 계획/운영 문서는 코드와 교차 확인했다.

전체 기능의 실제 사용자 조작을 전수 검증한 것은 아니다. 이번 실행 검증은 타입 검사·린트·기본 자동 테스트다. Electron UI/설치 패키지/실제 AI 계정/Render 배포/장시간 부하 검증은 실행하지 않았다.

조사 당시 소스에는 AI 예약 큐, 추론 수준, 멀티플레이, 그림 관련 미커밋 작업과 신규 파일이 있었다. 이를 포함한 현재 작업 사본을 기준으로 계획했다. 구현 착수 전에 해당 변경을 보존한 기준점을 다시 기록해야 한다.

| 항목                     | 확인 결과                                        |
| ------------------------ | ------------------------------------------------ |
| 조사 디렉터리 내 파일    | 410개                                            |
| src 코드·스타일·스크립트 | 218개, 약 75,162줄                               |
| 기본 테스트 파일         | 70개 (\*.test.mjs)                               |
| Node / npm               | 24.19.0 / 11.17.0                                |
| npm run typecheck        | 통과                                             |
| npm test                 | 439개 통과, 실패·건너뜀 0                        |
| npm run lint             | 실패: 포맷 문제 13개 파일, 별도 린트 경고 2건    |
| GitHub Actions           | 현재 저장소에서 .github 워크플로를 확인하지 못함 |

포맷 문제 파일: BUSINESS_MODEL_RESEARCH_2026-10-13.md, GENEX_COMPETITOR_ANALYSIS_2026-10-13.md, src/drawing-geometry.ts, src/drawing-model.ts, src/drawing-types.ts, src/ui/debug/uiDebugFixtures.ts, src/ui/debug/uiDebugRegistry.ts, src/ui/drawing/DrawingControls.tsx, src/ui/drawing/DrawingInputLayer.tsx, src/ui/drawing/DrawingNode.tsx, src/ui/drawing/drawing.css, tests/drawing-ui.electron.mjs, tests/drawing.test.mjs.

경고: tests/ai-queue-packaged.mjs의 미사용 click 변수, tests/mocks/discord-transport.ts의 this 별칭. 현재 기본 테스트에는 Node 모듈 형식 추론 경고도 있다. 이를 없애기 위해 package.json에 type: module을 곧바로 추가하지 않는다. Forge·CJS preload·테스트 실행 방식의 영향을 별도 확인한다.

### 2.2 현재 구조 지도

| 영역               | 주요 파일                                                                                             | 현재 역할과 리팩토링 판단                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 데스크톱 실행      | src/main.ts, preload.ts, renderer.tsx                                                                 | 창·IPC·프로젝트·협업·AI·저장·종료가 연결된다. 실행 서비스와 조립 코드를 분리한다.                  |
| 캔버스 화면        | src/ui/App.tsx, index.css                                                                             | 편집, 선택, 이동, AI 요청, 각종 팝업이 집중돼 있다. 기능별 화면과 상태를 나눈다.                   |
| 문서 편집          | ui/MarkdownEditor.tsx, markdown-editing.ts, document-links.ts, document-format.ts                     | 기존 편집·링크·IME 동작을 보존한다. 데이터 변환과 React 화면의 경계를 명확히 한다.                 |
| 저장·초안          | project-store.ts, editor-drafts.ts, document-save-queue.ts, document-save-store.ts, property-queue.ts | 충돌 검사·원자적 교체·복구 기반이 있다. 이 구현을 재사용한다.                                      |
| 개인 프로젝트 관리 | project-library.ts, project-trash.ts, project-metadata.ts, home-organization.ts                       | 로컬 경로, 암호화한 협업 세션, 홈 분류를 관리한다. 서비스 계정/팀과 분리한다.                      |
| 협업 규칙          | collaboration-model.ts, sync-properties.ts, offline-sync.ts, edit-journal.ts                          | 명령 적용·속성별 병합·실행 취소가 존재한다. 공통 업무 규칙의 출발점으로 삼는다.                    |
| 협업 클라이언트    | collaboration-client.ts, client-cache.ts, project-events.ts                                           | 재시도, SSE, 폴링, 오프라인 변경, 세션을 관리한다. 통신과 저장을 교체 가능한 경계로 만든다.        |
| 협업 서버          | collaboration-server.ts, collaboration-server-entry.ts, sync-store.ts                                 | HTTP, 권한, 큐, AI 요청 조정, SQLite, 체크포인트, 휴지통을 함께 처리한다. 서버 내부 책임을 나눈다. |
| AI 실행            | main.ts, ai-cli.ts, ai-providers.ts, ai-task-queue.ts, ai-queue-store.ts, ai-file-lock.ts             | 로컬 CLI 실행과 서버의 승인·예약이 연결된다. 실행기와 예약/검증 규칙을 분리한다.                   |
| AI 결과·작업 정의  | task-plan.ts, task-specification.ts, gamejam-\*.ts, ai-artifacts.ts, ai-task-history.ts               | 입력 고정·결과 검증·히스토리를 보존한다. UI 상태나 프로세스 제어를 섞지 않는다.                    |
| 그림·게임 UI·칸반  | drawing-_.ts, features/game-ui, game-ui-_.ts, features/kanban                                         | 이미 모델/화면 분리가 일부 존재한다. Node와 React에 독립적인 모델을 정리한다.                      |
| HTML 미리보기      | preview-_.ts, html-_.ts, ui/App.tsx                                                                   | 실행 권한·샌드박스·결과 표시를 유지한다. Electron 실행 검증은 데스크톱 경계에 둔다.                |
| 멀티플레이         | src/multiplayer/\*, multiplayer-player-preload.ts                                                     | HTTP/WS, 로비, 플레이 창, 런타임 SDK가 있다. 영속 협업 데이터와 일시적인 방 상태를 구분한다.       |
| 외부 연결          | discord-approval*.ts, discord-transport.ts, web-viewer*.ts                                            | 각각 기존 승인 서비스와 게시본을 이용한다. 공통 승인/조회 서비스를 호출하게 연결한다.              |
| PC 서버            | src/features/self-host/_, tools/internet-host/_                                                       | Windows 프로세스·터널·OS 암호화에 의존한다. 데스크톱 선택 기능으로 격리한다.                       |
| UI 확인 도구       | src/dev-api.ts, src/ui/debug/\*                                                                       | 가짜 API와 미리보기 상태를 제공한다. 운영 API와 같은 계약을 주입해 검사한다.                       |
| 빌드·배포          | forge.config.mts, vite._.config.mts, scripts/_, UPDATES.md                                            | 데스크톱/서버 결과물을 구분하고, 동일 검증 결과물 재사용 규칙을 반영한다.                          |

### 2.3 우선 해결할 결합 지점

아래 위치는 조사 당시 줄 번호다. 구현 시 함수·타입 이름으로 다시 찾는다.

| 중요도 | 근거                                                                                                    | 계획에 주는 의미                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 높음   | App.tsx 12,427줄. WorkspaceCanvas는 1904~12418줄                                                        | 화면만 옮겨도 끝나지 않는다. 프로젝트 상태·편집 초안·단축키·팝업·AI 요청의 소유자를 나눠야 한다.                                     |
| 높음   | main.ts 5,520줄. 전역 workspaceRoot/collaboration, handle() 약 2646줄, registerIpc() 약 3305줄          | 늦게 끝난 작업이 다른 프로젝트 상태를 변경하지 않도록 프로젝트 세션을 명시한다.                                                      |
| 높음   | shared.ts GameCanvasApi 최상위 멤버 131개. window.gameCanvas 직접 참조 17개 파일/221곳                  | UI가 구현 환경을 직접 고르는 구조를 RuntimeProvider로 바꾼다.                                                                        |
| 높음   | collaboration-server.ts 2,954줄. 클라이언트가 서버 파일의 타입을 import                                 | 네트워크 계약을 서버 구현에서 떼고 서버 내부를 기능별로 분리한다. 타입 import가 서버 번들을 브라우저에 포함한다는 의미는 아니다.     |
| 높음   | renderer.tsx는 운영 모드에서 Electron bridge가 없으면 오류                                              | 현재 웹 개발 미리보기는 가짜 API다. 실제 웹 편집기에는 별도 HTTP·저장 어댑터가 필요하다.                                             |
| 높음   | server는 HTTP와 WS 모두 Origin이 있으면 거부                                                            | 웹 지원 시 인증·출처·CSRF·WS 인증을 함께 설계해야 한다. 단순히 차단 조건을 삭제하면 안 된다.                                         |
| 높음   | SyncStore.load()가 전체 프로젝트와 히스토리를 복원; Map과 파일 본문→해시 캐시 사용                      | 단일 인스턴스부터 운영하고 메모리·히스토리 비용을 측정한다. 디스크만 늘려도 메모리 문제가 해결되지는 않는다.                         |
| 높음   | SQLite 외에 checkpoints, .project-lifecycle, .project-trash 사용                                        | DB 파일 복사만으로 이전·복구가 완성됐다고 판단하지 않는다.                                                                           |
| 높음   | trash-files.ts statDirectory()는 dev:ino:birthtimeMs로 디렉터리 정체성을 저장                           | 다른 디스크/Windows→Linux 복원 시 값이 달라진다. 검증된 복원 절차에서 목적지 정체성을 재등록해야 한다. 보호 검사 자체를 끄지 않는다. |
| 높음   | Member는 프로젝트별 nickname/role/tokenHash; 서비스 user/workspace/subscription은 별도 구현을 찾지 못함 | 로그인·팀·구독은 새 기능이다. 기존 프로젝트 memberId를 서비스 userId로 재해석하지 않는다.                                            |
| 중간   | 협업 26개 명령이 string channel + unknown input; local/main과 서버 적용 경로가 다름                     | 명령 계약을 구체화하고 동일 입력의 결과를 비교하는 검증을 만든다.                                                                    |
| 중간   | checkSnapshot의 500개 파일/20MB, 서버의 프로젝트 20개/멤버 20명, history 300개 제한                     | 기술 보호 한도와 유료 상품 한도를 서로 다른 설정으로 관리한다. 지금 수치를 바로 상향하지 않는다.                                     |
| 중간   | self-host와 독립 서버 빌더에 서버 번들 설정 중복; self-host 빌더가 매번 준비                            | 공통 빌드 함수와 입력 해시 기반 캐시를 두어 배포 지침과 맞춘다.                                                                      |
| 중간   | tsconfig가 DOM·Node·Electron 영역을 함께 검사, noImplicitAny만 명시                                     | 영역별 타입 검사와 import 규칙을 점진적으로 추가한다. 한 번에 전체 strict 전환은 별도 작업으로 둔다.                                 |

이미 좋은 기반도 있다. 저장 큐의 Storage/Adapter 인터페이스, 협업 명령 reducer, 속성별 버전, 명령 재전송 식별자, AI 입력 잠금, 별도 self-host 모듈, 미리보기 격리와 439개 테스트가 있다. 정적 import 조사에서 renderer 진입점의 명시적 런타임 import 경로가 Node/Electron 모듈로 이어지는 사례는 발견하지 못했다. 문제는 주로 책임의 집중과 환경 연결 방식이다.

## 3. 목표 구조와 의존성 규칙

```text
src/
  contracts/                 화면·IPC·HTTP가 공유하는 데이터/명령 계약
    project.ts, documents.ts, collaboration.ts, ai.ts
    commands.ts, capabilities.ts, app-api.ts, errors.ts
  core/                      저장이나 통신 없이 계산·검증하는 규칙
    projects/, documents/, canvas/, sync/, ai/, history/
    drawings/, game-ui/, kanban/, preview/
  application/               작업 순서와 권한·저장 경계를 조합
    ports/
    projects/, editing/, collaboration/, ai/
  adapters/
    filesystem/              로컬 파일·초안·캐시·히스토리
    sqlite/                  서버 저장소·마이그레이션
    http/                    협업 클라이언트 전송
    node/                    crypto·프로세스·CLI
  desktop/
    bootstrap.ts, lifecycle.ts, project-session.ts
    ipc/                     기존 IPC 채널의 등록과 검증
    ai/, integrations/, preview/
  server/
    bootstrap.ts, config.ts, context.ts
    http/, services/, persistence/, operations/
  ui/
    App.tsx                  앱 시작 화면 조립
    runtime/                 API·환경 능력·설정 저장 주입
    workspace/, documents/, canvas/, ai/, shell/
    debug/
  web/                       실제 웹 편집 단계에서 생성
  features/                  기존 UI 기능은 필요한 단위부터 이동
  main.ts                    기존 Forge 진입점 유지, bootstrap 호출
  preload.ts                 기존 Electron bridge 유지, 모듈별 API 합성
  renderer.tsx               desktop/preview runtime 조립
  shared.ts                  이전 import를 위한 임시 타입 재수출
  collaboration-server-entry.ts  독립 서버의 기존 진입점 유지
```

모든 폴더를 미리 채우지 않는다. 아래 작업 카드에서 실제로 옮기는 코드만 만든다. 기존 features/game-ui, drawing, kanban처럼 이미 분리된 화면은 해당 작업 때 필요한 연결만 변경한다.

**허용 방향**

- contracts는 구현 파일을 import하지 않는다. 새 공통 계약에는 Node, Electron, React 타입과 로컬 절대 경로를 넣지 않는다. 기존 WorkspaceState.root/ProjectEntry.root는 초기 bridge 호환 타입에 deprecated 필드로 유지하고, R03에서 UI가 ProjectContext를 사용하도록 옮긴다. 이전 초안 키를 읽는 동작은 별도 호환 계층에서 유지한다.
- core는 contracts와 다른 core만 사용한다. Node crypto, Buffer, 파일 읽기, fetch, Electron, React는 경계 밖으로 옮긴다.
- application은 core·contracts·ports를 사용한다. 저장과 통신의 실제 구현은 인자로 받는다.
- adapters, desktop, server가 구체적인 실행 환경을 연결한다.
- UI는 contracts·브라우저에서 실행 가능한 core·ui/runtime만 사용한다.
- desktop/server bootstrap은 조립 지점이므로 실제 어댑터를 import할 수 있다.
- 테스트와 UI 미리보기는 같은 계약을 구현한 fixture를 주입한다.
- 이전 파일의 재수출은 호환을 위한 임시 장치다. 새 코드의 import 대상으로 사용하지 않으며, 해당 이행 작업 종료 시 정리한다.

기존 파일의 모든 타입까지 첫날 이동하지 않는다. 새 contracts와 core에는 엄격한 규칙을 적용하고, legacy 예외는 파일별로 명시한 목록을 줄여 나간다. 파일 길이는 분리 우선순위를 알려주는 신호이며 완료 기준은 책임·의존성·검증 결과다.

## 4. 먼저 고정할 계약

### 4.1 플랫폼 능력, 사용자 권한, 구독 권한

세 개념을 분리한다.

| 구분                                          | 예시                                    | 판정 주체             |
| --------------------------------------------- | --------------------------------------- | --------------------- |
| ClientCapabilities: 환경에서 할 수 있는 일    | 로컬 폴더 열기, CLI 실행, 자동 업데이트 | desktop/web runtime   |
| ProjectAccess: 현재 사용자의 프로젝트 권한    | 읽기, 편집, 멤버 관리, AI 승인          | 로컬 서비스 또는 서버 |
| WorkspaceEntitlements: 구독으로 제공하는 기능 | 운영 서버 팀 협업, 저장 한도, 보관 정책 | 운영 서버             |

화면은 이 값을 받아 버튼 상태를 표시한다. 서버는 각 요청의 권한을 다시 확인한다. 브라우저에서 canEdit 또는 paid 값을 바꿔도 서버 권한이 바뀌지 않는다.

ClientCapabilities의 첫 필드는 localFiles, localAiExecution, selfHostManagement, appUpdates, nativeClipboard, multiplayer로 한다. 이 값은 결제 권한을 나타내지 않는다. AccessPolicy의 최소 입력은 검증된 actor, 서버 서비스 모드, project, workspace membership, entitlements, 요청 action이다. 결과는 allowed와 안정된 reason code이며 UI는 이유를 사용자 문구로 표시한다.

| 모드/작업                       | 접근 판단                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| local 개인 편집·AI              | 기존 로컬 정책과 실행 가능 상태. 서비스 로그인/구독 조회 없음    |
| self-host 공동 편집             | 기존 프로젝트 member/role/lock/lease 정책                        |
| managed 팀 읽기/내보내기        | 유효 user + workspace membership + project read 권한             |
| managed 팀 쓰기                 | 위 조건 + editor/admin 권한 + 서버의 유효한 협업 entitlement     |
| managed AI 승인/claim/결과 반영 | 기존 관리자 실행 정책 + 해당 팀 권한 + 실행별 claim/lease 재검사 |
| 모든 모드의 입력·자원 한도      | 해당 실행 환경의 기술 보호 한도는 항상 적용                      |

실제 정책 적용은 R07의 기존 권한 분리 후 F01/F02에서 추가한다. 개인 구독 여부를 판별하기 위해 오프라인 편집마다 서버에 요청하지 않는다.

### 4.2 UI에 제공할 실행 환경

최종 그룹과 점진 이행 방식을 다음처럼 고정한다. 아래 코드는 구현할 계약의 개략이며 현재 소스에 추가된 구현은 아니다.

```ts
type AppRuntime = {
  api: AppApi;
  capabilities: ClientCapabilities;
  preferences: PreferenceStore;
};

type AppApi = {
  projects: ProjectApi;
  editor: EditorApi; // 문서·캔버스·그림·게임 UI·칸반
  saves: SaveApi; // 기존 DocumentSaveQueue 상태/flush
  collaboration: CollaborationApi;
  ai: AiApi; // 요청/승인/실행 상태, 로컬 실행은 별도 능력
  history: HistoryApi;
  preview: PreviewApi;
  desktop?: DesktopApi; // 폴더·업데이트·PC 서버·OS 연결
};
```

첫 이행에서는 createDesktopRuntime(window.gameCanvas)가 기존 API를 그룹별로 감싼다. 기존 preload 채널명과 반환값은 유지한다. UI의 직접 전역 호출을 useRuntime()으로 옮긴 후 main 내부를 분리한다.

대략적인 기존 메서드 배치:

- projects: list/open/create/rename/move/trash/restore 및 홈 폴더.
- editor: 문서·섹션·캔버스·그림·게임 UI·칸반·자료 가져오기.
- saves: drafts 및 document-saves 관련 메서드와 이벤트.
- collaboration: 연결/참여/재접속/역할/잠금/오프라인 충돌.
- ai: 제공자 상태, 요청함, 예약, 실행·취소, 실행 이벤트.
- desktop: update, reveal/open-folder, selfHost, testUsers, Discord 설정, 로컬 게시 연결.
- preview: HTML 조회/실행 표시와 multiplayer. 플랫폼별 실제 실행은 adapter가 담당.

Web runtime의 미지원 동작은 명확한 unsupported 결과와 UI 안내로 처리한다. 성공한 척하는 빈 함수를 기본 구현으로 두지 않는다.

### 4.3 프로젝트 세션

```ts
type ProjectSessionRef = {
  projectKey: string;
  sessionId: string;
  epoch: number;
};

type ProjectContext = {
  ref: ProjectSessionRef;
  mode: 'local' | 'shared';
  projectId: string;
  workspaceId?: string;
  signal: AbortSignal;
};
```

- projectKey는 로컬 경로나 서버 URL과 UI가 직접 조합하지 않도록 중앙에서 만든다.
- localRoot, 협업 token, recoveryKey는 desktop의 비공개 세션에 남긴다.
- 세션을 전환하면 epoch를 증가시키고 이전 구독·SSE·watcher·타이머를 해제한다.
- 큐에 넣을 때의 세션과 작업을 수행할 때의 세션이 같은지 검사한다. 완료 이벤트에도 프로젝트 식별자를 붙인다.
- 기존 saveScope, draft key, localStorage 키는 첫 단계에서 그대로 생성한다. 내부 이름 변경 때문에 초안이 사라지지 않도록 한다.
- 장기 실행 AI는 자신이 시작된 프로젝트 컨텍스트를 가진다. 전환 시 중지 여부는 기존 UX를 유지하며, 새 프로젝트 화면에 이전 결과를 적용하지 않는다.

### 4.4 명령, 저장, 통신 경계

현재 collaboration-model.ts의 commandLabels에 있는 **26개 명령 전체**를 CommandMap의 대상으로 한다. 첫 수직 단위는 documents:save이며, 이후 layout → 문서/섹션 → 캔버스/그림/게임 UI/칸반 → 자료/결과/작업 생성 순으로 이행한다.

```ts
type CommandSpec<I, O> = { input: I; output: O };

type CommandMap = {
  'documents:save': CommandSpec<SaveDocumentInput, void>;
  // 나머지 25개는 현재 반환값을 대조해 채운다.
};

type DomainServices = {
  newId(): string;
  now(): number;
  sha256Utf8(text: string): string;
};
```

실제 CommandMap은 일부 명령만 가진 상태로 완료 처리하지 않는다. 이 Map은 reducer/협업 명령의 반환값을 표현한다. 현재 documents:save reducer는 별도 result가 없고, main의 IPC 경로가 저장 후 CanvasDocument를 구성해 반환한다. 이 두 계약을 섞지 않는다. 기존 반환값이 void인 명령은 void로 유지하고, UI의 EditorApi.saveDocument는 기존대로 Promise<CanvasDocument>를 반환한다.

**요청 처리 순서:** 외부 입력 검증 → 인증된 actor 결정 → 현재 권한/기술 한도 확인 → 프로젝트 큐 진입 → 권한·버전·AI 잠금 재검사 → 명령 적용 → 전체 불변 조건 검사 → 영속 저장 → 메모리/이벤트/응답 반영.

기존 commandId, sessionId, sequence, revision, propertyVersions, deltaVersion은 유지한다. 재전송은 같은 식별자를 사용하며, 이미 처리된 요청에 새 히스토리를 추가하지 않는다.

저장 경계는 용도별로 둔다.

- LocalProjectRepository: capture/apply/history/recover. 기존 파일 보호·충돌 검사·복구 저널을 내부에서 이용한다.
- CollaborationProjectRepository: loadAll/load/commit/purge/backup. 첫 구현은 기존 SyncStore를 감싼다.
- DocumentSaveStorage: 기존 인터페이스를 그대로 활용한다.
- CredentialStore: safeStorage 기반 데스크톱 구현. 서버·UI에 개인 AI 인증을 전달하지 않는다.
- CollaborationTransport: JSON 요청·SSE 구독·취소·오류 해석.
- AiExecutor: 설치/로그인 상태, 실행, 취소, 이벤트. 실제 CLI 자격증명은 해당 PC에 남는다.

core로 옮길 함수가 동기 해시를 사용한다면 동기 DomainServices를 주입한다. Web Crypto의 비동기 digest를 무리하게 동기 함수처럼 대체하지 않는다. 해당 계산을 서버에서 수행하거나, 웹 단계에서 검증된 브라우저 구현을 선택한다. Buffer 기반 바이트 계산/이미지 인코딩과 Markdown 파서의 브라우저 번들도 별도 점검한다.

## 5. 구현 순서와 작업 카드

크기 S/M/L은 상대적인 변경 범위다. 일정 확약이나 작업 시간 추정이 아니다. 하나의 카드가 크면 표시된 하위 단위로 나눠 각각 검증한다.

| 작업 | 내용                                  | 선행     | 크기 |
| ---- | ------------------------------------- | -------- | ---- |
| R00  | 현재 기준선·검증 방식 기록            | 없음     | S    |
| R01  | 공개 타입·명령·능력 계약 분리         | R00      | M    |
| R02  | UI RuntimeProvider·가짜 API 주입      | R01      | M    |
| R03  | 프로젝트 세션과 수명 관리             | R01      | L    |
| R04  | 편집 명령·저장 서비스와 IPC 분리      | R01, R03 | L    |
| R05  | App.tsx와 CSS의 기능별 분리           | R02, R03 | L    |
| R06  | AI 실행기·예약·외부 연결 분리         | R03, R04 | L    |
| R07  | 협업 서버의 HTTP/업무 처리 분리       | R01, R04 | L    |
| R08  | 서버 저장소·스키마·휴지통 경계 정리   | R07      | M    |
| R09  | 일관된 백업·복원·이전 도구            | R08      | L    |
| R10  | Linux 검증·Render 배포 설정·운영 문서 | R07~R09  | M    |

권장 작업 순서는 R00 → R01 → R02 → R03 → R04 → R05 → R06 → R07 → R08 → R09 → R10이다. Render 제한 베타를 먼저 검증할 경우 R05/R06의 전체 분리는 후속으로 옮길 수 있다. 그 경우에도 아래 서버 검증 조건과 기존 데스크톱 회귀 검증은 유지한다.

### R00. 현재 동작을 기준선으로 남긴다

**수정/생성:** docs/architecture/baseline.md, docs/architecture/regression-matrix.md, 필요 시 package.json의 검증 명령. 기존 미커밋 코드는 별도 변경을 덮어쓰지 않고 보존한다.

1. HEAD·작업 사본 차이·Node/npm·실행한 검사 결과를 기록한다. 현재 미커밋 신규 파일을 빼고 기준 소스를 만들지 않는다.
2. 기존 포맷 13건은 진행 중인 기능 변경과 구분된 수정 단위로 처리한다. 해당 파일만 포맷하고 기능 diff가 생기지 않았는지 확인한다.
3. 보존할 동작을 시나리오별로 연결한다: 로컬 저장/재시작, 한글 조합, 공동 저장/충돌, 오프라인 재연결, AI 승인/취소, 프로젝트 휴지통/복원, 그림/게임 UI, 멀티플레이, 앱 종료/업데이트.
4. 테스트는 임시 데이터·임의 포트·격리 프로필을 사용한다. 운영 서버·사용자 로그인·실제 프로젝트는 baseline fixture로 가져오지 않는다.

**완료:** 타입·기본 테스트·린트 통과 여부를 재현할 수 있고, 새 실패와 기존 실패가 구분된다. 리팩토링 과정에서 깨진 검사를 기존 실패라고 넘기지 않는다.

### R01. 공개 계약을 구현 파일에서 떼어낸다

**현재:** shared.ts, project-store.ts의 Snapshot, collaboration-server.ts의 CollaborationCommand/Envelope, ai-task-queue.ts, gamejam-approval.ts, multiplayer/types.ts.

**생성:** src/contracts/project.ts, documents.ts, canvas.ts, collaboration.ts, commands.ts, ai.ts, capabilities.ts, app-api.ts, errors.ts. 기능별 타입은 필요한 파일로 나눈다.

1. Snapshot과 데이터 전달 타입을 옮긴다. shared.ts와 기존 export 위치에는 임시 type 재수출을 둔다.
2. 기존 131개 API 멤버를 누락 없이 그룹에 매핑한다. 멀티플레이·selfHost·Discord 같은 중첩 API도 포함한다.
3. 26개 편집 명령의 입력/출력 타입과 외부 입력 validator를 명시한다. 기존 reducer 검증을 재사용하며 의미가 같은 검사를 별도로 다시 쓰지 않는다.
4. 서버의 /health와 상태 응답에 중복된 기능 지원 값을 server/capabilities.ts 한 곳에서 생성한다. 기존 wire 필드명과 값은 유지한다.
5. 새 계약은 구현 타입을 역참조하지 않도록 정적 검사한다. 기존 오류 코드도 유지한다.

**검증:** 타입 검사, 계약 직렬화/오류/지원 기능 회귀, 기존 협업·속성 동기화 테스트. 검증 테스트는 단순 export 존재 여부보다 구버전 형태의 요청/응답을 실제 읽고 처리하는 사례를 사용한다.

**완료:** 클라이언트·캐시의 계약 타입이 서버 구현에서 독립되고, 기존 IPC/HTTP 소비자가 동일한 데이터를 받는다.

### R02. 화면에 API를 주입한다

**현재:** renderer.tsx, preload.ts, dev-api.ts, ui/App.tsx, 직접 window.gameCanvas를 쓰는 17개 파일, ui/debug/\*.

**생성:** ui/runtime/RuntimeProvider.tsx, desktop-runtime.ts, preview-runtime.ts, preferences.ts. dev-api는 역할별 fixture로 단계적으로 나눈다.

1. createDesktopRuntime에서 기존 bridge를 감싸고 useRuntime()을 만든다.
2. App와 Home부터, 협업·AI·그림·게임 UI·업데이트·휴지통 화면까지 전역 API 참조를 이행한다.
3. 선택 기능은 capabilities와 optional desktop API로 표시한다. 일반 문서 편집 화면에서 Electron 유무를 직접 판별하지 않는다.
4. localStorage 접근은 PreferenceStore에 모으되 기존 키를 유지한다. 실제 미리보기에서는 메모리 구현을 사용한다.
5. UI 디버깅 콘솔의 fake API도 같은 Provider로 주입한다. 네트워크·클립보드·실제 프로젝트 쓰기 차단은 보존한다.
6. 개발 API가 제품의 두 번째 업무 로직이 되지 않게, 단순 상태 fixture와 공통 모델 호출 중심으로 정리한다.

**검증:** npm run test:ui-debug, npm run test:ui-review 및 해당 UI 테스트. 현재 test:ui-debug의 --built 실행은 runner 자체가 out/ui-debug-build를 빌드하므로 같은 폴더를 사용하는 검사와 순서를 지킨다. 미리보기에서 파괴적 동작·네트워크 호출이 차단되는 기존 테스트를 유지한다.

**완료:** UI 실행 환경을 Provider 한 곳에서 교체할 수 있다. 운영 화면의 직접 window.gameCanvas 참조는 runtime 조립 지점 외에는 없어야 한다.

### R03. 프로젝트 전환과 종료의 책임을 명확히 한다

**현재:** main.ts의 workspaceRoot/collaboration/watcher/saveScope/cache/queue 전역 상태, attachCollaboration/leaveCollaboration/setWorkspace, createWindow의 저장 종료 처리.

**생성:** desktop/project-session.ts, desktop/lifecycle.ts, application/projects/project-session.ts.

1. 파일 시스템 경로와 자격증명을 가진 비공개 세션 객체를 만든다. UI에는 공개 ProjectContext만 전달한다.
2. 현재 프로젝트를 바꾸는 단일 진입점을 만든다. 기존 property flush → draft/save checkpoint → client/cache 정리 순서를 먼저 테스트로 고정한다.
3. 파일 watcher, SSE, polling, AI 진행 알림, 저장 상태 구독의 해제 함수를 세션이 소유한다.
4. 늦게 끝난 읽기/붙여넣기/AI 결과가 전환 후 프로젝트를 수정하지 않도록 epoch·scope를 검사한다.
5. 앱 닫기, 홈 복귀, 업데이트 재시작은 같은 종료 서비스에 각기 다른 intent를 전달한다. 기존 사용자 확인과 저장 실패 처리를 유지한다.

**검증:** tests/main-flow-runner.ts, workspace-offline.test.mjs, document-save-queue.test.mjs, ai-task-queue.test.mjs, autosave UI, 업데이트/종료 관련 검증. 느린 저장 중 프로젝트 전환·완료 후 이전 결과 도착·중복 이벤트 구독을 추가 회귀 사례로 둔다.

**완료:** 저장·AI 작업의 소속 프로젝트가 명시되고, 전환/종료 경로에서 같은 자원을 중복 종료하거나 누락하지 않는다. 기존 초안과 세션 파일을 그대로 읽는다.

### R04. 편집 서비스와 IPC를 분리한다

**현재:** main.ts handle/registerIpc, collaboration-model.ts, project-store.ts, document-save-queue.ts, document-workflow.ts, canvas-sheet-commands.ts, sync-properties.ts.

**생성:** application/editing/command-service.ts, application/ports/local-project-repository.ts, adapters/filesystem/\*, core/editing 또는 기능별 core 하위 폴더, desktop/ipc/{documents,canvas,projects,history,collaboration}.ts.

1. 먼저 documents:save 한 경로를 UI → IPC → application → 저장소로 연결한다. 로컬/공동/오프라인 결과를 비교한 뒤 확장한다.
2. 로컬의 즉시 파일 변경과 서버의 snapshot reducer 차이를 조사해 같은 명령의 공통 계산 부분을 추출한다. 로컬 외부 파일 수정 감지는 유지한다.
3. 문서/섹션/캔버스/그림/게임 UI/칸반/파일 가져오기/결과 이동 명령을 그룹별로 이행한다.
4. 기존 partial capture, 레이아웃 합치기, HTML 미재전송 등 최적화가 전체 스냅샷 처리로 퇴행하지 않게 한다.
5. IPC는 발신자 검사·입력 검사·서비스 호출·오류 반환만 맡는다. raw fs, 구독 판정, CLI 실행을 handler 안에 추가하지 않는다.
6. 멀티플레이 preload, selfHost, Discord의 별도 발신자·비밀 값 처리는 각각의 등록 모듈로 옮겨 보존한다.

**검증:** 로컬/공동에 같은 명령을 적용해 파일 본문·참조·히스토리 의미를 비교한다. ID·시각은 테스트 주입값으로 고정한다. 기존 26개 명령 각각의 주요 성공/충돌 사례, 기본 테스트, integration, autosave UI를 연결한다.

**완료:** 편집 업무 규칙 수정은 해당 core/application에 모이고, main의 편집 관련 코드는 서비스 조립과 IPC 등록에 집중된다. 파일 삭제·자료 가져오기·HTML 결과 이동의 원자성 및 되돌리기를 유지한다.

### R05. 화면과 스타일을 기능별로 분리한다

진행 상태: **구현·검증 완료**. 문서/편집/미리보기·CSS는 15절, 요청/패널/선택/섹션/접기와 잔여 조립 완료는 22~27절을 참조한다.

**현재:** ui/App.tsx, index.css, ui/MarkdownEditor.tsx, ProjectHome.tsx, features/game-ui, ui/drawing, features/kanban.

**생성하는 첫 단위:**

| 추출 대상                   | 목적지                                                | 반드시 같이 옮길 책임                           |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| ProjectImage / DocumentCard | ui/documents/ProjectImage.tsx, DocumentCard.tsx       | 이미지 상태, 편집 세션, 문서별 저장 상태        |
| DocumentCard 저장 연결      | ui/documents/useDocumentEditing.ts                    | IME 조합, flush, 충돌, sequence, 초안 복구      |
| SectionCard / PreviewCard   | ui/canvas/SectionCard.tsx, ui/preview/PreviewCard.tsx | 노드 데이터 계약, 샌드박스, 전체화면, 실행 상태 |
| WorkspaceCanvas의 자료 읽기 | ui/workspace/useWorkspaceData.ts                      | 프로젝트/epoch, 증분 갱신, 구독 해제            |
| 캔버스 조작                 | ui/canvas/useCanvasSelection.ts, useCanvasCommands.ts | 선택·드래그·좌표·키보드·그룹 명령               |
| AI 요청 창                  | ui/ai/useGamejamRequest.ts, GamejamRequestFlow.tsx    | 단계별 입력, 검증, 초안, 승인 수정              |
| 창·패널 열기                | ui/shell/usePanelState.ts, WorkspacePanels.tsx        | 열림 상태, 포커스 복귀, Escape, z-index         |
| 프로젝트 앱 조립            | ui/workspace/WorkspaceScreen.tsx                      | 위 기능과 기존 drawing/game-ui/kanban 훅 연결   |

1. 각 화면 단위의 props와 콜백을 먼저 정리한 뒤 이동한다. 100개 상태를 한 Context에 옮기는 것으로 완료하지 않는다.
2. 문서 원본, 편집 중 초안, 서버 확인본, 선택/뷰 상태의 소유자를 구분한다. DocumentSaveQueue가 가진 저장 상태를 별도 UI 전역 저장소에서 복제하지 않는다.
3. 기존 Zustand 의존성을 이유로 모든 useState를 바꾸지 않는다. 공유가 필요한 상태만 좁은 store/context로 둔다.
4. index.css는 tokens.css, base.css, shell.css와 기능별 스타일로 나눈다. 기존 import 순서·선택자 우선순위를 먼저 보존한다.
5. 기존 테마 변수와 drawing/game-ui/kanban 스타일을 이용한다. 디자인 변경과 구조 이동은 다른 변경 단위로 한다.
6. UI 디버깅 카탈로그에 기존 모든 상태를 연결하고, 로딩/오프라인/충돌/권한 제한/실행 대기 화면을 검증한다.

**검증:** autosave, canvas-selection, document-links, drawing, game-ui, html-preview UI 및 ui-review. 한글 입력 중 저장/프로젝트 전환, 드래그 취소, 전체화면 진입 시 게임 재시작 여부를 확인한다. dark/light와 최소 창 크기 980×640을 포함한다.

**완료:** App는 앱·화면 조립을 맡고, 기능 수정을 해당 모듈에서 처리할 수 있다. 편집기 재마운트·포커스 초기화·전체 캔버스 과도한 갱신이 새로 발생하지 않는다.

### R06. 개인 AI 실행과 예약·승인 규칙을 분리한다

진행 상태: **구현·검증 완료**. 공급자/실행기 및 예약·승인·desktop 경계는 16절, 실행 coordinator와 최종 검증은 17절을 참조한다. 실제 공급자 계정과 외부 서비스의 운영 검증을 뜻하지 않는다.

**현재:** main.ts의 findCodexExecutable/getCodexStatus/startCodexRun/prepareCodexRun/pumpAiQueue, ai-cli.ts, ai-providers.ts, ai-file-lock.ts, ai-task-queue.ts, ai-queue-store.ts, gamejam-_.ts, discord-approval_.ts.

**생성:** application/ai/run-service.ts, queue-service.ts, approval-service.ts, adapters/node/ai/{codex,claude,gemini}.ts, desktop/ai/process-runner.ts, stage-workspace.ts, desktop/integrations/\*.

1. 제공자 목록·모델 선택 데이터와 CLI 실행 인자/출력 파서를 분리한다.
2. 공통 AiExecutor 경계에 상태 확인·실행·취소를 둔다. 각 provider adapter는 현재 권한 제한·사용자 설정 격리·로그 해석을 유지한다.
3. run-service는 입력 확정 → 실행 공간 준비 → 실행 → 결과 검증 → 원자적 반영 → 히스토리 정리를 담당한다.
4. queue-service는 durable 예약과 claim/lease의 소유권을 관리한다. 기존 FIFO, 파일 읽기/쓰기 예약, 중복 claim 방지를 그대로 사용한다.
5. provider와 무관한 새 타입/서비스 명칭은 AiRun으로 한다. 기존 CodexRunEvent·codex:\* IPC와 저장된 값은 호환 alias/adapter로 유지한다.
6. Discord는 같은 ApprovalService를 사용한다. 봇 token·OS 암호화·메시지 전송은 데스크톱 연결 모듈에 남긴다.
7. SelfHostService, AppUpdateController, WebViewerService도 desktop/bootstrap에서 명시적으로 만들고 해제한다. 기능별 종료 순서와 에러 처리를 테스트한다.

```ts
interface AiExecutor {
  inspect(): Promise<AiConnectionStatus>;
  run(
    input: PreparedAiRun,
    signal: AbortSignal,
    emit: (event: AiRunEvent) => void,
  ): Promise<AiExecutionResult>;
}
```

PreparedAiRun은 승인된 taskId, provider/model 설정, 해당 실행의 stage 경로와 입력 명세를 가진다. 원본 프로젝트를 임의로 탐색하는 권한을 추가하지 않는다. 서버의 승인/예약 성공이 AI 실행 완료라는 뜻이 되지 않도록 상태를 분리한다.

**검증:** npm run test:ai-queue, test:ai-queue:ui, test:ai-dismissal, test:gamejam-approval, test:gamejam-validation, test:gamejam-history, node tests/run-discord-approval.mjs 및 관련 기본 테스트. mock CLI의 성공은 실제 공급자 로그인 검증과 구분해 기록한다.

**완료:** AI 정책 변경에 main의 프로세스·저장·승인 코드를 동시에 수정할 필요가 없다. 관리자 PC가 꺼지면 요청은 대기하고 서버가 개인 CLI를 대신 실행하지 않는다. 새 AI 병렬 실행 수나 권한 우회는 이 리팩토링에서 추가하지 않는다.

### R07. 협업 서버를 조립·전송·업무 처리로 나눈다

**완료:** 2026-10-22 기준, HTTP 입력·응답·오류/router, health/events route와 SSE 연결 수명(28절), 프로젝트 큐·접근 정책(29절), 명령 서비스(30절), 프로젝트·멤버 관리(31절), 승인 요청 관리(32절), 승인/AI 시작·예약/claim(33절), 실행 중 AI 수명·결과 반영/예약 취소·만료/승인 최종 상태(34절), 오프라인 변경 반영(35절), 히스토리/복원(36절), 프로젝트 수명·휴지통(37절), 상태 조회·편집 잠금·응답 조립(38절), 나머지 route/bootstrap·HTTP adapter(39절)를 구현·검증했다. 전체 자동 검사 864개와 동일 최종 Windows package의 6개 suite가 통과했다.

**현재:** collaboration-server.ts는 기존 공개 진입점을 유지한다. server/bootstrap.ts가 인스턴스 context·서비스·HTTP/WS·종료 수명을 조립한다. 프로젝트 요청은 큐 안의 현재 인증/공통 검사와 기능별 서비스로 분리했고, 각 서비스는 필요한 port만 받는다. 기존 SQLite 시작 복원/persist/checkpoint/marker 연결은 R08 경계로 남겼다. 운영 프록시별 rate limit 보완·readiness/draining은 R10에서 검증하며 이번에는 기존 정책을 보존했다.

**생성:**

- server/bootstrap.ts, context.ts, capabilities.ts.
- server/http/router.ts, request.ts, response.ts, errors.ts.
- server/http/routes/{health,projects,members,commands,history,approvals,ai,events,multiplayer}.ts.
- server/services/{project-service,command-service,approval-service,ai-coordinator,offline-sync-service,offline-changes,history-service,lifecycle-service}.ts.
- server/services/project-queue.ts, access-policy.ts.
- adapters/http/collaboration-transport.ts.

1. createCollaborationServer(options)의 외부 호출 형태와 return의 server/port/close는 유지한다.
2. 먼저 HTTP 입력·응답·오류와 routes를 추출한다. 현재 경로·상태 코드·token 방식·SSE 이름을 바꾸지 않는다.
3. 각 서비스에 repository, 프로젝트 큐, policy, clock/id 공급자, 이벤트 발행기를 주입한다. 필요 없는 서버 전체 context를 매번 넘기지 않는다.
4. actor는 인증 결과에서 얻는다. route body의 memberId/workspaceId/role 값을 권한 근거로 쓰지 않는다.
5. 권한, revision, 잠금, 중복 요청 receipt를 큐 안에서 다시 검증한다. 저장 성공 전에 성공 이벤트를 보내지 않는다.
6. SSE 알림이 유실돼도 revision 기반 조회로 복구할 수 있게 기존 폴링·delta fallback을 유지한다.
7. 멀티플레이 방은 기존처럼 메모리에서 관리한다. 재배포 시 게임이 종료될 수 있음을 UI 상태로 전달하고, 문서 데이터 복구와 구분한다.
8. rate limit은 초기 기존 정책을 보존한 뒤 운영 모드에 맞게 별도 보완한다. Render 프록시 뒤에서 remoteAddress가 여러 사용자를 대표할 수 있으므로 인증 사용자/프로젝트별 한도와 서버 전체 한도를 분리한다. 임의 X-Forwarded-For를 무조건 신뢰하지 않는다.

**검증:** collaboration.test, collaboration-network.test, property-sync.test, workspace-offline.test, document-links-collaboration.test, ai-task-queue.test, gamejam-approval.test, multiplayer\*.test. 두 프로젝트 동시 명령, 권한 회수 직후 저장, 같은 요청 재전송, 저장 실패 후 재시도를 포함한다.

**완료:** 기존 클라이언트가 수정 없이 분리된 서버에 연결되고, 저장·권한 서비스는 HTTP 없이도 테스트할 수 있다. 엔드포인트 경로만 나누고 전역 상태를 모두 공유하는 형태로 끝내지 않는다.

### R08. SQLite 저장과 파일 복구 자료의 책임을 정리한다

**완료:** 2026-10-22. repository/SQLite adapter·schema 0→1 migration·읽기 전용 조회·checkpoint/lifecycle 저장 책임을 분리했다. DB commit 이후 복구 파일 오류를 성공 응답과 분리했고, 수명 candidate의 저장 실패 격리와 receipt 제거 후 세션 순번 보호를 검증했다. 전체 자동 882개 및 같은 최종 Windows package의 전용 검사+기존 6개 suite가 통과했다. 상세 증거·성능 측정과 후속 캐시 최적화는 40절에 기록했다.

**현재:** sync-store.ts, server의 persist/checkpoint/exportCheckpoint/maintainTrash, trash-files.ts, readSyncFiles를 사용하는 web-viewer-source.ts 및 self-host/service.ts.

**생성:** application/ports/collaboration-project-repository.ts, adapters/sqlite/project-repository.ts, migrations.ts, server/persistence/{checkpoint-store,lifecycle-store}.ts.

1. 첫 저장소 adapter는 기존 blobs/projects/project_tombstones 테이블과 프로젝트 JSON을 유지한다.
2. 스키마 버전 0의 현재 DB를 읽고, version 1부터 migration 기록을 관리한다. 예상보다 새로운 스키마는 쓰기 전에 명확하게 중단한다.
3. 프로젝트 파일·히스토리·요청 처리 receipt를 한 트랜잭션으로 저장하는 기존 성질을 보존한다.
4. DB commit 실패와 commit 이후 체크포인트 export 실패를 구분한다. export 실패를 이유로 이미 저장된 명령을 새 ID로 다시 적용하지 않는다.
5. SQLite가 데이터의 기준이며 체크포인트는 복구용이다. 오래된 폴더가 DB에 없는 삭제 프로젝트를 되살리지 못하도록 tombstone과 lifecycle을 보존한다.
6. readSyncFiles는 repository의 읽기 전용 조회로 연결한다. 게시본에는 세션·복구 키·AI 개인 인증이 들어가지 않는다.
7. history 300, receipt 500, 파일/프로젝트 한도는 기존 값으로 시작해 ServerLimits에 모은다. receipt 보관 한도를 넘는 오래된 요청은 revision/sequence로 안전하게 거절하는 동작까지 검증한다.
8. 현재 전체 로드·본문 해시 캐시의 RSS, DB 크기, 시작 시간, 저장 비용을 측정한다. 메모리 증가 문제가 확인되면 다음 최적화 PR에서 lazy loading/bounded cache/history 조회 분리를 적용한다.

```ts
interface CollaborationProjectRepository {
  loadAll(): Promise<StoredProject[]>;
  load(id: string): Promise<StoredProject | null>;
  commit(project: StoredProject): Promise<void>;
  tombstone(id: string): Promise<number | undefined>;
  purge(id: string, version: number): Promise<void>;
  close(): Promise<void>;
}
```

commit은 DB 쓰기 완료를 뜻한다. 호출부의 프로젝트 큐를 대체하지 않는다. 비동기 인터페이스 안에서도 SQLite 트랜잭션 도중 외부 네트워크를 기다리지 않는다. 새 adapter 도입 후에도 테스트에서 동시 프로젝트 쓰기와 실패 롤백을 확인한다.

**검증:** 기존 DB 모양의 인공 fixture에서 열기/수정/재시작/휴지통/복원/완전 삭제, commit 실패 주입, 깨진 blob, export 실패, 미지원 스키마. 과거 사용자 데이터를 직접 테스트 fixture로 저장하지 않는다.

**완료:** 저장소를 교체할 경계가 생기고 데이터 형식은 유지된다. PostgreSQL 전환 시 필요한 계약은 보이지만, 실제 전환 구현은 이 카드에 포함하지 않는다.

### R09. 백업·복원·Windows→Linux 이전을 구현한다

**현재 상태:** 2026-10-22. 구현과 Windows 로컬/패키지 검증을 마쳤고, 실제 외부 S3·Linux 복원 실증은 대기 중이다. 사용자가 현재 외부 저장소가 없으므로 해당 실증을 남기도록 지정했다. R09의 전체 완료 조건을 충족했다고 보고하지 않는다. 상세 구현·검사·남은 조건은 41절과 `docs/operations/backup-restore.md`를 따른다.

**생성:** server/operations/{backup,restore,migrate-host,maintenance}.ts, application/ports/backup-target.ts, adapters/backup/{local-target,s3-target}.ts, scripts/{backup-collaboration,restore-collaboration,verify-collaboration-backup}.mjs, docs/operations/backup-restore.md.

운영 중 예약 백업은 서버 프로세스 안의 BackupService가 현재 repository와 maintenance gate를 사용한다. CLI 도구는 서버가 중지된 데이터 디렉터리에서 실행하는 것으로 시작하며, 동일 디렉터리의 writer 잠금을 획득하지 못하면 중단한다. restore/migrate 도중 서버를 동시에 시작할 수 없게 한다. 실행 중 서버에 대한 별도 관리 API는 첫 구현에 필요하지 않다.

**백업 단위와 일관성**

- DB는 Node의 sqlite.backup API로 일관된 사본을 만든다. 운영 중인 sync.sqlite만 일반 파일 복사하지 않는다. 현재 로컬 Node 24.19.0에서도 API 존재를 확인했다. [Node 24 SQLite 공식 문서](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).
- DB와 lifecycle/checkpoint/trash 파일을 함께 다룰 때는 maintenance gate로 새로운 영속 변경을 잠시 막고 진행 중 큐·체크포인트·휴지통 작업을 정리한 뒤 한 세대의 백업을 만든다. 동시에 별도 작업이 archive를 바꾸지 못하게 한다.
- gate 중 쓰기에는 재시도 가능한 상태를 반환하고, 클라이언트가 동일 commandId와 초안을 유지하는지 검사한다. 복사 전 디스크 여유와 최대 정리 대기 시간을 검사하며, 실패 시 gate를 반드시 해제한다. 업로드된 archive를 로컬에 무제한 중복 보관하지 않는다.
- 완료된 DB 사본, 프로젝트 복구 파일, .project-lifecycle, .project-trash, manifest를 묶는다. .multiplayer-diagnostics는 운영 진단용 선택 항목이며 데이터 복구의 필수 원본과 구분한다.
- manifest에는 backupId, 생성 시각, app/schema/protocol 버전, projectId, revision, lifecycle, 상대 경로·크기·SHA-256을 기록한다. 경로는 목적지 안에 있어야 하며 symlink/junction과 중복·탈출 경로를 거절한다.
- 임시 백업을 검증한 후 완료 이름으로 원자적으로 전환한다. 실패/중단된 임시 파일은 사용 가능한 백업 목록에 올리지 않는다.
- 백업 생성이 끝나면 서비스 쓰기를 재개하고 업로드는 별도로 수행한다. private S3 호환 저장소를 BackupTarget 구현으로 사용하고, 로컬 target은 테스트용으로 제공한다.
- 운영 서버 디스크 외부에 보관한다. 업로드 확인·해시·최근 성공 시각을 기록하고 실패를 드러낸다. 앱/CLI/봇의 개인 인증 파일을 서버 백업에 수집하지 않는다.

**복원과 이전**

1. 비어 있는 별도 staging 디렉터리에 복원한다. live 데이터 위에 바로 덮어쓰지 않는다.
2. manifest 해시, SQLite integrity_check, blob 참조, 프로젝트 ID·revision, tombstone/lifecycle·휴지통 상태를 검사한다.
3. archive의 원본 dev/ino/birthtime 값은 목적지에서 유효하지 않다. 검증한 새 폴더에 한해서 lifecycle identity를 목적지 값으로 재등록한다. 원본 값은 이전 기록에만 남긴다. 원본 archive 검증 기록과 목적지 변환 후 검증 기록을 각각 남겨, 이 변경 때문에 원본 해시 검사를 생략하지 않게 한다.
4. 중단 상태인 trashing/restoring/purging은 전용 복구 흐름으로 정리한다. purge된 프로젝트가 checkpoint로 재생성되지 않는지 확인한다.
5. 정상 종료/강제 종료 당시 AI 실행은 기존 고아 실행 복구 정책대로 실패/중단 처리하고, 대기 중 예약은 유지한다. 같은 run을 자동 재실행하지 않는다.
6. 격리 서버를 띄워 기존 테스트 세션으로 읽기/수정/히스토리/권한/재연결을 확인한 뒤 전환한다.
7. 원본 서버에서 추가 쓰기를 막고 최종 백업·revision을 확인한 뒤 새 주소를 적용한다. 이전 서버와 새 서버가 동시에 같은 프로젝트의 정본으로 동작하지 않게 한다.

서버의 tokenHash/memberId는 데이터 이전 중 유지할 수 있다. 클라이언트의 OS 암호화된 세션·개인 AI 로그인은 각 PC에 그대로 남는다. 주소 변경만으로 데이터가 이동되는 것은 아니다.

**복구 목표의 제안 기본값:** 비공개 베타는 매일 외부 백업+배포/이전 전 백업, 일간 7개 보관으로 시작한다. 유료 전환 전에는 1시간 단위 백업과 일간 7개/주간 4개 보관을 비용·중단 시간과 함께 검증한다. 목표 데이터 유실 범위 1시간, 복원 1시간 이내는 계획상 목표이며 실제 성공 기록 없이는 보장으로 안내하지 않는다.

**검증:** 빈 디렉터리 복원, 디스크/경로 변경, Windows 생성 archive의 Linux 복원, DB만 있고 checkpoint가 실패했던 상황, 휴지통 보관·완전 삭제, 손상/누락 archive, 업로드 실패, 쓰기 중 백업, 복원 후 오래된 명령 재전송.

**완료:** 서버를 잃어도 외부 백업으로 별도 환경에서 프로젝트와 접근 권한을 복원할 수 있다. 같은 디스크 안의 사본 생성만으로 완료하지 않는다.

### R10. 검증한 서버 결과물을 Render에 올릴 준비를 한다

**현재 상태:** 2026-10-22. 설정·공통 번들/캐시·준비 상태/종료·운영 기록·Render Blueprint·교차 OS CI와 검증 도구를 구현하고 Windows에서 검증했다. 실제 Linux 실행 환경과 CI 실행 결과가 없어 R10의 Linux 완료 조건은 대기 중이다. Render 서비스 생성·운영 배포는 별도 작업이며 수행하지 않았다. 상세 결과는 42절과 `docs/operations/render.md`를 따른다.

**재검토 보완:** 43절에서 확인한 오류 로그의 프로젝트 ID 익명화 및 Windows→Linux 복원 fixture 범위 보완은 44절에서 구현·Windows 검증을 마쳤다. 실제 Linux 완료 조건은 계속 대기 중이다.

**현재:** collaboration-server-entry.ts, scripts/build-collaboration-server.mjs, build-self-host-runtime.mjs, forge.config.mts, package.json.

**생성/수정:** server/config.ts, scripts/build-server-bundle.mjs, scripts/verify-collaboration-bundle.mjs, .node-version, .env.example, render.yaml, .github/workflows/ci.yml, docs/operations/render.md.

**설정 계약**

| 항목          | 계획값                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node          | 검증한 Node 24 패치 고정. 첫 로컬 기준은 24.19.0. Linux 결과 확인 후 같은 값으로 배포                                                                           |
| 서버 빌드     | npm ci → npm run collaboration:build → node scripts/verify-collaboration-bundle.mjs --bundle out/collaboration-server/server.mjs (검증 스크립트는 R10에서 생성) |
| 운영 시작     | node out/collaboration-server/server.mjs                                                                                                                        |
| host          | Render에서 0.0.0.0                                                                                                                                              |
| port 우선순위 | GAME_CANVAS_PORT → PORT → 4317; 정수/범위 검증                                                                                                                  |
| 데이터 경로   | GAME_CANVAS_DATA=/var/data/game-jam                                                                                                                             |
| 영구 디스크   | /var/data에 마운트, 초기 5GB는 사용량에 따라 조정                                                                                                               |
| 공개 연결     | GAME_CANVAS_PUBLIC=1; 기존 creationKey 길이 검증 유지                                                                                                           |
| 서비스 모드   | 새 GAMEJAM_SERVICE_MODE=self-host / managed-beta / managed. 기존 실행은 self-host 기본값, managed는 F01 완료 후 활성화                                          |
| 비밀 값       | GAME_CANVAS_SERVER_KEY와 백업 저장소 접근 값은 서버 환경에만 설정                                                                                               |
| 인스턴스      | 1개. 같은 SQLite를 쓰는 cluster/다중 인스턴스 금지                                                                                                              |
| 상태 확인     | 기존 /health 계약 유지 + 준비 상태를 검사하는 /ready 추가                                                                                                       |
| 배포          | 초기에는 검증 완료한 소스를 명시적으로 배포. 임의 push로 운영 데이터 migration 실행 금지                                                                        |

Render는 외부 요청을 위해 0.0.0.0과 플랫폼 port를 사용하도록 안내한다. 현재 npm start는 Electron 실행이므로 서버 start로 사용하지 않는다. [Render Web Services](https://render.com/docs/web-services).

영구 디스크는 런타임에서만 접근할 수 있고 pre-deploy/별도 one-off job에서는 사용할 수 없다. 따라서 DB migration은 서버가 요청을 받기 전 bootstrap에서, 주기 백업은 이 서비스 안의 관리 루프로 실행한다. 디스크를 연결하면 단일 인스턴스이며 재배포 중 중단이 생기므로 재접속을 검증한다. [Render Persistent Disks](https://render.com/docs/disks).

Node 버전은 플랫폼 기본값에 맡기지 않고 .node-version 또는 NODE_VERSION으로 고정한다. 별도 버전 업그레이드는 검사 결과를 갱신하는 변경 단위로 다룬다. [Render Node version](https://render.com/docs/node-version).

**빌드·검증 흐름**

1. 독립 서버와 Windows self-host가 동일한 buildServerBundle 함수를 사용하게 한다.
2. 서버 빌드 입력은 실제 서버 의존 소스, lockfile, 빌드 옵션/도구, Node 버전, 대상 아키텍처를 포함한다. 캐시 manifest의 입력·결과물 해시가 일치할 때만 재사용한다.
3. Node/PowerShell 도구/라이선스 캐시도 각 입력을 확인한다. Forge의 preStart/generateAssets 반복 호출 때문에 무조건 재빌드하지 않는다.
4. 서버 전용 CI에서는 Electron 바이너리 다운로드를 생략하도록 설치 환경을 명시하고, 필요한 빌드 도구 devDependencies는 설치한다. Node 서버 번들에 Electron/Discord/OS 자격증명 코드가 섞이지 않는지 검사한다.
5. Linux에서 빌드한 server.mjs 자체를 임시 디렉터리·포트로 실행한다. health, 생성/참여/저장, SSE·WS, 재시작/복구, SIGTERM을 검사한다.
6. 컴파일된 동일 결과물을 사용해 배포 전 검증한다. Render 자체 빌드를 사용하면 build command 안에서 생성한 결과물을 검사하고 start command가 그 경로를 실행한다.
7. /ready는 startup migration·데이터 검증 완료 후 200, draining/복구 실패 시 503이다. /health의 기존 프로토콜 정보를 대체하지 않는다.
8. 종료 시 신규 변경 수락 중지 → 진행 중 작업/저장 정리 → SSE·WS 종료 → 저장소 close 순서를 정하고 종료 상한을 둔다. 외부 강제 종료에서도 재전송 식별자로 중복 저장을 막는다.
9. 로그에는 requestId, route, 처리 결과, 소요 시간, 익명화한 프로젝트 식별자만 기본 기록한다. 문서 내용·토큰·초대/복구 키를 로그에 넣지 않는다.
10. 요청 실패율/저장 지연/RSS/디스크 잔량/백업 최근 성공 시각을 상태 점검에 포함한다. 여기서 요청 지연 측정은 운영 성능 확인이며 배포 단계별 시간 측정을 추가하는 작업이 아니다.

GAME_CANVAS_PUBLIC은 외부 연결 보호 설정이며 구독 상품 구분이 아니다. 서비스 모드는 서버 설정으로 고정하고 요청 본문의 selfHost/paid 값으로 바꾸지 않는다. managed-beta는 운영자가 생성한 프로젝트와 초대된 사용자에게만 연다. managed는 실제 인증 adapter와 서버 EntitlementService가 필요하고, 빠졌으면 시작 단계에서 실패시킨다. F01 테스트 기간에는 서버에 기록한 수동 베타 권한을 사용하고, 실제 결제 연결은 F02에서 추가한다.

**완료:** Linux에서 검증한 서버 번들이 실행되고, 재배포/재연결/복원 시나리오를 통과한다. 외부 계정·실제 도메인·Render 서비스 생성과 이전 실행은 별도 배포 작업에서 진행한다. 계획 작성만으로 배포된 것으로 보고하지 않는다.

## 6. 리팩토링 이후의 서비스 기능

R 작업은 구조와 운영 기반을 정리한다. 아래 F 작업은 새로운 제품 기능이다. 리팩토링 완료와 로그인·결제·웹 출시 완료를 구분한다.

### F01. 서비스 계정·팀·프로젝트 권한

**선행:** R01, R03, R07, R08. 실제 로그인 제공자는 F01 시작 시 확정한다. 제공자 SDK는 adapter 안에만 두고 아래 모델은 먼저 구현·테스트할 수 있다.

**추가 위치:** contracts/{identity,workspace,access}.ts, application/access/_, server/services/{identity,workspace}.ts, server/http/routes/{auth,workspaces}.ts, adapters/auth/_, adapters/sqlite의 추가 migration.

| 모델                | 필수 필드 / 고유 조건                                         |
| ------------------- | ------------------------------------------------------------- |
| User                | id, displayName, status                                       |
| ExternalIdentity    | issuer, subject, userId; issuer+subject 유일                  |
| TeamWorkspace       | id, name, ownerUserId, status                                 |
| WorkspaceMembership | workspaceId, userId, role, status; workspaceId+userId 유일    |
| ProjectOwnership    | projectId, workspaceId; projectId 유일, 기존 프로젝트와 연결  |
| ProjectAccess       | projectId, userId, role, status                               |
| LegacyMemberLink    | projectId, memberId, userId; 기존 작성자/히스토리 식별자 보존 |
| ServiceSession      | provider subject 또는 내부 sessionId, userId, 만료·회수 상태  |

여기서 Workspace는 결제·팀의 단위다. 기존 WorkspaceState의 로컬 폴더/열린 작업 상태와 혼동하지 않는다. UI 내부 작업 상태는 ProjectContext로 부른다.

**권한 기본안:**

- workspace owner/admin은 팀과 소속 프로젝트를 관리하고, 프로젝트 admin은 해당 프로젝트 멤버를 관리한다. 마지막 workspace owner의 제거는 차단하고 소유권 이전을 별도 원자적 작업으로 한다.
- project editor/viewer는 현재 편집/조회 규칙 유지.
- 로컬 개인 프로젝트는 서비스 계정 없이 동작.
- 운영 팀 프로젝트의 요청은 서비스 session → user → workspace membership → project access 순으로 확인한다.
- 초대는 팀 초대와 프로젝트 초대를 구분한다. 이메일이나 닉네임 일치만으로 기존 프로젝트 소유권을 부여하지 않는다.
- 기존 데이터의 귀속은 관리자의 검증된 이전 절차와 소유권 증명으로 연결한다. memberId를 userId로 덮어쓰지 않는다.
- managed 모드의 오래된 토큰도 해당 user/membership 회수 상태를 통과해야 한다. legacy HTTP 경로가 계정 차단 우회로 남지 않게 한다.

OAuth/소셜 로그인은 선택한 제공자의 공식 흐름을 사용한다. 데스크톱 공개 클라이언트는 PKCE·state 검증, 브라우저는 안전한 세션 쿠키와 CSRF 방어를 적용한다. 서비스 인증을 직접 임의 암호화로 만들지 않는다.

**검증:** 두 팀 A/B 간 프로젝트·history·AI 요청·SSE·WS 접근 격리, 탈퇴/정지/역할 변경, 만료 세션, 구형 토큰, 재로그인, 앱을 오프라인으로 연 개인 프로젝트. 모든 조회·명령·다운로드에 같은 접근 정책을 적용한다.

테이블에는 외래 키와 위 고유 조건을 적용한다. 권한 변경은 연결된 SSE/WS와 아직 적용되지 않은 큐 명령에도 반영하며, 로그인 제공자의 user 삭제 이벤트만 믿고 프로젝트 접근이 자동으로 막힌다고 가정하지 않는다.

### F02. 협업 구독과 사용 권한

**선행:** F01. 결제 사업자, 판매 국가·통화·가격·좌석 계산은 실제 결제 구현 전에 결정한다. 기본 구조는 workspace 단위 구독이며 좌석 수는 모델상 선택 필드로 둔다.

**추가 위치:** contracts/billing.ts, application/billing/_, server/http/routes/billing.ts, adapters/billing/_.

- Subscription: workspaceId, providerCustomerId, providerSubscriptionId, status, periodEnd, optional seats.
- BillingEvent: provider+eventId 유일, receivedAt, processedAt, 처리 결과.
- WorkspaceEntitlements: 서버에서 생성한 협업/저장/히스토리 사용 권한과 version.
- 서버 코드가 각 화면에서 가격표를 직접 해석하지 않도록 EntitlementService를 둔다.
- 결제 완료 화면의 URL만 보고 활성화하지 않는다. 검증된 webhook 또는 제공자 조회 결과로 구독 상태를 갱신한다.
- webhook 서명, 중복, 순서 뒤바뀜, 재처리를 처리한다. 오래된 취소 이벤트가 새 구독 활성화를 덮어쓰지 않게 한다.
- 구독이 끊겨도 개인 로컬 작업은 지속한다. 팀 자료의 읽기/내보내기·정리 기간을 정하고 즉시 삭제하지 않는다.
- 서버 운영자·테스트용 예외 권한은 명시적 관리 경로로 주며 클라이언트의 테스트 flag를 신뢰하지 않는다.
- 가격 때문에 기존 기술 보호 한도인 20프로젝트/500파일을 무조건 올리지 않는다. 사용 권한과 자원 보호를 각각 검사한다.

**검증:** 정상 결제, 실패, 갱신, 취소, grace/read-only, 중복 webhook, 해지 후 재구독, 유료 UI 우회 요청, offline 변경의 재접속 시 현재 권한 검사.

### F03. 실제 웹 편집기

**선행:** R02/R04/R05/R07과 F01. 결제 웹 UI는 F02와 연결한다.

**추가 위치:** src/web/{bootstrap,browser-runtime}.ts, adapters/browser/{preferences,draft-store}.ts, 별도 web 편집용 Vite 설정과 HTML 진입점.

1. UI는 같은 AppApi를 사용하고 HTTP adapter가 서비스를 연결한다. Electron IPC 메서드를 임의의 원격 호출 목록으로 모두 노출하지 않는다.
2. DocumentSaveStorage의 IndexedDB 구현을 추가한다. 저장 실패·브라우저 저장 공간 한도·로그아웃/계정 전환에 따른 데이터 분리를 처리한다.
3. 팀 프로젝트 열기 → 문서 읽기/저장 → 캔버스 이동 → 그림/게임 UI/칸반 → history/승인 → multiplayer 순으로 기능을 연다.
4. 허용 출처, 세션·CSRF, 파일 업로드/다운로드, SSE 재접속을 함께 검증한 웹 API만 연다. self-host v1의 Origin 차단은 기존 호환 경로에서 유지한다.
5. 브라우저 WebSocket은 현재 Node ws의 Authorization 헤더 연결을 그대로 쓸 수 없다. 인증된 HTTP에서 짧은 만료의 일회용 WS ticket을 발급하거나 검증된 쿠키 세션 흐름을 사용한다. 장기 세션 토큰을 URL에 넣지 않는다.
6. 게임 iframe에는 서비스 로그인 토큰을 제공하지 않는다. 기존 sandbox/CSP를 보존하고 플레이 창과 부모 사이 메시지 출처·내용을 검증한다.
7. 초기 웹 AI는 요청·승인·상태 조회를 제공하고 연결된 관리자 데스크톱 실행기에서 처리한다. 실행기가 꺼졌으면 대기 상태를 표시한다.
8. 브라우저에서 개인 로컬 프로젝트를 영구 보관하는 기능은 별도 범위로 결정한다. 출시 범위를 정하지 않은 채 로컬 폴더 API를 억지로 브라우저에 복제하지 않는다.
9. 현재 Vercel 웹 뷰어는 이 저장소에 서버/프런트 전체가 있는 것이 아니다. tools/web-viewer는 게시 연결 코드다. 별도 저장소를 확인하기 전 뷰어 이전 작업을 완료 범위에 넣지 않는다.

**완료:** 데스크톱 한 대와 브라우저 한 개가 같은 팀 프로젝트를 실제 편집하고, 재접속/충돌/권한 회수/초안 복구가 검증된다. 가짜 API에서 UI가 보이는 것만으로 완료하지 않는다.

### F04. iOS 확장

API 계약·프로젝트 ID·계정·권한을 재사용한다. 초기 후보 범위는 문서 조회/댓글/AI 요청·승인/알림이며, 전체 캔버스 편집의 필요성은 이후 검증한다. SwiftUI/웹 기반 화면 선택과 앱 결제 방식은 iOS 착수 시 별도 계획한다. 이번 리팩토링에서는 모바일 전용 화면이나 네이티브 패키지를 만들지 않는다.

## 7. 데이터·프로토콜 이행과 롤백

### 7.1 첫 리팩토링에서 보존할 데이터

| 데이터                                                | 이행 규칙                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Markdown frontmatter, 문서/섹션 ID, 상대 경로         | 자동 재발급/일괄 포맷 변경 없음                                   |
| .canvas의 canvases, drawings, game-ui, 상태·칸반 설정 | 기존 version과 링크 관계 유지                                     |
| output, assets/images, 결과 카탈로그·HTML 관리 문서   | 파일명·바이트·상호 참조 보존                                      |
| .history, .ai/tasks, AI 예약 기록                     | 기록 의미·task/run 식별자·중단 복구 정책 보존                     |
| editor-drafts, document-save-store                    | scope/key/sequence 보존; 읽을 수 없는 항목을 조용히 삭제하지 않음 |
| server-cache.json / .sync-blobs / offline transaction | 미확정 변경 및 재전송 ID 유지                                     |
| projects.enc, local-projects.json, 홈 분류            | 개인 경로·OS 암호화 호환 유지                                     |
| 서버 sync.sqlite, checkpoints, lifecycle, trash       | 한 세대의 일관된 이전과 복원 검증                                 |
| 개인 localStorage 키                                  | projectStorageKey의 휴지통 보관/복원 동작 포함                    |

프로젝트 식별 체계를 나중에 변경할 경우 alias map으로 기존 키를 읽고 새 키로 검증 후 이행한다. 이 작업은 R03의 내부 세션 추출과 분리한다.

### 7.2 호환성 정책

- 구조 이동 PR에서는 wire protocol v1, 기존 IPC 채널, 파일 format을 유지한다.
- 새로운 기능은 capability/version 필드로 협상한다. 클라이언트가 지원하지 않는 필수 기능은 안내하고 차단한다.
- 서버 버전 문자열만 보고 모든 기능을 추측하지 않는다.
- 계정 도입 후의 legacy 경로도 동일한 권한/구독 서비스를 거친다.
- 호환 검증은 리팩토링 직전의 실제 클라이언트/서버 결과물을 기준으로 한다. 오래된 모든 버전을 무조건 지원한다고 선언하지 않는다.
- 프런트엔드 메모리의 타입 변경과 저장/네트워크 스키마 변경을 서로 다른 변경 단위로 검토한다.

### 7.3 롤백 기준

1. **코드 이동만 있고 데이터 형식이 동일:** 이전 검증 결과물을 실행한다. 새 코드가 남긴 예약/오프라인 기록도 이전 버전에서 읽는지 확인한다.
2. **추가형 DB migration:** 이전 버전이 읽기/쓰기를 안전하게 할 수 있다는 테스트가 있을 때만 코드 롤백한다.
3. **비호환 데이터 이행:** 새 쓰기를 중단하고, 복원 지점 이후 자료 보존/재적용 계획을 세운 뒤 backup restore 또는 forward fix를 한다. 최신 쓰기를 버리는 자동 DB 롤백을 두지 않는다.
4. **호스팅 이전 직후:** 원본 서버는 자료 보존 상태로 둔다. 새 서버에서 쓰기가 시작된 뒤에는 단순히 원본 주소로 되돌리지 않는다. 양쪽 revision을 비교하고 권위 있는 최신 데이터를 확정한다.

해시 불일치, 사라진 초안, 재전송에 의한 이중 기록, 다른 팀 접근, 복원 후 삭제 프로젝트 부활, AI 결과의 다른 프로젝트 적용은 배포를 중단할 조건이다.

## 8. 검증 명령과 완료 조건

### 8.1 변경 영역별 검사

| 변경              | 기존 검사                                                                                                                | 추가해야 할 검증                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 공통 계약·명령    | typecheck, npm test                                                                                                      | 26개 명령의 실제 입력/출력, 구버전 wire fixture                                  |
| 프로젝트 세션·IPC | test:integration, test:autosave:ui                                                                                       | 느린 작업 후 전환·중복 구독·초안 키 호환                                         |
| 화면·스타일       | test:ui-review, test:ui-debug, test:canvas-selection:ui                                                                  | 동일 fixture의 dark/light/최소 창, 포커스·IME                                    |
| 문서·링크         | test:document-links:ui, document-workflow/document-links 기본 테스트                                                     | 분리 후 ID·역링크·삭제/복원의 동일 결과                                          |
| 그림·게임 UI      | test:drawings:ui, test:game-ui:ui                                                                                        | 낙관적 상태·실패/재시작 초안·충돌                                                |
| AI·승인·예약      | test:ai-queue, test:ai-queue:ui, test:gamejam-approval, test:gamejam-validation, test:gamejam-history, test:ai-dismissal | provider별 성공/실패/취소, claim/lease 중복·만료                                 |
| 서버·동기화       | collaboration, collaboration-network, workspace-offline, property-sync 기본 테스트                                       | DB 실패, SIGTERM, SSE 단절, 호환 client/server                                   |
| 멀티플레이        | test:multiplayer, test:multiplayer-diagnostics 및 기본 테스트                                                            | 서버 재배포·권한 회수·닫힌 방 재접속                                             |
| PC 서버·빌드      | self-host 관련 기본 테스트, verify-self-host-disabled                                                                    | 공통 번들 해시, 캐시 입력 변경/손상 시 재빌드                                    |
| 저장·복구         | project-store, project-trash, workspace-offline 기본 테스트                                                              | 새 tests/server-backup.test.mjs, server-migration.test.mjs                       |
| 인증·구독         | F01/F02에서 추가                                                                                                         | tests/workspace-access.test.mjs, entitlements.test.mjs, billing-webhook.test.mjs |
| 웹                | F03에서 추가                                                                                                             | 실제 HTTP/세션/IndexedDB와 desktop↔browser 편집                                  |

위 신규 파일/명령은 구현 예정이며 현재 존재하거나 통과했다고 주장하지 않는다.

### 8.2 CI와 패키지 검증

- 타입 검사·린트·기본 테스트는 독립 job으로 실행한다.
- Linux job은 서버 관련 테스트를 명시적으로 실행하고 독립 서버 번들을 시작해 검사한다. Windows 전용 테스트를 Linux에서 무조건 통과시킬 가짜 구현은 만들지 않는다.
- Windows UI 검사는 출력 폴더·프로필·포트 충돌이 없는 순서로 실행한다. 현재 여러 runner가 build를 수행하므로 실행 명령의 출력 경로를 먼저 확인한다.
- UI/IPC/AI 실행/패키징을 바꿨다면 해당 기능을 실제 패키지에서도 검증한다. 예: tests/packaged-windows-runner.mjs, ai-queue-packaged.mjs, gamejam-approval-packaged.mjs, multiplayer-packaged.mjs 중 변경 범위에 해당하는 것.
- 기존 패키지 검사의 일부는 out/Game Jam!-win32-x64 경로를 고정 사용한다. R10에서 필요하면 모두 같은 GAMEJAM_PACKAGE_DIR 입력을 받게 정리해 검증한 결과물을 정확히 선택한다.
- 실제 AI 계정을 사용하는 opt-in 검사는 mock 검사와 결과를 분리하고 별도 의도로 수행한다. 일반 리팩토링 회귀에서 사용자의 AI 사용량을 자동 소비하지 않는다.
- 새 strict 검사 대상은 contracts/core부터 시작하고, application 및 server로 넓힌다. 기존 전체 strict 전환과 라이브러리 대규모 업데이트를 끼워 넣지 않는다.
- import 경계 검사에서 타입 import와 실행 import를 구분하되, 계약이 구현 타입에 역의존하는 것도 금지한다. 브라우저 smoke build로 실제 번들 호환성을 검증한다.
- 캐시 키·해시와 실제 결과물을 연결하고 동일 소스의 이미 통과한 검사를 불필요하게 반복하지 않는다.
- 설치 앱 배포는 AGENTS.md와 UPDATES.md의 절차대로 make 결과물을 release --from-make로 게시한다. 이미 같은 조건으로 package한 결과물은 make --from-package를 사용한다. 단계별 시간 측정은 추가하지 않는다.

### 8.3 Render 베타의 최소 운영 시나리오

1. 관리자/편집자/조회자 세 클라이언트로 동일 프로젝트 참여, 역할별 동작 확인.
2. 서로 다른 프로젝트 둘에 같은 상대 경로 문서가 있어도 작업이 섞이지 않음.
3. 서버가 저장한 직후 응답이 끊기고 같은 commandId를 재전송해도 한 번만 적용.
4. 재배포 중 편집한 내용을 로컬에 보관하고 재연결 후 충돌 정책대로 반영.
5. AI 요청 중 실행기 PC 종료: 서버의 문서 편집과 AI 실행 상태가 각각 올바르게 유지/종료.
6. 프로젝트 휴지통/복원 및 완전 삭제 후 서버 재시작.
7. 새 디스크/폴더에 외부 백업 복원, 문서·이미지·히스토리·권한 검증.
8. 운영 비밀 값이 클라이언트 번들·로그·UI 디버깅 화면에 나타나지 않음.
9. Linux에서 대소문자·한글 파일명·경로 탈출·symlink 처리 검증. trash-files의 Windows 중심 canonical 처리를 그대로 신뢰하지 않음.
10. 초기 부하 fixture: 5개 프로젝트×4개 클라이언트, 프로젝트마다 문서 50개+이미지, 순차 저장/동시 드래그/재접속. 성공률, 저장 p95, RSS, DB·백업 크기, event loop 지연을 기록. 이 수치 자체를 서비스 수용 인원 보장으로 사용하지 않음.

운영 판단의 제안 기준은 메모리/디스크가 지속적으로 70%를 넘거나, 목표 네트워크 조건에서 저장 응답 p95가 1초를 지속 초과할 때 원인을 분석하는 것이다. 이는 측정할 초기 기준이며 현재 성능 측정 결과가 아니다. 캐시·스냅샷 비용 개선과 단일 서버 증설을 먼저 비교한다. 다중 인스턴스 전환은 공유 DB·분산 잠금/예약·이벤트 전달까지 함께 설계해야 한다.

## 9. 출시 단계별로 어디까지 필요한가

| 단계                           | 필요한 작업                                  | 사용자에게 약속할 수 있는 결과                                                    |
| ------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------- |
| 구조 정리된 개인 앱            | R00~R06                                      | 기존 개인/AI 기능을 유지하면서 화면·실행·저장 수정 범위가 명확해짐                |
| 운영자 통제의 Render 협업 베타 | R00/R01/R03/R04/R07~R10 + 관련 데스크톱 검증 | 초대된 팀이 PC 서버를 켜 두지 않아도 협업 데이터 이용. AI 실행기는 여전히 PC 필요 |
| 서비스 회원 가입·팀 운영       | F01                                          | 구글 등 선택한 로그인과 팀/프로젝트 접근 관리                                     |
| 유료 팀 서비스                 | F02 + 실제 백업/복원·운영 검증               | 결제와 서버 사용 권한이 연결된 협업 구독                                          |
| 실제 웹 편집                   | F03                                          | 데스크톱과 브라우저가 같은 프로젝트 편집                                          |
| iOS                            | F04 별도 상세 계획                           | 결정한 모바일 기능 범위 제공                                                      |

Render 제한 베타에서는 운영자가 프로젝트 생성 키를 관리한다. 공개 앱에 생성 키를 넣어 자동 가입을 구현하지 않는다. 공개 회원 가입은 F01을 통과한 관리형 서비스 경로로 제공한다.

## 10. 첫 구현 작업 지시서

**첫 작업의 이름: 공통 계약 분리와 문서 저장 경로의 실행 환경 주입.**

개발자는 R00 기준선을 확인한 다음 아래 범위부터 구현한다.

1. contracts/project.ts에 Snapshot을 이동하고 project-store.ts에서 type 재수출한다.
2. contracts/collaboration.ts에 CollaborationCommand/Envelope를 이동하고 client/cache/server import를 갱신한다.
3. contracts/app-api.ts로 기존 API 타입을 분리한다. 처음에는 구조와 메서드명을 유지하고 shared.ts의 호환 export를 남긴다.
4. ui/runtime/RuntimeProvider.tsx와 desktop-runtime.ts를 만든다.
5. renderer.tsx에서 runtime을 주입한다. dev/debug fixture에도 같은 진입점을 적용한다.
6. ProjectHome의 프로젝트 목록 조회와 DocumentCard의 저장 호출을 첫 수직 이행 사례로 선택한다. 나머지 화면은 이전 bridge를 유지하며 파일별로 옮긴다.
7. 이동한 public 타입이 구현 모듈에 역의존하지 않도록 해당 타입의 종속 타입도 함께 정리한다.
8. 타입 검사·기본 테스트와 변경한 홈/문서 저장/UI 디버깅 검증을 실행한다.
9. 기능 변경·저장 형식 변경·새 로그인·결제·Render 생성은 이 변경 단위에 섞지 않는다.

**첫 작업의 수락 기준:** 기존 로컬 프로젝트가 열리고 문서 저장·재시작 후 복구가 동일하다. 공동 프로젝트의 동일 저장 호출이 기존 서버에서 동작한다. 미리보기 API를 주입해도 운영 데이터/네트워크를 호출하지 않는다. 테스트와 타입이 통과하고 변경 diff가 계약/실행 환경 이행 범위에 한정된다.

## 11. 이후 결정할 항목

다음 결정은 해당 기능 구현 전에 필요하다. R00~R10 구조 정리의 시작을 막지는 않는다.

| 결정                          | 필요한 시점             | 현재 권장 기본값                                         |
| ----------------------------- | ----------------------- | -------------------------------------------------------- |
| 계정/구글 로그인 제공자       | F01의 실제 인증 adapter | 관리형 인증, 내부 userId는 제공자와 분리                 |
| 팀 과금 단위·가격·관찰자 좌석 | F02 상품 정의           | 팀 workspace 구독을 기준으로 모델링, 금액/seat 정책 미정 |
| 기존 self-host의 상품상 위치  | 유료 출시 전            | 기존 동작 유지, 관리형 운영의 가치와 범위를 명시         |
| 외부 백업 저장소/계정         | R09 실업로드 검증 전    | private S3 호환 target, 테스트는 local target            |
| 웹 개인 무료 저장의 범위      | F03 출시 범위 확정 전   | 첫 웹은 팀 프로젝트 편집부터                             |
| iOS 제공 기능                 | F04                     | 읽기·요청/승인 등 작은 범위부터 검증                     |

## 12. 유지할 설계 원칙

- 수정 목적이 구조 분리인지 기능 추가인지 각 변경에서 분명히 한다.
- 같은 저장/충돌 규칙을 desktop/server/web에 복제하지 않는다.
- 데이터를 바꾸는 작업은 실패·재시도·재시작·구버전 경로까지 검증한다.
- 계약을 만들었다는 이유로 미래의 모든 저장소/AI/클라이언트를 미리 구현하지 않는다.
- 사용자의 현재 로컬 파일, 프로젝트 세션, 초안, 승인 기록을 제품 자산으로 취급한다.
- 코드를 줄인 양보다 기능 수정 시 건드려야 하는 영역, 회귀 검증의 명확성, 데이터 복구 가능성으로 완료를 판단한다.

## 13. 1차 구현 기록 — 2026-10-20 (다음 차수의 최신 상태는 14절)

### 작업 상태

| 작업    | 상태      | 근거/남은 조건                                                                                                                                                                                                                                                                |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R00     | 완료      | 시작 시 HEAD·69개 수정/신규 파일 SHA-256·임시 보존본, 타입/439개 테스트/린트 기준선, 회귀 행렬 기록. 기존 포맷 13개 파일만 포맷. 추가 UI 실패를 원래 작업 사본에서 재현해 구분                                                                                                |
| R01     | 완료      | Snapshot·공개 API와 종속 전달 타입을 contracts로 분리, 호환 재수출, 전체 131개 멤버 그룹 매핑, 26개 CommandMap, 기존 reducer를 사용하는 외부 입력 처리, health/state 공통 capabilities, DOM/Node 타입 없는 strict 계약 검사                                                   |
| R02     | 진행      | 운영 UI의 bridge/localStorage 직접 참조를 Provider로 이행. renderer/dev/debug/test fixture 주입, 기존 키 보존, 메모리 preferences, 선택 desktop API·unsupported 오류. 전체 완료는 기존 UI 리뷰/그림 hit-test 실패 해소, 전체 capability 안내 및 dev fixture 책임 정리 후 판단 |
| R03~R10 | 미착수    | 프로젝트 세션·수명 관리부터 선행 관계대로 후속 구현 필요. 얇은 command-service 진입점이 생겼다는 이유로 R04/R07을 완료 처리하지 않음                                                                                                                                          |
| F01~F04 | 범위 제외 | 실제 로그인·결제·웹 편집·iOS 미구현                                                                                                                                                                                                                                           |

### 구현한 첫 단위

- `src/contracts`에 원래 필드/반환값을 그대로 옮겼다. public 타입이 구현 파일을 import하지 않도록 의존하는 타입과 계약 어휘 상수도 함께 분리했다. 이전 shared/project-store/server 및 기능 타입 경로는 type 재수출로 유지한다.
- `contracts/app-api.ts`의 전체 bridge 매핑에서 projects/editor/saves/collaboration/ai/history/preview/optional desktop을 만든다. 기존 preload의 채널명·인수·응답은 변경하지 않았다. 중첩 selfHost/Discord/multiplayer의 부재도 그대로 전달한다.
- `contracts/commands.ts`는 26개 reducer 명령의 입출력과 batch 허용 조합을 명시한다. 문서 저장 reducer의 void와 UI 저장 API의 CanvasDocument 반환을 구분한다. 실제 외부 입력 검사는 기존 reducer에 한 번 위임한다. 서버의 큐·권한·영속화 순서는 유지한다.
- `ui/runtime`에서 API·환경 능력·개인 설정을 주입한다. ProjectHome 조회와 DocumentCard 저장 큐를 포함한 화면/기능 훅이 useRuntime을 사용한다. 실제 desktop은 기존 Storage를 그대로 쓰고, 브라우저 개발 미리보기는 메모리 저장소를 쓴다. unsupported 동작은 `GC-RUNTIME-UNSUPPORTED`로 명확하게 실패한다.
- `server/capabilities.ts`가 기존 health와 인증 후 state에 공통 wire 필드를 공급한다. protocol v1과 기존 기능 값은 유지한다.
- 서비스 접근/구독/환경 능력의 별도 계약만 준비했다. 개인 로컬 편집/AI에 서비스 계정이나 구독 검사를 추가하지 않았다. 기존 PC 서버 기능과 개인 CLI 실행 경로를 유지했다.

### 계획 대비 확인/보완

1. 저장 큐·AI 승인·멀티플레이 등의 public API 종속 타입을 그대로 구현 모듈에 남기면 contracts가 역의존했다. 첫 단위에서 필요한 종속 타입/계약 상수도 추출했다. 기능 로직을 복제하지 않았다.
2. Node 기본 테스트가 `features/kanban/preferences.ts`도 읽는다. 훅이 JSX 파일을 런타임 의존하지 않도록 React context/hook을 `runtime-context.ts`, JSX Provider를 별도 파일에 뒀다.
3. UI fixture의 Proxy가 미정의 중첩 API를 일반 함수로 만들어 미리보기를 중단했다. 선택 중첩 API를 명시적으로 undefined로 선언했다. 일반 실행 동작 차단은 유지했다.
4. `test:ui-review`의 오래된 버전/도구 목록 단언을 현재 기준선과 정확하게 비교하도록 갱신했다. 그 뒤 발견한 980px 패널 겹침은 리팩토링 전 원본 작업 사본에서도 동일하게 재현했다. 실패한 겹침 단언을 삭제하거나 완화하지 않았고 디자인 변경도 섞지 않았다. 자세한 재현 위치는 `docs/architecture/baseline.md`에 기록했다.
5. `test:drawings:ui`의 hollow annotation 내부 hit-test 단언(295줄)도 원래 작업 사본에서 같은 실패를 재현했다. 그림 동작·단언은 바꾸지 않았다. 문서 링크 UI와 클립보드 패키지는 첫 실행에서 각각 연결 해제 버튼/복사 알림 대기 시간 초과가 있었고 단독 재실행은 통과했다. 이를 안정적인 성공으로만 요약하지 않고 간헐 실패로 남긴다. 네이티브 포커스/클립보드 검사는 앞으로 순차 실행한다.

### 검증 기록

| 검사                                                                                                                                   | 결과                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 착수 타입·기본 테스트                                                                                                                  | 통과, 439개                                                                                                                                                       |
| 전체 타입 + `typecheck:contracts`                                                                                                      | 통과; contracts는 strict, ESNext만 사용, Node/DOM ambient type 미사용                                                                                             |
| 리팩토링 후 기본 테스트                                                                                                                | 최종 445개 통과(기존 439 + 추가 6), 실패/건너뜀 0                                                                                                                 |
| `npm run lint`                                                                                                                         | 통과, 기존 경고 2건 유지                                                                                                                                          |
| `npm run test:runtime-contracts`                                                                                                       | 기본 테스트에 포함된 6개 모두 통과. 계약 의존 경계, bridge 전달/에러/구독 해제, 설정 격리, 명시적 unsupported와 UI 전역 참조 금지, 외부 명령 검증, v1 저장/재시작 |
| `npm run test:autosave:ui`                                                                                                             | 실제 HTTP/SSE·잠금 heartbeat·peer 변경 중 제목/본문/소스/포커스 입력 유지, 늦은 unlock 중 추가 입력과 최종 동기화 통과                                            |
| `npm run test:ui-debug`                                                                                                                | 최종 코드로 전체 카탈로그/스코프/F12/강조/Storage/실제 API·동작 격리 통과                                                                                         |
| `npm run test:ui-review`                                                                                                               | 실패: `Panels overlap at 980`. 원래 작업 사본에서도 같은 실패 재현. 기존 버전/도구 목록 단언은 현재 기준선으로 보정                                               |
| `npm run test:integration`                                                                                                             | 통과. production main IPC, 승인/CLI mock, 그림/게임 UI/휴지통, 실제 Chromium HTML·포인터, 4개 테스트 창, App 캔버스 전환/복구/한글 편집                           |
| `test:game-ui:ui`, `test:ai-queue:ui`, `test:ai-dismissal`, `test:gamejam-approval`, `test:gamejam-validation`, `test:gamejam-history` | 모두 통과. 로컬 mock/fixture, 실제 AI 공급자 호출 없음                                                                                                            |
| `node tests/run-discord-approval.mjs`                                                                                                  | 통과. mock transport/CLI, 외부 메시지 전송 없음                                                                                                                   |
| `test:document-links:ui`                                                                                                               | 첫 실행 timeout, 원래 작업 사본 통과, 현재 코드 단독 재실행 통과                                                                                                  |
| `test:drawings:ui`                                                                                                                     | 실패: hollow annotation hit-test, 원래 작업 사본에서도 같은 실패                                                                                                  |
| `npm run package`                                                                                                                      | Windows x64 생성 통과. 같은 결과물로 아래 실제 패키지 검사. make/release/업로드하지 않음                                                                          |
| `node tests/ai-queue-packaged.mjs`                                                                                                     | 통과. 로컬 mock CLI 예약/취소/버전 게시, 번들 Node/server + 독립 desktop 클라이언트 예약/잠금/실행                                                                |
| `node tests/multiplayer-packaged.mjs`                                                                                                  | 통과. 4명 격리 인증 사용자, production IPC/preload, 게임 고정/ready/start/입력/호스트 이탈                                                                        |
| `test:game-ui:packaged`                                                                                                                | 통과. 실제 패키지 편집/Undo/개인 설정/Markdown 저장/전체 프로세스 재시작                                                                                          |
| `test:clipboard:packaged`                                                                                                              | 첫 동시 실행 timeout, 같은 패키지 단독 재실행 통과. OS 클립보드 복원, native 붙여넣기/내부 복사/Undo/재시작                                                       |
| `test:updates:desktop`                                                                                                                 | 통과. 생성된 production renderer/preload 홈 설정/업데이트/재시작 보호, 실제 설치·업데이트 요청 없음                                                               |

검사 로그는 현재 PC의 `%TEMP%/gamejam-refactor-*.log`에 남겼다. 임시 로그는 영구 CI 기록이나 전체 작업 완료의 근거를 대신하지 않는다.

검증한 패키지는 `out/Game Jam!-win32-x64`이며 실행 파일/app.asar의 크기와 SHA-256은 `out/refactoring-package-verification-2026-10-20.json`에 기록했다. package 이후 앱 소스/빌드 설정은 바꾸지 않았다. 이후 변경은 검증 기록과 테스트의 실패 진단 출력뿐이다.

### 다음 구현과 외부 확인

- R02의 남은 fixture 책임·전체 capability 안내를 정리하고 기존 UI 리뷰/그림 hit-test 실패는 별도 변경 단위에서 다룬다. 기능별 UI/CSS 추출은 R03 이후 R05에서 진행한다.
- R03에서 전환 시 저장/초안/큐 정리 순서와 늦은 결과를 검증한 뒤 R04의 실제 application 저장 서비스/IPC 경계를 추출한다. 현재 main의 전역 세션이나 26개 로컬 편집 경로가 분리됐다고 주장하지 않는다.
- R06 AI Executor, R07 HTTP·업무·권한 서비스, R08 저장소/migration, R09 일관 백업/복원, R10 Linux·Render 설정/검증 도구는 아직 구현하지 않았다.
- 실제 AI 공급자 계정, 운영 데이터 이전, Render 유료 자원/서비스 생성·배포, Linux에서 Windows 백업 복원, 외부 S3 업로드는 확인하지 않았다. 이번 검증의 mock CLI·임시 서버 결과와 구분한다.

## 14. 후속 구현 기록 — 2026-10-20

### 현재 상태

| 작업    | 상태      | 실제 반영/남은 조건                                                                                                                                |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R00·R01 | 완료      | 13절의 기준선·계약 분리를 유지한다                                                                                                                 |
| R02     | 진행      | Provider 이행 유지. 전체 capability 안내와 dev fixture 역할 정리, 기존 UI 회귀 문제는 남아 있다                                                    |
| R03     | 완료      | 비공개 desktop 세션, 공개 opaque ref, epoch/취소·자원 수명, 세션별 요청/저장/AI 결과 검사, 종료 의도별 공통 보존 경로, 아래 회귀 검증              |
| R04     | 진행      | 문서 저장 수직 경로의 실제 서비스/파일 저장소와 공통 계산, 부분 capture 저장소 포트 이행. 나머지 편집 명령과 IPC 등록 그룹의 전면 이행은 남아 있다 |
| R05     | 진행      | ProjectImage·DocumentCard와 표시 모델 분리, 세션별 초안 콜백 레지스트리. 선택·팝업·AI 요청·미리보기 상태 훅과 CSS 책임 분리는 남아 있다            |
| R06~R10 | 미착수    | AI 실행기·협업 서버 서비스/저장소·일관 백업/복원·Render 설정/검증 도구는 아직 완료하지 않았다                                                      |
| F01~F04 | 범위 제외 | 실제 로그인/결제/웹 편집/iOS, 유료 자원 생성·운영 배포·데이터 이전은 실행하지 않는다                                                               |

### R03 프로젝트 세션과 수명 관리

- `application/projects/project-session.ts`가 AbortSignal과 이름별 해제 함수를 소유한다. 자원 해제는 역순으로 한 번씩 실행하며, 하나의 해제가 실패해도 나머지를 시도한다. 종료된 세션에 새 자원을 등록할 수 없다.
- `desktop/project-session.ts`가 root/client/watcher를 소유한다. 전환은 직렬화한다. 공개 `ProjectSessionRef`는 경로/토큰 대신 projectKey/sessionId/epoch만 포함한다. 같은 폴더 재개도 새 sessionId·epoch가 된다. 기존 `local:<root>` / `shared:<projectId>:<memberId>` 저장 scope는 그대로 생성한다.
- main의 분산된 root/client 전역을 세션 소유자로 이행했다. watcher의 루트와 완료 콜백은 시작 당시 세션을 캡처하고, SSE/폴링은 해당 client의 stop으로 해제한다. 지연 알림 타이머도 세션 자원이다.
- IPC 준비/속성 큐 대기/변경 큐 실행/완료 반환에서 세션을 재검사한다. 느린 붙여넣기와 읽기, 같은 폴더 재개 후 늦은 저장을 새 프로젝트 작업으로 해석하지 않는다. 내부 queueSessionId는 초안 키·파일 형식 변경 없이 이전 저장 어댑터를 거부한다.
- 저장 큐 완료 이벤트는 **실행을 시작한 어댑터의 세션**을 유지한다. UI는 이전 세션 완료를 무시한다. 일반 조회의 현재 세션과 실제 오래된 완료 이벤트를 구분한다. DocumentCard/WorkspaceCanvas 구독은 세션 변경 시 정리한다.
- AI 시작과 결과 반영 큐는 시작 ref를 검사하고 이벤트에도 ref를 붙인다. 종료 시 task 상태/히스토리 기록은 현재 화면의 root를 다시 읽지 않고 시작 당시 root를 사용한다. 기존 실행 중 전환 금지 UX, CLI 권한, 실행 수는 바꾸지 않았다.
- `desktop/lifecycle.ts`가 홈/전환·창 닫기·업데이트·종료의 초안 → 저장 큐 checkpoint → 공동 캐시 보존 순서를 공유한다. 기존 UI 편집 flush와 property queue 정리, 업데이트 확인·실패 처리도 유지한다. 이 모듈은 저장된 프로젝트 세션 파일을 이행하거나 삭제하지 않는다.

### R04 문서 저장 서비스

- `DocumentEditingService`가 원본 ID와 기대 본문/제목 충돌을 검사한다. 파일 읽기와 원자적 교체는 `filesystemDocumentRepository`에 주입한다. IPC 저장 등록은 프로젝트 세션·저장소 조립과 서비스 호출로 줄였다.
- `core/editing/document-edit.ts`의 내용 계산을 로컬 서비스와 기존 공동 reducer가 함께 사용한다. reducer의 void와 IPC의 CanvasDocument 반환은 그대로 다르다. 서버의 권한/버전/잠금 검사를 클라이언트 검사로 대체하지 않았다.
- 파일 교체 직전 원본 바이트를 다시 확인해 외부 편집을 덮어쓰지 않는다. 실패/취소 시 임시 파일을 정리한다. 임시 파일 이름, flush와 rename 방식, 임의 frontmatter·문서 ID·링크·이미지 정보는 유지한다.
- `readDocument(root, path)`가 명시된 프로젝트의 문서/이미지 메타데이터를 읽는다. 과거 main 파서의 제목 fallback, source 참조, body trim과 mtime 의미를 보존한다.
- `LocalProjectRepository`의 파일 구현이 기존 project-store capture/apply/history/recover를 사용한다. main의 기록 경로에서 기존 단일 Markdown 부분 capture를 유지하고, 전체 snapshot을 매번 쓰는 방식으로 바꾸지 않았다.

### R05 문서 화면의 책임과 초안 소유권

- `ui/documents/ProjectImage.tsx`, `DocumentCard.tsx`, `presentation.ts`로 이미지 읽기/오류와 카드의 편집·IME·자동 저장·충돌·초안 복구 상태를 함께 이동했다. 디자인/DOM 구조/CSS 선언은 바꾸지 않았다.
- 전역 `draftFlushers` Map을 없애고 WorkspaceCanvas가 세션별 `DraftFlusherRegistry`를 소유한다. 문서/그림/게임 UI는 등록과 해제를 명시한다. 이전 effect cleanup이 새 편집기의 콜백을 지우지 못하며 다른 Provider/프로젝트의 초안을 같이 flush하지 않는다.
- UI 디버그 카탈로그의 실제 문서/이미지 소스 위치도 갱신했다. 남은 App 기능/스타일을 단순히 파일 이동만으로 완료 처리하지 않는다.

### 검증

| 검사                                | 결과                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 타입/strict contracts/strict core   | 통과. 새 core는 Node/DOM ambient 타입 없이 검사한다                                                                                                       |
| 기본 테스트                         | 454개 통과, 실패/건너뜀 0                                                                                                                                 |
| `test:project-session`              | 실제 main IPC에서 같은 프로젝트 재개 후 늦은 읽기/이전 저장을 거부하고 원래 문서·scope 유지                                                               |
| 세션/저장 큐 단위 검사              | 동시 전환·중복 해제 방지·해제 실패·같은 scope의 늦은 완료 태그·보존 실패 후 재시도 통과                                                                   |
| 문서 서비스 검사                    | 로컬/공동 본문·ID·frontmatter·링크 의미 일치, 외부 변경·경로 탈출·세션 변경·임시 파일 정리 통과                                                           |
| 초안 레지스트리 검사                | 프로젝트 격리, 이전 effect cleanup과 새 콜백의 경합 통과                                                                                                  |
| `test:integration`                  | 새 세션/저장 서비스/문서 카드로 기존 전체 통합 통과. 마지막 AI 종료 root 고정은 별도 `test:ai-queue`로 재검증                                             |
| `test:autosave:ui`, `test:ui-debug` | 편집 DOM/선택/IME·실제 HTTP/SSE 저장과 미리보기 전체 카탈로그·Storage/실제 API 격리 통과                                                                  |
| `test:ai-queue`                     | mock CLI 3종·FIFO·취소·공동 claim 통과. 종료 상태 기록의 root 재참조 경고를 발견해 수정 후 경고 없이 재통과                                               |
| 린트                                | 통과, 기존 경고 2건 유지                                                                                                                                  |
| 실제 패키지                         | Windows package 생성 및 동일 결과물의 AI 예약/게임 UI 전체 재시작/클립보드/업데이트 UI 통과. 마지막 AI 상태 root 수정 후 새 package의 AI 예약 검사도 통과 |

새 로그는 `%TEMP%/gamejam-refactor-r03-*`, `r04-*`, `r05-*`에 있다. 패키지는 앱 소스가 바뀔 때마다 다시 생성했고, 같은 소스의 검증 결과물을 release/make로 다시 만들거나 업로드하지 않았다. 최신 해시는 `out/refactoring-package-verification-2026-10-20.json`에 갱신한다.

13절의 기존 UI 리뷰 980px 겹침/그림 hit-test 실패와 문서 링크·클립보드 간헐 timeout 기록은 여전히 유효하다. 검사 삭제/완화로 통과시키지 않았다. 실제 AI 계정, Render 서비스/비용, 운영 데이터 이전, Linux/S3 복원은 이번 검증에 포함하지 않았다.

## 15. 계속 구현 기록 — 실행 환경·편집 서비스·화면 책임

이번 기록은 14절 이후의 변경이다. R04/R05 및 R06~R10 전체 완료를 뜻하지 않는다.

- R02: dev-api의 문서/히스토리/AI 큐/구독 등 모듈 전역 상태를 factory 인스턴스 안으로 옮겼다. 초기 프로젝트는 ui/fixtures/project에서 새 객체로 제공하고, 문서 저장은 운영 core의 내용 계산/외부 변경·ID 검사를 이용한다. 기본 PreferenceStore도 메모리 구현으로 바꿨다.
- R02: capability에 따른 파일 열기·업데이트·AI 실행·클립보드·멀티플레이 진입을 정리했다. native desktop API가 없는 Provider에서도 편집 화면을 열 수 있고 AI CLI 상태를 조회하지 않는 실제 Chromium 검사를 추가했다. 기존 독립 게임의 연결 진단/수정 요청은 지원 여부와 무관하게 표시를 유지한다.
- R04: CommandEnvironment로 reducer의 ID/시각을 주입하며 batch/delete-many의 자식 명령에도 전달한다. LocalCommandService는 한 번 계산한 결과에서 변경된 파일만 기존 원자적 저장소에 적용한다. LocalCanvasService가 그림·게임 UI 요청의 성공 후 중복 방지와 데이터 조회를 소유하고 desktop/ipc/canvas는 등록/호출만 한다. 세션이 바뀐 저장소 작업도 중단한다.
- R05: useDocumentEditing이 IME, 저장 sequence, 충돌/초안 복구, 편집 잠금, 저장 큐 구독/해제와 외부 클릭 완료를 소유한다. 카드에는 표시와 UI 콜백 연결을 남겼다. SectionCard/PreviewCard를 나누고 usePreviewPlayback이 iframe identity·전체화면·크기 관찰·메시지 구독을 소유한다.
- R05: WorkspaceDataLoader/useWorkspaceData가 증분 baseline·최신 읽기 세대·프로젝트 이벤트 구독을 소유한다. 같은 경로를 다시 열어도 sessionId가 다르면 증분 baseline을 재사용하지 않는다. 취소된 늦은 응답은 새 캐시/화면을 덮어쓰지 않는다.
- R05: CSS는 선언 순서를 그대로 유지한 11개 역할별 파일을 index.css에서 순서대로 import한다. 분리 직전 원문과 파일 재결합 바이트 일치를 확인한 기록은 out/refactoring-css-order-2026-10-20.json이다. 기존 후순위 override는 workspace-overrides/canvas-footer에 유지한다.
- 기존 회귀 수정 단위: 980px 화면에서 중앙 도구와 좌측 도구가 겹치는 원인을 확인해 기존 도구 올림 breakpoint를 850→1050px로 조정했다. 그림 hit-test 검사는 앞선 창 크기 변경에 따른 viewport 이동을 무시한 고정 (500,600)을 사용했다. 실제 카드/빈 주석 영역의 교차 영역을 먼저 확인한 뒤 그 지점에서 클릭 통과와 Alt 메뉴를 검사하도록 수정했다. 제품 hit-test를 완화하거나 검사를 삭제하지 않았다. 재검증 결과는 아래에 이어 기록한다.

진행 중 검증: 인스턴스 격리·공통 명령 결과/부분 쓰기·실패 재시도·세션별 증분 캐시 단위 검사 통과. PC API 없는 화면 및 UI debug 전체 카탈로그 통과. 문서 훅 분리 후 autosave UI 통과. HTML 미리보기 검사에서 독립 연결 안내가 숨겨지는 회귀를 발견해 안내를 복원한 뒤 light/dark·크기·접기·전체화면 검사를 재통과했다. R05의 선택/캔버스 명령·AI 요청·패널 상태·WorkspaceScreen 조립 분리는 여전히 남아 있다. 전체 기본/통합·최종 package 검증은 후속 결과를 기록한다.

15절의 추가 반영:

- documents IPC 등록을 desktop/ipc/documents로 분리했다. 문서 읽기/저장/접기/배치 변경은 DocumentEditingService를 호출하며 handler는 raw fs를 사용하지 않는다. metadata 원자 교체는 기존 본문과 임의 frontmatter를 보존하고, 교체 직전 외부 변경과 세션을 검사한다. 로컬 단일 문서의 배치/접기는 전체 snapshot을 읽지 않는다. 공통 layoutValues 계산을 기존 공동 reducer와 함께 사용한다.
- LocalCanvasService의 게임 UI 경로는 기존 applyGameUi 모델 검증을 유지한다. 협업 전체 snapshot의 용량/파일 수 제한을 새로 개인 로컬 작업에 적용하지 않는다. 로컬 파일 처리와 공동 snapshot 처리의 기존 차이를 무시하고 모든 handler를 reducer 호출로 치환하지 않는다. 나머지 R04 그룹 이행 시에도 이 차이를 검토한다.
- useCanvasSelection은 선택 상태와 pointer 취소 시 이전 선택 복구를 소유한다. useCanvasCommands는 편집기/모달/전체화면을 고려하는 키보드 처리와 구독 해제를 소유하며, callback ref로 최신 동작을 읽어 매 렌더마다 전역 이벤트를 다시 구독하지 않는다.
- usePanelState는 15개 화면 패널의 열림 상태와 모달 포커스 trap/복귀를 소유한다. 문서/서버 확인본/저장 큐는 이 상태에 복제하지 않았다.
- useGamejamRequest는 AI 요청/공급자 선택, 초안 자동 저장, 승인 수정 식별자, 최근 요청 읽기와 세션별 요청 세대를 소유한다. 이전 세션/닫힌 요청의 늦은 응답·focus 예약은 새 요청을 변경하지 않는다. GamejamRequestFlow는 요청 창의 닫기, 초안/히스토리 불러오기와 단계 표시를 담당한다.
- UI 리뷰의 980px 겹침 수정 후 미니맵과 카드 색상이 같아야 한다는 이전 assertion이 드러났다. 기존 CanvasMiniMapNode는 카드와 별도의 진한 혼합 팔레트를 사용한다. 제품 색상을 바꾸지 않고, 카드 색상 반영/기본색과의 구별/기존 카드 분홍색 보존을 각각 확인하도록 교정했다. UI 리뷰 전체 통과.
- 그림 UI: 실제 교차 영역에서 빈 주석의 클릭 통과와 Alt 메뉴를 확인했다. 이어서 확대 후 footer/minimap 아래에 가려진 endpoint 대신 화면에 노출된 반대 endpoint를 실제 native pointer로 드래그하고, 동료의 endpoint 변경을 덮어쓰지 않는 충돌 검사를 유지했다. 전체 그림 UI 통과.

아래 후속 코드(문서 metadata IPC, 선택/패널/AI 요청 훅)를 반영하기 전 전체 기본 테스트는 459개 통과, 전체 integration도 통과했다. 이후 변경은 관련 검사를 다시 실행 중이다. 완료 카드/최종 검사 결과와 남은 조건은 최종 반영 기록을 따른다.

15절의 추가 이행 및 검증 기준:

- R02의 Provider 교체/전역 참조 제거/메모리 preference/fixture 인스턴스 격리/선택 기능 안내를 구현했다. PC API 없는 환경, 실제 debug 카탈로그 및 일반 UI 리뷰가 통과해 R02 구현 완료로 기록한다. F01~F04의 실제 웹 편집 구현을 뜻하지 않는다.
- LocalCreationService는 기존 개인 프로젝트의 문서 복사 ID/파일명과 timestamp 작업 파일명을 보존한다. 복사할 모든 입력을 준비한 후 기존 원자적 저장소로 한 번에 반영한다. 뒤쪽 입력 실패 시 앞쪽 복사본을 남기지 않으며, 기존 파일명/대소문자 충돌을 덮어쓰지 않는다. 단위 검사 3건 통과.
- LocalSectionService/LocalSectionRepository와 프로젝트 reader는 root/세션을 명시한다. 외부에서 이름을 바꾼 멤버의 ID 재탐색, 기존 좌표 fallback/크기 보정, 문서 보존/휴지통 이동 정책을 유지한다. section 단일 파일 쓰기도 외부 수정 검사와 원자적 교체를 사용한다. 프로젝트 간 격리 및 이동/삭제 단위 검사 2건 통과. 기존 여러 멤버 이동/휴지통 처리는 순서/실패 보고 정책을 보존했으며 이를 새 전역 트랜잭션으로 바꿨다고 주장하지 않는다.
- 남은 snapshot 명령은 LocalCommandService와 filesystemCommandPublisher로 이행했다. IPC는 명령을 전달하고, 파일 이동/휴지통/감시 중단·재개/이동 실패 rollback은 파일 adapter가 처리한다. 기존 수동 히스토리 기록 채널과 mutation wrapper의 기록 채널을 구분해 중복/누락을 방지한다.
- FileImportService는 로컬/공동 파일 가져오기와 클립보드 이미지를 담당한다. Native dialog/파일 읽기/이미지 해석은 desktop/import-files로 분리했다. 입력/권한/세션 검사와 기존 용량 제한을 유지한다. 기록 실패 rollback, AI 잠금/취소 시 무반영, 공유 role·연결 검사 단위 검사 2건 통과.
- LocalHistoryService/LocalEditHistoryService는 기록 조회/복원/Undo·Redo를 소유하고, 파일 adapter가 결과 폴더 이동·rollback·휴지통 처리를 담당한다. 설정 조회/HTML·미리보기 창 읽기·저장은 ProjectSettingsService/ProjectPreviewService와 TextFiles port로 연결했다. 문서 이미지 읽기도 저장소 port를 사용한다.
- Discord token 입력은 desktop/ipc/discord-approval의 별도 등록 경로로 옮겨 일반 진단 logger를 통과하지 않는다. 기존 multiplayer/window-manager와 self-host/register의 별도 sender/자격증명 경계는 유지한다.
- AI 요청의 5개 입력 페이지는 GamejamRequestFields, 초안/모델/승인 수정·최근 작업 읽기·단계/검증 포커스는 useGamejamRequest, 창 chrome은 GamejamRequestFlow에 있다. App는 ReactFlowProvider/WorkspaceScreen 조립을 맡는다. WorkspaceScreen의 나머지 캔버스 작업 콜백/패널 조립은 추가 정리 대상이므로 파일 이동만으로 R05 전체 완료로 처리하지 않는다. debug 카탈로그의 실제 소스 위치를 갱신했다.

새 문서 metadata/선택/패널/AI 요청 hook까지의 기본 검사 460개와 타입/strict contracts/strict core/린트가 통과했다. 요청/히스토리/승인/선택/자동 저장/debug 카탈로그/UI 리뷰/그림/HTML/게임 UI의 실제 Chromium 검사 10종을 같은 소스에서 한 번씩 통과했다. 그 이후 creation/section/import/history/preview IPC와 AI 입력 페이지/WorkspaceScreen 이행이 추가되어 최종 소스의 통합·관련 UI·패키지를 다시 검증한다. R06~R10은 아직 완료하지 않았다.

## 16. R06 공급자·실행기 경계와 계속 검증

R04/R05의 15절 누적 소스는 자동 테스트 467개, 타입/strict contracts/strict core/린트(기존 경고 2건), 전체 integration, 프로젝트 세션, production mock AI 예약 큐를 통과했다. AI 요청·히스토리·승인 UI, debug 전체 카탈로그 및 native preload/IPC debug도 통과했다. native debug의 일부 미등록 선택 API 로그는 격리 fixture에서 발생하며 실제 production IPC의 등록 실패와 구분한다.

같은 입력 지문 `35c56ed6324e13e23f47551688d0e31d22474975910b2970d467c3d86c8f647c`의 Windows package를 한 번 생성했고 빌드 전후 입력 일치를 확인했다. 실제 package의 게임 UI 전체 재시작/문서 보존, 클립보드 가져오기/실행 취소/전체 재시작, production renderer의 업데이트 종료 보호, 격리한 실제 mock CLI 및 내장 Node/서버와 독립 앱의 AI 예약 검사가 모두 통과했다. 이 단계의 입력/파일 SHA-256 기록은 `%TEMP%/gamejam-refactor-r04-r05-package-{inputs,verification}.json`에 보존한다. 배포/설치 실행/운영 서버 시작은 하지 않았다.

R06을 이어 구현 중이다. R04/R05의 추가 조립 정리 및 R06~R10 전체 완료를 뜻하지 않는다.

- 모델/추론 수준 목록과 검증은 Node/DOM 없는 `core/ai/catalog.ts`로 분리했다. UI와 목록만 사용하는 업무 코드는 이를 직접 import한다. `ai-providers.ts`는 기존 경로의 호환 export다.
- Codex/Claude/Gemini의 CLI 인자와 로그 해석을 `adapters/node/ai`에서 관리한다. 권한 제한, 사용자 설정 격리, 파일 도구 목록, Gemini의 실행별 thinking 설정과 기존 실패 판정을 유지한다.
- CLI 탐색/로그인 상태의 읽기 전용 probe는 Node adapter로, 프로세스 수집/Windows 하위 프로세스 종료는 desktop/ai로 분리했다. 인증 token 값을 읽거나 응답에 추가하지 않는다.
- `AiExecutor` port를 실제 main 실행 경로에 연결했다. `NodeAiExecutor`가 child process, UTF-8 스트림, AbortSignal, 중복 run ID와 취소의 소유권을 갖는다. main은 ChildProcess를 저장하지 않고 취소 동작만 보유한다. 기존 2단계 실행/검증/원자 반영 절차와 동시 실행 제한을 유지한다.
- AiConnectionStatus/AiRunStatus/AiRunEvent/AiRunInput/AiRunResult 이름은 기존 Codex 타입의 alias다. `codex:*` IPC와 저장된 JSON 필드는 바꾸지 않았다.
- 격리한 실제 Node mock 프로세스의 한글 byte 분할 복원, 기존 제한 인자, 중복 실행 거부, 중복 취소/취소된 작업 재실행 방지를 단위 검사했다. 공급자 기존 검사 7건과 새 실행기 검사 2건 통과. 타입/strict contracts/strict core 및 production main의 mock AI 큐도 새 실행기로 통과했다. 실제 AI 계정 사용은 하지 않았다. 이후 실행 정책/예약·승인 서비스 분리와 최종 package 재검증을 계속한다.

### 16.1 이번 단계의 구현 범위

사용자의 단계별 진행 요청에 따라 이번 단위는 R06의 공급자/실행기 → stage 검증·반영 → durable 예약·claim → 승인 실행 gate → desktop 서비스 수명 조립까지다. R07~R10에 착수하지 않으며 R04/R05의 남은 조립 정리를 완료로 바꾸지 않는다.

- `AiRunService`가 task 입력 사전 검사, 단계별 입력 보호, 공급자별 이미지 placeholder 반영, 문서 정리 결과의 다음 단계 연결, 최종 산출물·HTML 검증, 로컬/공동 반영과 히스토리 실패 복구를 소유한다. 파일 작업은 `AiStageWorkspace`/`LocalProjectRepository`, 실제 HTML 실행 검사는 주입한다. 고정 보호 prompt는 `run-prompt.ts`로 분리했고 내용/CLI 권한은 보존한다.
- `fileStageWorkspace`는 기존 `.history/{runId}/{workspace,input}` 형식과 실행별 `.gemini/settings.json`을 보존한다. 사용자의 개인 CLI 설정 파일을 수정하지 않는다.
- 실패 주입 검사에서 기존 반영 취소가 outputs 목록만 되돌려 자동 생성된 HTML 관리 문서를 남기는 문제를 발견했다. 같은 반영의 `changes` 전체를 기록/복구하도록 수정했다. 기존 문서·HTML과 입력이 모두 돌아오며 관련 검사도 유지한다.
- `AiQueueService`는 예약 중복/설정 고정, 실행 중 예약과의 파일 범위 충돌, 저장 성공 후 starting 전환, 실패한 영속 전환의 메모리 복구를 처리한다. `claimSharedAiRun`은 서버 lease를 잃은 요청을 로컬 실행으로 전환하지 않는다. FIFO/단일 슬롯과 기존 JSON 형식은 유지한다.
- `ApprovalService`를 앱과 Discord의 승인 실행 경로가 공유한다. 편집 flush 전후와 mutation 큐 진입 후에 권한/프로젝트 및 사용자의 해당 승인 권한을 다시 검사한다. legacy 즉시 실행과 지원 서버의 durable 예약을 구분하며 승인/예약 성공과 실행 완료는 별개다. Discord token·OS 암호화·transport는 기존 desktop 경계에 남는다.
- `DesktopBootstrap`에서 업데이트, 웹 뷰어, self-host 연결의 생성/재사용/종료를 소유한다. 같은 웹 뷰어의 반복 생성을 없애고 동기화 루프만 교체한다. self-host 동시 생성은 하나의 Promise를 공유하며, 한 종료가 실패해도 나머지 종료를 시도하고 실패를 main에 돌려준다. PC 서버의 독립 프로세스를 임의로 종료하는 정책은 추가하지 않는다.

현재 새 기능 단위 검사(프로세스 2, 실행 서비스 3, 큐 서비스 2, 승인 2, bootstrap 1)와 기존 검사를 합쳐 `npm test` **477개 통과, 실패/건너뜀 0**이다. 타입/strict contracts/strict core와 린트도 통과했다(기존 경고 2건 유지). 전체 integration과 AI 관련 실제 UI·현재 소스의 패키지 검증 결과는 다음 기록으로 확정한다.

R06 카드의 남은 정리: main에 있는 실행 이벤트/진단/최종 상태 전이 조립을 세션에 고정된 실행 coordinator로 더 줄이고 전체 완료 조건을 재확인한다. 이 단위를 구현한 사실만으로 R06 전체 완료를 선언하지 않는다. R04의 나머지 프로젝트/공동 IPC 조립·26개 명령 대응 검토, R05의 WorkspaceScreen 명령 콜백/패널 조립, R07 서버, R08 저장소/migration, R09 백업/복원, R10 Render 준비는 후속 단계다.

### 16.2 이번 기능 단위 검증 확정 및 다음 단계

이번 R06 기능 단위의 코드 수정과 검증을 마쳤다. 사용자가 요청한 단계별 검토를 위해 여기서 작업 단위를 닫고 다음 영역은 착수하지 않는다.

| 검사                                       | 최종 결과                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 기본 자동 검사                             | 477개 통과, 실패/건너뜀 0                                                                                                 |
| 타입/strict contracts/strict core          | 모두 통과                                                                                                                 |
| 린트/포맷                                  | 통과, 기존 경고 2건 유지                                                                                                  |
| 전체 integration                           | 통과. 2단계 AI·산출물 검증/취소/외부 변경·공동 승인·파일/히스토리·실제 Chromium·독립 4개 앱·한글 자동 저장 포함           |
| production 프로젝트 세션                   | 같은 경로 재개 후 늦은 읽기/저장 거부, 원래 문서와 durable scope 보존 통과                                                |
| production AI 예약                         | mock 공급자 3종 추론 설정·FIFO·파일 보호·개별 취소·서버 claim 통과                                                        |
| Discord 통합                               | mock 버튼→편집 flush→서버 승인→mock CLI→결과 반영→완료 알림, 중복 클릭/준비 중 연결 해제 차단 통과. 외부 메시지 전송 없음 |
| 실제 AI 관련 UI                            | ai-queue:ui, ai-dismissal, gamejam-approval, gamejam-validation, gamejam-history 5종 통과                                 |
| Windows package                            | 새 소스의 package 1회 생성, 빌드 전후 입력 지문 일치                                                                      |
| 같은 package의 AI 예약                     | 격리한 실제 Node mock CLI의 로컬 예약·개별 취소·2개 버전 반영, 내장 Node/서버와 독립 앱의 공동 예약/잠금/자동 실행 통과   |
| production renderer/실제 Electron 업데이트 | 홈 설정/다크·라이트/업데이트 안내/종료 handshake·실패 복구 통과. 설치 호출 없음                                           |
| 작업 보존                                  | 최초 dirty/new 파일 69개 모두 존재. reset/revert/commit/게시/실사용 데이터 이전 없음                                      |

소스 입력 지문은 `04db4d087aed2b4606ea29b0228328c8c8a1631de1d1e869d13f60211cf84bc0`이다. `out/refactoring-package-{inputs,verification}-2026-10-20.json`에 입력 목록과 결과물 크기/SHA-256을 기록했다. EXE SHA-256은 `8d1781bc079469a832903384f2eb007acc3173e3ba84c21e0d1faca81971f767`, app.asar는 `d6c152e924f2a0e427b078d5564606d2bd730a4b5f1587e122f687be12e933e6`이다. make/release나 업로드로 다시 빌드하지 않았다.

검증 로그는 `%TEMP%/gamejam-refactor-r06-final-*`, `gamejam-refactor-r06-ui-*`, `gamejam-refactor-r06-package*`에 있다. 새 경계 설명은 `docs/architecture/ai-execution.md`에 있다. 기존 Node typeless module/browser externalization 안내는 남아 있으며 검사 실패나 실제 공급자 인증 성공으로 해석하지 않는다.

현재 카드 상태: **R00/R01/R02/R03 구현 완료 유지**, **R04/R05 진행**, **R06 이번 기능 단위 완료·카드 진행**, **R07/R08/R09/R10 미완료**. 다음 작은 단위는 R06의 실행 이벤트·진단·최종 상태 전이를 시작 세션에 고정된 coordinator로 정리하는 것이다. 그 뒤 R04/R05의 남은 조립·완료 조건을 재확인하고 서버 단계로 넘어간다.

외부 환경 미확인: 실제 Codex/Claude/Gemini 로그인·과금/네트워크 실행, 실제 Discord 봇, Render 운영 배포·유료 자원, 실제 서버 데이터 이전, S3 업로드와 Windows→Linux 복원. F01~F04의 로그인/결제/웹 편집/iOS 기능은 범위에서 계속 제외한다.

## 17. 다음 기능 단위 — R06 실행 coordinator

사용자가 다음 단계를 요청해 16절의 남은 R06 실행 이벤트·진단·최종 상태 전이를 구현했다. 이 단위에서는 R04/R05 또는 R07~R10의 새 구현을 섞지 않는다.

- `application/ai/run-coordinator.ts`는 하나의 실행 Promise, 단계 전환, 취소, 결과 검증·반영 연결, 진단/히스토리/task의 최종 기록과 실행 슬롯 해제를 소유한다. main에서 process callback과 종료 상태 계산을 제거하고 시작 root/session/client/lease에 고정된 port를 조립한다.
- `AiRunEvents`는 시작 사용자·프로젝트·공급자 설정을 복사하고, 비밀 값 제거와 200개 이벤트 제한·상태 전환별 progress를 처리한다. 로컬 예약 저장은 캡처한 root의 큐만 갱신한다. 늦은 이벤트는 새 actor/session 정보로 바꾸지 않으며 현재 화면의 active 이벤트를 덮어쓰지 않는다.
- 공급자별 JSON line framing과 마지막 메시지/실패 해석은 `ProviderRunOutput`이 담당한다. 이전 단계 또는 완료한 프로세스의 늦은 callback은 coordinator가 버린다. 두 번째 단계에서는 이전 단계의 로그 buffer/결과를 초기화한다.
- `fileAiRunRecords`는 시작 경로의 task·히스토리·diagnostic만 읽고 쓴다. 기존 필드/출력 상대 경로·UTF-8 byte 수·SHA-256·diagnostic redaction 형식을 유지한다. 진단 기록 실패 시 존재하지 않는 링크를 제거하며, 개별 기록 실패가 실행 슬롯 해제를 막지 않도록 한다.
- 결과 반영 전에 session을 검사하고, 서버로 finish를 보내는 순간에도 캡처한 lease와 현재 lease가 같은지 검사한다. 교체된 lease의 작업을 종료하거나 공동 결과를 로컬로 우회 반영하지 않는다. 준비 단계 실패도 같은 root/actor/lease를 사용한다.
- 준비/실행의 기존 단일 슬롯, FIFO, CLI 권한/설정 격리, 2단계 산출물 전체 검증과 원자 반영, codex:\* IPC 및 저장 형식은 유지한다. 닫힌 창에는 AI 이벤트를 보내지 않으며 기록 작업은 별도로 계속한다.

새 단위 검사 10건(단일 실행/종료, 늦은 callback, 세션 교체, 단계 사이 취소, 중복 프로세스 취소, 기록 실패, zero exit의 공급자 오류, 두 단계 메시지 격리, lease 소실, 이벤트 identity/로그 한도와 실제 파일 진단 기록 포함)이 통과했다. 전체 기본 검사는 **487개 통과, 실패/건너뜀 0**, 타입/strict contracts/strict core 및 린트도 통과했다. 프로젝트 세션·Discord production mock·전체 integration이 통과했다. 창 종료 확인 guard 뒤 main 타입 검사도 다시 통과했다. 실제 UI와 같은 소스의 package 검증은 아래 최종 결과로 확정한다.

병렬 검사 중 기존 예약 mock에서 한 차례 취소 경합이 발생했다. 이 검사는 2초 후 자동 종료하는 모의 실행이 끝나기 전에 예약 추가·취소 검사를 마쳐야 했다. 같은 production 소스의 단독 재검사는 통과했다. `holdMockExecution` barrier를 테스트에 추가해 첫 실행을 명시적으로 대기시키고 기존 FIFO·잠금·취소·산출물 assertion을 그대로 유지했다. barrier를 넣은 production 큐 검사도 통과했다. 실제 실행 수·시간 제한을 늘리거나 실패 검사를 삭제하지 않았다.

R06 완료 조건 검토: 공급자/프로세스/업무 흐름/예약/승인/desktop 수명 경계를 구현했고 각 경계에 대한 검증이 연결됐다. main에 남은 것은 CLI 연결/입력 준비와 세션에 고정된 adapter 조립 및 기존 IPC다. 마지막 package 검증 뒤 R06 카드의 완료 상태를 확정한다. R04/R05의 남은 조립·26개 명령 대응/화면 분리와 R07~R10은 여전히 후속 단계다.

### 17.1 R06 완료 확정

| 검증                                          | 결과                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 기본 검사                                     | 487개 통과, 실패/건너뜀 0                                                                                     |
| 타입 / strict contracts / strict core         | 통과                                                                                                          |
| 린트 / 포맷                                   | 통과, 기존 경고 2건 유지. 마지막 guard와 테스트 barrier의 변경 파일도 재확인                                  |
| 전체 integration                              | 통과. 로컬·공동 AI, 단일/두 단계, 취소/검증 실패/입력 충돌/기록 복원, 실제 Chromium·4개 앱과 한글 저장 포함   |
| 프로젝트 세션 production IPC                  | 통과                                                                                                          |
| 예약 production main                          | barrier 반영 후 FIFO/취소/잠금/3종 추론 수준/서버 claim 모두 통과                                             |
| Discord production mock                       | 승인·flush·중복 클릭·준비 중 연결 해제·반영·알림 통과. 외부 메시지 전송 없음                                  |
| AI 실제 UI                                    | 예약·알림 복구·승인·요청 검증·히스토리 5종 모두 통과                                                          |
| Windows package                               | 이 단계 소스로 1회 생성. 빌드 전후 입력 일치                                                                  |
| 동일 package AI                               | 격리한 실제 Node mock CLI와 로컬/공동 예약·개별 취소·결과 2개, 내장 Node/서버 및 독립 앱 실행 통과            |
| 동일 빌드의 renderer / 실제 Electron 업데이트 | 홈/테마/업데이트 안내·종료 보호·handshake 실패 복구 통과. 설치 호출 없음                                      |
| 보존                                          | 최초 dirty/new 파일 69개 모두 존재, diff whitespace 검사 통과. reset/revert/commit/배포/운영 데이터 이전 없음 |

입력 지문 `4edb5ffe8c2a415a30eb5483e1b45811ad1c2c209bd26a59ec03686ce514f36e`. EXE SHA-256 `c483057cc4529194f1c2b63a1dbb3874dca611482720f585ef2c615e6f7b7887`, app.asar SHA-256 `d17d4b90512091e54ff705ef91b16b34af7bec2825d3ab0d062adb36fe36f0ed`. `out/refactoring-package-{inputs,verification}-2026-10-20.json`에 입력/크기/해시를 기록했다. 이전 16절의 검증 기록은 `%TEMP%/gamejam-r06-coordinator-start-higys0a4/out/`에 보존했다.

이번 로그는 `%TEMP%/gamejam-r06-coordinator-*`에 있다. 코드 수정과 해당 기능 단위 검증을 끝냈으므로 **R06 구현·검증 완료**로 갱신한다. 16절의 R06 진행 상태는 과거 작업 기록이다. 실제 AI 계정의 로그인/유료 실행·실제 Discord 전송·Render 운영 배포·S3/Windows→Linux 복원은 검증하지 않았고 성공으로 주장하지 않는다. Node typeless module과 기존 browser externalization 안내는 검사 실패와 구분한다.

현재 **R00/R01/R02/R03/R06 완료, R04/R05 진행, R07/R08/R09/R10 미완료**다. 단계별 진행 요청에 따라 이 단위에서 멈춘다. 다음 작은 단위는 R04의 남은 프로젝트·공동 IPC 조립을 서비스 경계로 정리하고 26개 편집 명령의 로컬/서버 대응을 검토하는 것이다. 이후 R05 화면 조립 완료 조건을 확인한 뒤 R07 서버 단계로 진행한다.

## 18. R04 다음 기능 단위 — 공동 편집 IPC와 명령 대응

사용자의 단계별 진행 요청에 따라 이번 단위는 main의 공동 편집 조회/명령 분리와 26개 계약 대응을 맡는다. 프로젝트 목록·휴지통·연결 관리 IPC와 R05/R07~R10 구현은 이번 단위에 섞지 않는다.

- `SharedWorkspaceReader`가 개인 접기 override와 CanvasView cache를 프로젝트 session별로 소유한다. 같은 client를 재사용하더라도 sessionId/epoch가 바뀌면 새 서비스를 만든다. 기존 개인 전역 collapse Map과 client별 canvasView 전역 Map을 main에서 제거했다.
- `SharedEditingService`는 인증된 client port를 사용해 명령·Undo/Redo와 성공 receipt의 journal 등록, mirror/trash 및 fresh 반환 DTO를 처리한다. 명령 전/권한 검사 후/서버 응답 후에 시작 session을 확인한다. 네트워크 권한·서버 revision/잠금·중복 receipt·오프라인 저장 정책은 기존 client/server가 계속 소유한다.
- `desktop/ipc/collaboration.ts`가 기존 wire를 service 호출로 변환한다. layouts:update의 배열→object 변환, saveDocument의 void→상세 문서, 그림의 void→최신 목록, 개인별 접기의 무공유/무기록 동작을 유지한다. 새 외부 IPC를 등록하거나 token을 service에 전달하지 않는다.
- 상세 문서·저장 응답에는 기존 workflowRevision을 포함하고 목록 응답에는 새 필드를 추가하지 않는다. 바뀌지 않은 HTML을 텍스트/배치 편집에 다시 전송하지 않는다. 로컬 metadata-only/partial capture와 개인용 게임 UI의 기존 검증·한도도 유지한다.
- 26개 비교 중 상태/칸반/HTML metadata/가져오기 계산의 일부 시각·ID가 직접 생성되는 지점을 확인했다. 기존 CommandEnvironment를 해당 helper에 선택 인자로 전달했고 기본 Date.now/UUID와 import 파일명·JSON/Markdown 형식을 보존한다. 도형·게임 UI 등 모든 세부 action의 생성기를 완전히 바꿨다고 주장하지 않는다.

새 `shared-editing.test.mjs` 60건이 통과했다. 26개 명령 각각의 대표 성공/거절과 정확한 명령 목록, 전체 명령 commit 실패, 원본/HTML/unknown frontmatter 보존, 상태·권한·session 경합, 개인 접기/cache 격리와 no-HTML-resend, Undo/Redo 실패, 시각·ID 전달을 포함한다. 이 비교에서 로컬 경로는 공통 LocalCommandService이며 specialized 파일 서비스의 전체 동작을 대체하지 않는다. 차이와 연결 표는 `docs/architecture/editing-commands.md`에 기록했다.

전체 기본 검사 **547개 통과, 실패/건너뜀 0**, 타입/strict contracts/strict core/린트 통과(기존 경고 2건 유지). production main의 프로젝트 session과 AI 예약/claim도 통과했다. 파일/HTTP/SSE·실제 Chromium 통합 및 새 package의 결과는 다음 최종 기록으로 확정한다. R04 전체 완료를 뜻하지 않는다.

### 18.1 공동 편집 기능 단위 검증 확정

| 검증                                  | 결과                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 자동 검사                        | 547개 통과, 실패/건너뜀 0. 새 공동 편집 검사 60개 포함                                                                                       |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                    |
| 린트 / 포맷                           | 통과, 기존 경고 2건 유지                                                                                                                     |
| 전체 integration                      | 통과. 파일·히스토리 보존, 두 단계 AI/결과 검증, 공동 승인, Chromium, 독립 4개 앱, 캔버스 전환과 한글 자동 저장 포함                          |
| production 프로젝트 session / AI 예약 | 모두 통과. 늦은 IPC 거부, FIFO·개별 취소·파일 보호·3종 공급자 추론 설정과 서버 claim 포함                                                    |
| 실제 autosave UI                      | HTTP/SSE 서버와 peer 갱신 중 제목·본문·source·focus 편집기의 DOM/포커스/선택 유지, 잠금 해제 대기 중 입력 보존과 상대 앱 최종 내용 수렴 통과 |
| 실제 HTML preview UI                  | production preview의 테마·경고·3개 크기·접기/펼치기·전체화면 통과                                                                            |
| Windows package                       | 현재 소스에서 1회 생성, 빌드 전후 입력 지문 일치                                                                                             |
| 같은 package 게임 UI / 클립보드       | inspector·원자 범위/Undo·Markdown 저장, native Ctrl+V·내부/외부 복사·Undo/Redo·다시 로드·프로세스 재시작 보존 모두 통과                      |
| 같은 package AI 예약                  | 격리한 실제 Node mock CLI의 로컬 예약/개별 취소/결과 2개, 내장 Node/서버와 독립 앱의 공동 예약·잠금·자동 실행 모두 통과                      |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재, diff whitespace 검사 통과. reset/revert/commit/배포/운영 데이터 이전 없음                                |

입력 지문은 `a9aebcb5cd00c69ce7700acc74036de5434e6e79469ffbd08ff99cc5b60c8155`다. EXE SHA-256은 `c8303bb7d9d2d806d17de8d8d1b0a04e9bcb8efd9240280ea7376da1af76073b`, app.asar SHA-256은 `83451111a0833edbbdf3b6606a9d034e627a625be6c8120ac67198355ba7dce3`다. `out/refactoring-package-{inputs,verification}-2026-10-20.json`에 입력 목록·크기·해시를 기록했다. 이전 17절의 package 기록과 이번 단위 시작 원본은 `%TEMP%/gamejam-r04-shared-start-ivg7e719`에 보존했다. 검증 로그는 `%TEMP%/gamejam-r04-shared-*.log`에 있다. 기존 Node module/browser externalization·bundle 크기·gray-matter eval 안내는 검사 실패와 구분한다.

이번 단위는 구현·검증 완료다. **R00/R01/R02/R03/R06 완료, R04/R05 진행, R07/R08/R09/R10 미완료**를 유지한다. 다음 작은 단위는 R04의 프로젝트 목록·폴더·휴지통·연결 관리 IPC를 서비스 경계로 정리하는 것이다. 잔여 mutation wrapper/mirror adapter 조립과 specialized local 서비스 대응 확인, R05 화면 조립 완료 조건은 후속으로 남아 있다. 단계별 진행 요청에 따라 이번에는 다음 단위에 착수하지 않는다.

실제 AI 계정 인증·유료 실행, Discord 외부 전송, Render 자원 생성/운영 배포, 실제 서버 데이터 이전, S3 업로드·Windows→Linux 복원은 수행하지 않았다. F01~F04의 로그인·결제·웹 편집·iOS 구현도 범위에서 계속 제외한다.

## 19. R04 다음 기능 단위 — 프로젝트 홈·휴지통·연결 관리 IPC

사용자의 다음 단계 요청에 따라 기존 25개 projects:\* IPC를 실제 업무 서비스와 파일/서버 adapter에 연결했다. R04 전체 또는 R05/R07~R10을 완료 처리하지 않는다.

- `ProjectHomeService`는 로컬/공동 목록 보강, 이름 변경, 홈/열기/생성/폴더 분류, 연결 주소 검사·적용과 휴지통 전후 대기 순서를 맡는다. 프로젝트 열기 전에 휴지통/현재 프로젝트/실제 폴더를 검사하며 취소된 폴더 선택이나 유효하지 않은 이름은 현재 프로젝트를 정지하지 않는다.
- `desktop/ipc/projects.ts`는 기존 25개 채널을 정확히 한 번씩 등록한다. main의 mutation 직렬화·AI 작업 보호·외부 창/프레임 거부와 연결 정보 sender 검사를 유지한다. preload와 공개 반환 형식을 변경하지 않는다.
- `HomeProjectRegistry`의 desktop 구현은 credentials/localRoot를 제외한 공개 항목만 application에 제공한다. token/recovery key·OS 암호화·registry 저장 형식은 기존 ProjectLibrary에 남는다. 로컬 무료 사용에 로그인·구독·서버를 추가하지 않았다.
- `filesystemHomeProjects`는 기존 로컬 이름/시각/폴더 확인/생성과 project.md 이름 저장을 맡는다. unknown frontmatter/본문, expectedName과 쓰기 직전 원문 비교, 임시 파일 정리, before/after 히스토리, `.canvas/project.json`을 유지한다. 삭제된 project.md는 이름 변경으로 재생성하지 않는다. 여러 파일/registry/history를 새 원자 트랜잭션으로 바꿨다는 의미는 아니다.
- `desktopSharedProjects`는 캐시·인증된 HTTP와 client를 소유한다. 기본 목록은 서버에 접속하지 않고, 명시적인 refresh만 lifecycle/metadataOnly를 읽는다. 오프라인 목록·미반영 건수·역할·이전 이름과 inactive lifecycle을 보존한다. 이름 변경은 cache drain 및 offline/outgoing 검사 뒤 기존 expectedName 계약을 사용한다.
- 추출 중 내장 PC 서버의 과거 포트를 metadata 조회/이름 변경/열기에 사용할 수 있는 경로를 확인했다. 내장 서버 항목은 현재 실행한 서버의 주소를 조립하도록 보완했다. 외부 서버 항목은 저장된 주소를 계속 사용한다. 실제 임시 PC 서버의 기본 인증 transport와 패키지 재시작으로 확인했다.
- 휴지통은 viewer 동기화 중지 → 게시 완료 대기 → 프로젝트 보존/정지 → 저장 큐 정지 → cache 완료 → 기존 ProjectTrash 순서이며 실패도 finally에서 viewer 동기화를 재시작한다. 준비 token·이름·버전·7일 보관·암호화·복원/ack/purge의 기존 정책과 저장 형식을 유지한다. 새 삭제 정책은 추가하지 않았다.

### 19.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 프로젝트 홈 단위/adapter 검사      | 22개 통과. 오프라인/서버 오류·이름 충돌·실패 후 무인정·휴지통 5개 대기/반영 지점 실패·sender·비밀 값 경계·파일/히스토리 보존·동시 원문 변경·현재 내장 서버 주소 포함                                        |
| 전체 기본 자동 검사                   | 569개 통과, 실패/건너뜀 0                                                                                                                                                                                   |
| 타입 / strict contracts / strict core | 통과. 기본 타입 검사는 최종 소스에서 재확인                                                                                                                                                                 |
| 린트 / 포맷                           | 통과. 새 패키지 검사 문자열 escape 경고 2건은 수정 후 해당 파일 oxlint/포맷 재검사 통과. 기존 경고 2건만 남음                                                                                               |
| production 프로젝트 세션              | 기존 session 변경 뒤 지연 읽기/저장 거부 및 원문/durable scope 보존 통과                                                                                                                                    |
| 전체 integration                      | 통과. 로컬 홈 생성·이름·분류·폴더 확인, 공동 관리자 membership/암호화된 선택/오프라인 IPC 편집의 서버 종료·재시작 보존, AI/파일/히스토리, 외부 휴지통 sender 차단, Chromium/4개 앱/실제 한글 자동 저장 포함 |
| Windows package                       | 최종 소스로 1회 생성. 빌드 전후 입력 지문 일치                                                                                                                                                              |
| 같은 package 실제 홈 UI/IPC           | UI 이름 변경·홈 폴더 생성/이동·프로젝트 열기, 임시 프로젝트의 실제 휴지통 이동과 파일/초안/분류 복원, 내장 서버 공동 이름/목록과 관리자 권한 통과                                                           |
| 같은 package 프로세스 재시작          | 홈 분류·공동 세션 유지, 현재 내장 서버 주소의 metadata/열기/재연결, 연결 정보 검사·저장 통과. 외부 주소로 실제 연결하지 않음                                                                                |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 기존 25개 프로젝트 채널과 대조 일치, diff whitespace 검사 통과                                                                                                          |

입력 지문 `a1ed63b4b65d167df2507362d0bd17e9f0946b0c517a4aac630ac9cf31120d5e`. EXE SHA-256 `0cf6e19a758a22c5dcf0a0aab6b8086c17e6fee3612b2c7dafac80541e93c6e4`, app.asar SHA-256 `7d1ecaf7fbed0a29605139ca312acc8cc51df867b4a9ff745af8f605c8a76059`. 입력/크기/해시 증거는 `out/refactoring-package-{inputs,verification}-2026-10-20.json`이다. 이전 18절 package 기록과 이번 시작 원본은 `%TEMP%/gamejam-r04-projects-start-a6f69c2bee274164a498b8b88dfa14ea`에 보존했다. 로그는 `%TEMP%/gamejam-r04-projects-*.log`, 경계 설명은 `docs/architecture/project-home.md`다.

현재 **R00/R01/R02/R03/R06 완료, R04/R05 진행, R07/R08/R09/R10 미완료**다. 이번 프로젝트 홈 단위는 구현·검증 완료이며 단계별 요청에 따라 여기서 멈춘다. 다음 작은 단위는 R04의 공동 파일 mirror/휴지통 반영 adapter와 잔여 편집 mutation wrapper 정리다. collaboration 생성/참여/복구·오프라인 충돌 해결 등의 남은 IPC 조립과 specialized local 서비스 대응을 확인한 뒤 R04 완료 조건을 다시 검토한다. R05의 WorkspaceScreen 명령/패널 조립, R07~R10 서버·저장소·백업·Render 준비도 후속으로 남아 있다.

실제 AI 계정 인증/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3 업로드/Windows→Linux 복원은 수행하지 않았다. 임시 데이터·UUID 프로필·로컬 서버만 사용했다. F01~F04의 로그인·결제·웹 편집·iOS 기능도 계속 범위에서 제외한다. reset/revert/commit/make/release/게시 없음.

## 20. R04 다음 기능 단위 — 공동 파일 사본·휴지통과 로컬 mutation 경계

이번에는 19절의 다음 작업인 공동 파일 mirror/휴지통 반영 adapter와 잔여 로컬 편집 mutation wrapper를 구현했다. 사용자의 단계별 요청에 따라 공동 생성/참여/복구나 R05/R07~R10 구현은 섞지 않는다.

- `SharedProjectMirror`와 `filesystemSharedProjectFiles`가 layout 준비·snapshot 읽기·결과 폴더 이동·원자적 파일 반영·OS 휴지통·빈 이전 폴더 정리를 소유한다. 시작 root/session을 고정하고 target snapshot도 대기 전에 복사한다. main의 syncSharedSnapshot/trashWorkspaceFiles/moveWorkspaceResults를 제거하고 shared editor와 AI 준비·경로 열기에 서비스를 조립했다.
- 물리 결과 이동부터 metadata 반영까지 파일 감시를 정지한다. 반영 전 실패/세션 교체는 보조 파일·개인 preview 설정까지 원래 root로 rollback한다. 파일 반영 성공 뒤의 휴지통 실패·세션 변경은 이미 반영한 폴더만 역이동하지 않는다. 기존 파일 외부 변경 검사와 서버 receipt/Undo 의미를 유지한다. mirror 오류를 로컬 우회 저장이나 서버 명령 취소로 처리하지 않는다.
- `sessionProjectFileEffects`를 local command·history/Undo와 공동 mirror가 공유한다. 중복 resume는 한 번만 실행하고 이전 세션 종료 처리가 새 watcher를 지우거나 시작하지 않는다. `startSessionProjectWatcher`는 비동기 close 뒤에도 세션을 재검사해 원래 root만 감시하며, 늦은 이벤트를 새 화면에 보내지 않는다. 기존 chokidar 제외/안정화 설정은 유지했다.
- 공유 path reveal/open-folder의 사본 준비도 기존 mutation 큐를 거치게 했다. 프로젝트 전환이나 결과 이동/저장과 사본 쓰기가 교차하지 않게 보완했으며 IPC/preload와 native 열기 정책은 유지한다.
- `LocalMutationService`가 기존 local handler의 전후 비교·workflow 기본값·히스토리 인정·변경 알림을 처리한다. 단일 Markdown partial capture, 변경 없는 HTML 미포함, clipboard/manual command의 한 번만 기록, AI 요청의 기존 label/Undo 제외 의미를 유지한다. journal은 시작 세션의 것을 주입한다. 전문 서비스의 쓰기와 native 효과 전체를 새로운 단일 트랜잭션으로 바꿨다고 주장하지 않는다.
- `ensureProjectLayout`에 기존 디렉터리·초기 project.md marker·output/README.md 준비를 추출해 캡처한 root에 연결했다. 기존 Markdown/JSON·캐시·offline/outgoing·히스토리와 협업 프로토콜 형식은 바꾸지 않았다.

새 검사 작성 중 결과 이동 fixture의 입력 필드/분류를 잘못 사용한 문제를 수정했다. 또한 tracked JS 파일을 snapshot에서 제거한 뒤 OS 휴지통에 남을 것으로 기대한 테스트 가정이 기존 동작과 달랐다. 서버 snapshot에 실제 tracked asset을 포함하고, 실제 삭제 reducer와 untracked 보조 파일을 함께 검사하도록 fixture를 보완했다. 추적 파일 먼저 반영/제거 → 남은 결과 폴더를 OS 휴지통 처리하는 기존 제품 순서는 변경하지 않았다. 실패 검사를 삭제하거나 제품 삭제 정책을 바꿔 통과시키지 않았다.

### 20.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 서비스/adapter 검사                | 33개 통과. mirror 실패 순서/rollback/commit 이후 오류, 실제 임시 결과 폴더·asset·개인 설정, 외부 변경, watcher close/재시작/늦은 이벤트, partial capture/workflow/히스토리 중복/세션 실패 포함                                                            |
| 전체 자동 검사                        | 최종 602개 통과, 실패/건너뜀 0                                                                                                                                                                                                                            |
| 타입 / strict contracts / strict core | 통과. 마지막 watcher 설치 guard 뒤 기본 타입 검사 재통과; contracts/core 소스 변경 없음                                                                                                                                                                   |
| 린트/포맷                             | 통과, 기존 경고 2건 유지. 마지막 package 감시 사례의 테스트 파일도 oxlint/포맷 통과                                                                                                                                                                       |
| production 프로젝트 세션              | 마지막 watcher guard 뒤 재통과. 같은 root 재개 시 지연 읽기/저장 거부·원문/durable scope 보존                                                                                                                                                             |
| production AI 예약                    | FIFO·개별 취소·파일 보호·3종 공급자 추론 설정·서버 claim 통과                                                                                                                                                                                             |
| 전체 integration                      | 통과. 파일/폴더 이동·히스토리/Undo·local/shared AI·미반영 캐시·프로젝트 홈·실제 Chromium/4개 앱·한글 자동 저장 포함. main 번들을 만든 뒤 watcher 설치 guard를 보강했으므로 최종 guard는 위 최종 단위/타입/production 세션과 아래 실제 package로 추가 확인 |
| Windows package                       | 최종 소스로 1회 생성, 빌드 전후 입력 지문 일치                                                                                                                                                                                                            |
| 같은 package 공동 파일/전환           | 실제 내장 서버의 결과 이동·tracked asset/untracked 보조 파일·개인 창 설정, 공동 Undo/Redo/삭제/사본 재구성, 원래 local 자료 보존과 프로젝트 전환 후 local 저장 통과                                                                                       |
| 같은 package 실제 파일 감시           | 프로젝트 전환 뒤 디스크에서 외부 수정한 한글 문서의 이벤트 수신·최신 내용 확인 통과                                                                                                                                                                       |
| 같은 package 클립보드                 | native Ctrl+V·내부/외부 복사·Undo/Redo·다시 로드/완전 재시작 보존 통과                                                                                                                                                                                    |
| 같은 package AI 예약                  | 격리한 실제 Node mock CLI의 local 예약/개별 취소/결과 2개, 내장 Node/서버와 독립 앱의 shared 예약·잠금·자동 실행 통과                                                                                                                                     |
| 작업 보존                             | 최초 dirty/new 파일 69개 모두 존재, 원래 mutation label 24개와 일치, diff whitespace 검사 통과                                                                                                                                                            |

입력 지문 `bf6fc9f03e852bba84d4dc17e9557d33378b3c5430b7b58210a638c68486a422`. EXE SHA-256 `08805b0a81f92af4c09616f444e367bf8be68f3a48b753e0992471ca9520f9bc`, app.asar SHA-256 `925a8680a0802e91be4a6403f3834f934e005578f6c7b234eb6151e5361aecbf`. `out/refactoring-package-{inputs,verification}-2026-10-20.json`에 입력/크기/해시를 기록했다. 이전 19절의 package 기록과 이번 시작 원본은 `%TEMP%/gamejam-r04-mirror-start-8c6996a7b8b04799a9b19fa4ec2546ce`에 보존했다. 로그는 `%TEMP%/gamejam-r04-mirror-*.log`, 경계 설명은 `docs/architecture/project-files.md`다.

이번 공동 파일·로컬 mutation 기능 단위는 구현·검증 완료다. **R00/R01/R02/R03/R06 완료, R04/R05 진행, R07/R08/R09/R10 미완료**를 유지하며 여기서 멈춘다. 다음 작은 단위는 R04의 공동 프로젝트 생성·참여·복구·탈퇴·오프라인 충돌 해결 IPC와 세션/캐시 보존 조립 분리다. 그 뒤 specialized local 대응과 R04 전체 완료 조건을 다시 확인한다. R05 WorkspaceScreen 조립과 R07~R10은 여전히 남아 있다.

검증은 임시 root·UUID 프로필·로컬 서버를 사용했다. 실제 AI 계정 인증/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원은 수행하지 않았다. F01~F04 기능은 이번 범위에서 계속 제외한다. reset/revert/commit/make/release/게시 없음.

## 21. R04 다음 기능 단위 — 공동 연결 IPC와 세션/캐시 보존

20절의 다음 작업인 공동 생성·참여·복구·탈퇴·오프라인 충돌 해결 IPC와 세션/캐시 조립을 분리했다. 이번 단위를 R04 전체 완료로 간주하지 않으며 R05/R07~R10 구현은 섞지 않는다.

- `CollaborationService`와 token을 노출하지 않는 `ConnectionOffer`/active session port가 사전 조건과 생성/참여/복구 순서, 충돌 선택 전 백업, 초대 갱신 후 저장을 담당한다. 계정 로그인·구독·CLI 서버 실행을 추가하지 않았다.
- `desktop/ipc/collaboration-session.ts`로 기존 11개 세션 IPC를 옮겼다. 협업 전체 14개 wire를 이전 main과 대조해 정확히 한 번씩 보존했다. 생성/참여/복구/탈퇴/충돌 해결/복원 재개/초대/역할 변경은 property flush 후 기존 mutation 큐를 사용한다. 홈/열기와 늦은 연결 응답이 교차하지 않게 했으며, lock/unlock/read는 편집 flush와의 교착을 피하도록 기존 독립 경로를 유지한다. 서버의 권한·입력 검증과 preload/sender 계약은 그대로다.
- `DesktopCollaborationSessions`가 시작 root/client/sessionId/epoch에 고정된 활성화·홈 보존·탈퇴·원격 연결과 이벤트 조립을 맡는다. 초안/저장/cache 보존, watcher 종료, cache seed 검증, refresh, client 시작, 암호화 세션/목록 저장 순서를 유지한다. 이전 연결의 늦은 응답과 lobby/state 이벤트는 새 화면/root를 덮어쓰지 않는다.
- 생성/참여/복구가 서버에서 성공했지만 그 사이 session이 바뀌거나 캐시/보존 단계 오류로 로컬 활성화에 실패한 경우, 받은 접속 정보를 기존 암호화 ProjectLibrary에 남기고 오류를 반환하도록 보완했다. 원격 프로젝트나 membership을 자동 삭제하지 않고 새 프로젝트로 강제 전환하지 않는다. 기존 파일 형식으로 나중에 다시 열 수 있게 하는 보존 조치다. 깨진 cache 바이트는 덮어쓰지 않는다.
- `CollaborationCacheQueue`가 기존 cache 중복 방지 키·직렬 저장·실패 재시도와 root 고정을 소유한다. offline/outgoing을 대기 전에 복사하고 캐시 state의 inviteCode/recoveryKey/conflicts를 제거한다. format 2/blob·receipt·offline transaction 형식과 로컬/공동 분리는 유지한다.
- `CollaborationSessionStore`가 기존 OS 암호화 `collaboration-session.enc`, 정상 시작 시 읽기, 휴지통의 일치하는 참조 제거와 `.history/offline-resolution-{historyId}/draft.json` 백업을 맡는다. 기존 추가 JSON 필드도 보존한다. 암호화를 사용할 수 없으면 평문 우회 저장하지 않는다. 백업 실패/세션 교체 시 충돌 선택을 실행하지 않는다. 서버 merge·히스토리와 명시적 local/server 선택 의미는 바꾸지 않았다.
- 미동기화 offline/outgoing 또는 AI 실행 중에는 기존처럼 탈퇴를 막는다. 홈 이동은 membership·자격 정보·미반영 작업을 보존한다. 허용된 탈퇴만 서버 leave·목록 제거·이전 local root 복귀·암호화 세션 해제를 수행한다. PC 서버 생성과 self-host key 선택 정책도 유지한다.

### 21.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 새 서비스/desktop 검사                | 25개 통과. 사전 조건/실패/지연 응답/암호화 자격 정보 보존, cache dedup/retry/순서/비밀 값, 충돌 백업 실패, 실제 임시 PC 서버의 생성/참여/복구/탈퇴·오프라인 홈·손상 cache·새 root 보호·휴지통 참조 제거 포함 |
| 전체 자동 검사                        | 627개 통과, 실패/건너뜀 0                                                                                                                                                                                    |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                    |
| 린트 / 포맷                           | 통과. 추출 후 사용하지 않는 main import 1개를 제거하고 변경 파일/새 package 검사 oxlint·포맷 확인. 기존 경고 2건 유지                                                                                        |
| production 프로젝트 세션              | 같은 root 재개 후 늦은 읽기/저장 거부·원문/durable scope 보존 통과                                                                                                                                           |
| production AI 예약                    | FIFO/개별 취소/파일 보호·3종 추론 설정·서버 claim 통과                                                                                                                                                       |
| 전체 integration                      | 통과. 로컬/공동 편집·파일/Undo/히스토리·공동 승인과 AI·서버 중단/재개·홈 보존·실제 Chromium/4개 앱·한글 자동 저장/충돌 초안 포함                                                                             |
| Windows package                       | 최종 소스로 1회 생성, 빌드 전후 입력 지문 일치                                                                                                                                                               |
| 같은 package 공동 연결/실제 충돌 UI   | 내장 Node/서버에서 생성·참여·복구·탈퇴·초대 회전/역할 변경, 서버 중단 중 저장과 탈퇴 거부·홈 보존, 재접속 후 실제 UI의 서버 버전 선택과 선택 전 로컬 draft.json 백업, 원래 local 자료/작업 경로 복귀 통과    |
| 같은 package 홈/휴지통/재시작         | 실제 홈 이름/분류/열기, 임시 프로젝트 파일·초안·분류의 trash/restore, 내장 서버 주소 갱신·관리자 세션 보존·연결 정보 적용 통과                                                                               |
| 같은 package AI 예약                  | 격리한 실제 Node mock CLI의 local 예약/취소/결과 2개와 내장 Node/서버·독립 앱의 shared 예약/잠금/자동 실행 통과                                                                                              |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 기존 협업 wire 14개 대조 일치, diff whitespace 검사 통과                                                                                                                 |

입력 지문 `5b0406439c4243db78526f30e2cb1958e72cb9b46fbb1aaf5100a7c8bc112cf2`. EXE SHA-256 `448234fd5bbabbb607cb8971d52c3013c523f867e9431dccc8088d799ea47918`, app.asar SHA-256 `b4abda530f5ecc957340369d924c8429fd54fb65591acb317fb631a499a655bf`. `out/refactoring-package-{inputs,verification}-2026-10-20.json`에 입력/크기/해시를 기록했다. 이전 20절의 package 기록과 이번 시작 원본은 `%TEMP%/gamejam-r04-collaboration-start-4122ba7648574a19892d853d3f2c5d44`에 보존했다. 로그는 `%TEMP%/gamejam-r04-collaboration-*.log`, 경계 설명은 `docs/architecture/collaboration-session.md`다.

이번 공동 연결/세션 보존 기능 단위는 구현·검증 완료다. **R00/R01/R02/R03/R06 완료, R04/R05 진행, R07/R08/R09/R10 미완료**를 유지하며 단계별 요청에 따라 여기서 멈춘다. 다음 작은 단위는 R04의 26개 명령과 specialized local/shared 저장·히스토리의 최종 대응 점검, 잔여 native IPC 조립 정리와 카드 완료 조건 확인이다. R05 WorkspaceScreen 명령/패널 조립과 R07~R10 서버·저장소·백업·Render 준비도 남아 있다.

모든 검증은 임시 root·UUID 프로필·로컬 서버를 사용했다. 실제 AI 계정 인증/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원은 수행하지 않았다. F01~F04 로그인·결제·웹 편집·iOS 기능은 이번 범위에서 계속 제외한다. reset/revert/commit/make/release/게시 없음.

## 22. R04 최종 기능 단위 — 명령 대응·편집 기록·native 파일 IPC 점검

2026-10-21, 21절의 다음 작업을 진행했다. 이번 단위는 R04의 26개 명령과 specialized local 저장/히스토리 대응, 남은 native 파일 IPC와 완료 조건 점검이다. R05나 R07~R10 새 구현은 섞지 않았다.

- `UserEditRecorder`에 기존 사용자 히스토리 작성과 Undo 인정 규칙을 추출했다. ID/시각은 주입하고 시작 프로젝트의 journal을 고정한다. 변경 없는 저장은 기록하지 않으며, AI 작업 요청과 task-only 접기의 Undo 제외를 유지한다. 네 manual command(rename/delete-many/color/layout)는 `RecordedCommandPublisher`가 파일 반영 뒤 한 번만 기록한다. 기록 실패를 Undo/변경 알림 성공으로 인정하지 않는다.
- `DesktopProjectPaths`와 `desktop/ipc/project-files.ts`로 기존 authorship/reveal/open-folder 세 wire를 분리했다. 시작 root/session을 고정하고 읽기/realpath/native shell 전후에 세션을 확인한다. 경로 탈출·외부 symlink/junction 거절과 기존 preview 경로 정책을 유지한다. 프로젝트를 열지 않은 홈의 늦은 미리보기 요청은 내용을 반환하지 않는다.
- 실제 코드 점검에서 섹션 삭제/문서 복제의 `ID 불일치 && 경로 불일치` 조건은 읽은 경로가 같으면 ID 교체를 놓치는 것을 확인했다. ID를 직접 검증하고 문서/섹션 배치의 선택 objectId도 확인한다. 섹션 경로·유한 좌표·삭제 boolean 검증을 부작용 전에 수행한다. ID 없는 기존 파일의 경로 ID와 섹션 최소 420×280, rename 멤버 ID 재탐색은 유지했다.
- 섹션 배치/다른 섹션 삭제 후 멤버십 정리 시 생성용 본문과 알려진 frontmatter만 다시 쓰던 경로를 수정했다. 기존 사용자 본문·추가 metadata·status/type을 보존하며 기존 원자적 apply/외부 수정 검사를 계속 사용한다. 문서·파일·프로토콜 형식 이관은 없다.
- `docs/architecture/editing-commands.md`의 26개 대응표를 갱신하고 `docs/architecture/r04-completion.md`에 계획의 각 조건·구현·검증·범위를 연결했다. 공통 reducer 매트릭스와 specialized native 전용 검사를 구분한다. 계획의 원자성 유지 조건을 native OS 휴지통 전체에 새 전역 트랜잭션을 추가하는 것으로 해석하지 않았다. 기존 순차 섹션 휴지통·멤버 배치의 개별 오류 기록 정책은 그대로다.

새 패키지 fixture를 처음 작성할 때 한 문서를 두 섹션에 중복 소속시켜 기존 Undo의 전체 소속 검증이 거절했다. 정상 소속 fixture로 수정하고 섹션/멤버 삭제·다른 섹션 보존·실제 Undo 복원을 다시 확인했다. 중복 소속을 허용하거나 기존 검증을 약화하지 않았다. legacy 중첩 소속의 삭제 후 멤버십 정리/본문 보존 자체는 실제 임시 파일을 사용하는 section-service 검사로 따로 확인했다. 최초 실패 로그도 보존했다.

### 22.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 관련 서비스/desktop 회귀              | 21개 통과. 교체 ID 거절·부작용 없는 잘못된 입력·legacy 경로 ID·섹션 본문/metadata·기록 실패/중복/Undo 제외·root와 symlink/session 검사 포함                                                                                 |
| 전체 자동 검사                        | 640개 통과, 실패/건너뜀 0. 마지막 native 경로 테스트의 junction 정리 보강 후 해당 3개도 재통과                                                                                                                              |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 main의 사용하지 않는 import 제거·홈 preview guard 뒤 기본 타입 재통과                                                                                                                                     |
| 린트 / 포맷                           | 통과, 기존 경고 2건 유지. 이번 추출로 발생한 불필요 import 2개 제거                                                                                                                                                         |
| production 프로젝트 세션              | 같은 root 재개 후 늦은 읽기/저장 거부·원문/durable scope 보존 통과                                                                                                                                                          |
| production AI 예약                    | FIFO/개별 취소/자료 보호·3종 공급자 추론 설정·서버 claim 통과                                                                                                                                                               |
| 전체 integration                      | 로컬/공동 편집·파일·Undo/히스토리·요청/승인/mock AI·서버 중단/재개·홈 보존·실제 Chromium/4개 앱·캔버스 전환·한글/IME 자동 저장·충돌 초안 통과. 마지막 main의 import 정리/홈 preview guard는 추가 타입과 최종 package로 확인 |
| Windows package                       | 최종 소스로 1회 생성. source/config/runtime 입력 지문 일치                                                                                                                                                                  |
| 같은 package R04 신규 회귀            | 실제 홈에서 열기·잘못된 ID 4종 거절/무변경/무기록, 섹션 이동/이름/복제의 한 번만 기록, 사용자 본문/metadata·기존 copy ID, 실제 OS 휴지통/Undo/Redo·완전 재시작 보존 통과                                                    |
| 같은 package clipboard                | native Ctrl+V·내부/외부 복사·title focus·Undo/Redo·reload·완전 재시작 보존 통과                                                                                                                                             |
| 같은 package 게임 UI                  | 실제 inspector·개인 width/floating·잘못된 초안/Escape·범위 변경 원자성/Undo·Markdown 보존·완전 재시작 통과                                                                                                                  |
| 같은 package 공동 파일                | 내장 서버의 결과 이동·tracked asset/untracked 보조 파일·개인 창 설정·Undo/Redo/삭제/사본 재구성·프로젝트 전환·외부 파일 변경 감시 통과                                                                                      |
| 같은 package AI 예약                  | 격리한 실제 Node mock CLI의 local 예약/취소/결과 2개, 내장 Node/서버·독립 앱의 shared 예약/잠금/자동 실행 통과. 실제 AI 계정 사용과 구분                                                                                    |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 시작 원본과 이전 package 기록 보존, diff whitespace 검사 통과                                                                                                                           |

입력 지문 `a472dc70c6b2829668bd2f69cb3ab50102972925a80cd3f85839e7414e75d7d0`. EXE SHA-256 `a193257d94fa9a1691eafd64ddc66c8672967ab94d88a57bfa03278a1db3eb87`, app.asar SHA-256 `b71a8c98533179dbcd8e895d644fe876e7aba539776fed117dcac1dc04457766`. 새 날짜의 `out/refactoring-package-{inputs,verification}-2026-10-21.json`에 입력/크기/해시를 기록했다. 21절의 2026-10-20 기록도 유지했다. 이번 시작 원본은 `%TEMP%/gamejam-r04-final-start-0b0fd3efa00e44d8ba4562bc02f8da78`, 로그는 `%TEMP%/gamejam-r04-final-*.log`다.

**R04 완료 조건을 충족했다.** 편집 규칙은 core/application, 파일/native 효과는 adapter/desktop으로 옮겼으며 main은 기존 queue/sender/session과 서비스 등록·조립을 연결한다. 26개 명령의 대표 성공/충돌, native 차이와 실제 편집/파일/히스토리 회귀를 연결했다. 모든 하위 action을 각각 실제 서버/패키지에서 실행했다고 주장하지 않는다.

현재 상태는 **R00/R01/R02/R03/R04/R06 완료, R05 진행, R07/R08/R09/R10 미완료**다. 사용자의 단계별 진행 요청에 따라 이 단위에서 멈춘다. 다음 작은 단위는 R05의 `WorkspaceScreen` 창·패널 조립을 `WorkspacePanels` 경계로 추출하면서 열림/닫힘·포커스 복귀·Escape·z-index 책임을 함께 정리하는 것이다. 잔여 화면 명령 콜백까지 R05 완료 조건을 확인한 뒤 R07 서버, R08 저장소/migration, R09 백업/복원, R10 Render 설정·검증 도구로 이어간다.

모든 검증은 임시 데이터·UUID 프로필·로컬 서버만 사용했다. 실제 AI 계정 인증/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3 업로드·Windows→Linux 복원은 수행하지 않았다. F01~F04 로그인·결제·웹 편집·iOS 기능은 계속 범위에서 제외한다. reset/revert/commit/make/release/게시 없음.

## 23. R05 다음 기능 단위 — 창·패널 조립과 포커스 수명

2026-10-21, 22절의 다음 작업인 `WorkspacePanels` 경계를 구현했다. 이번은 창·패널의 표시/닫힘·포커스·Escape와 셸 수명 단위이며, R05 전체 완료나 R07~R10 착수를 뜻하지 않는다.

- `WorkspacePanels`가 홈/작업 화면에 반복된 업데이트·협업·PC 서버와 탐색/명령/단축키/비교, 플러그인·칸반 보기·상태 관리, 오프라인 상태 조립을 담당한다. 기존 component props를 그룹 계약으로 사용하고 기존 DOM 순서와 CSS를 유지한다. `usePanelState`의 15개 표시 상태는 유지하며 문서/서버/초안 상태를 새 전역 Context에 몰아넣지 않았다.
- 프로젝트 전환 전 flush, 연결 후 load, 상태/칸반의 expected 저장과 plugin 콘텐츠 데이터·명령은 기존 화면/기능에 남겼다. 셸은 열림/닫힘과 lifecycle을 소유한다. 화면 편집 명령 콜백과 AI/히스토리/작업 확인 창까지 단순 JSX 이동으로 완료 처리하지 않는다.
- `installWorkspaceModalFocus`가 셸에 observer/listener를 한 번 설치·해제한다. 기존 CSS의 ancestor z-index와 같은 층의 DOM 순서로 실제 활성 창을 판단하고 Tab/Shift+Tab 경계에서 한 번만 순환한다. disabled/hidden/inert/숨긴 컨트롤을 제외한다. native showModal은 브라우저 top layer와 자체 focus/cancel 처리를 유지한다.
- 기존 hook은 첫 `.dialog-backdrop`만 찾고 modal boolean이 그대로인 창 교체를 놓쳤다. 동적으로 열린 협업/상태/기존 편집 창을 따라가며, 닫힌 창에서 아래 창의 원래 컨트롤 또는 마지막 실제 버튼으로 복귀한다. 자동 업데이트처럼 뒤쪽 창이 늦게 열려도 앞 창의 포커스를 가져가지 않는다. 앞 창이 먼저 닫힐 때도 복귀 연결을 이어 보존한다.
- 업데이트의 전역 Escape listener가 위쪽 협업 창이 열린 경우 뒤쪽 업데이트까지 닫던 경로를 수정했다. 업데이트가 실제 최상위일 때만 닫는다. 협업 Escape는 busy 중 닫힘을 막으며 정상 상태에서는 해당 창만 닫는다. 다른 기능의 기존 Escape·busy 정책은 유지한다. UI debug console의 자체 focus 예외도 유지한다.
- 창이 없을 때 canvas drag의 style 변경마다 전체 workspace를 재검색하지 않고 변경 subtree만 확인한다. 한글/IME/초안/저장과 포커스 수명을 결합하지 않는다. 디자인 변경이나 라이브러리 교체는 없다.
- PC 서버 비활성 번들 검사에서 이전 DesktopBootstrap 이동 후 main alias가 예전 `./features/...`만 가리키고 renderer alias도 이전 상대 깊이에 고정된 것을 발견했다. 두 Vite alias를 상대 깊이에 맞게 보완하고 WorkspacePanels에도 정적 `SELF_HOST_ENABLED` guard를 유지했다. 비활성 빌드의 실제 코드 제거와 공동 재연결 보존을 확인했으며 활성 Windows PC 서버 기능은 유지한다. 실제 코드와 계획의 차이 때문에 함께 보완한 항목이다.

검사 도구 작성 중 숨긴 Electron 창은 focusin이 생략될 수 있음을 확인해 현재 activeElement도 사용하도록 보강했고, 실제 App의 자동 뒤쪽 창/원래 버튼 복귀를 다시 확인했다. 새 package 검사는 재시작 시 항상 홈일 것으로 가정해 처음 실패했다. 기존 정상 동작인 마지막 작업 화면 복귀도 허용한 뒤 실제 홈 버튼으로 이동하고 동일한 관리 창/포커스 검사를 끝까지 수행했다. 제품의 재시작 정책을 바꾸거나 실패 검증을 없애지 않았다. 실제 UI의 이미지 캡처는 창 resize 후 렌더링 완료를 기다리도록 수정했다.

### 23.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 modal 수명 검사                    | 8개 통과. Tab 경계·CSS/DOM 표시 순서·자동 뒤쪽 창·focusin 생략·native 우선·숨김/삭제된 트리거·listener/observer 해제 포함. jsdom geometry만 대체                                             |
| 전체 자동 검사                        | 648개 통과, 실패/건너뜀 0                                                                                                                                                                    |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 feature guard와 Vite alias 보완 뒤 기본 타입 재통과. contracts/core 소스는 변경하지 않음                                                                                   |
| 린트 / 포맷                           | 통과, 기존 경고 2건 유지. 새 추출의 불필요 변수와 package 검사 helper/escape 경고 제거 후 변경 파일 추가 확인                                                                                |
| 새 실제 App UI                        | 협업/자동 업데이트 겹침·Tab/한 번씩 Escape/원래 버튼 복귀, 참여 진행 중 닫힘 차단·실패 표시, 홈/작업 화면 3회 전환의 구독 수 2개 유지·명령 창 통과                                           |
| dark/light·작은 창                    | 같은 fixture의 1280×900, 640×640 대화상자 레이아웃/닫힘 통과. `out/workspace-panels-ui/{dark,light}-{1280,640}.png` 생성·대표 두 장 직접 확인                                                |
| 전체 integration                      | 로컬/공동 파일·Undo/히스토리·요청/승인/mock AI·서버 중단/재개·실제 Chromium/4개 앱·캔버스 전환·한글/IME 자동 저장·충돌 초안 통과                                                             |
| 기존 UI review                        | footer/dock·표시/숨김·animation/reduced motion·관리 입력 보존·최소 창·키보드/실제 pointer 메모·minimap·완료 표시 통과                                                                        |
| 기존 UI debug                         | 전체 카탈로그 상태/홈·프로젝트·F12·highlight·storage/action 격리 통과                                                                                                                        |
| native preload UI debug               | 실제 preload/IPC·F12·iframe focus·built preview·preview IPC 0·실패 진단·editor 보존 통과. fixture의 일부 미등록 kanban/AI queue API 로그는 기존처럼 발생하며 production IPC 등록 실패와 구분 |
| PC 서버 비활성 빌드                   | main/preload/renderer 실제 번들에서 관리 IPC/UI 제거, 기존 공동 프로젝트 재연결 유지 통과                                                                                                    |
| Windows package                       | 최종 소스로 1회 생성, source/config/runtime 입력 지문 일치                                                                                                                                   |
| 같은 package 새 패널 검사             | 실제 앱의 관리 창 겹침·Tab/Escape/홈 버튼 복귀, 명령·플러그인·상태 창, 홈/작업 3회 왕복·원문 보존·완전 재시작 통과                                                                           |
| 같은 package 게임 UI                  | inspector·width/floating·잘못된 초안/Escape·범위 변경/Undo·Markdown 보존·완전 재시작 통과                                                                                                    |
| 같은 package 공동 연결/충돌 UI        | 내장 Node/서버의 생성/참여/복구/탈퇴·초대/역할 변경, offline 홈 보존, 실제 UI 충돌 선택·선택 전 draft 백업·원래 local 복귀 통과                                                              |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 이번 시작 원본/이전 package 기록 보존, diff whitespace 통과                                                                                              |

입력 지문 `fa1c43170f464005be776dfae0ab1f8ad7f3c3999cadf137385f07824e2f7e37`. EXE SHA-256 `ac7812437836c7e20987fc7a22e1201c0ca02d15433181c5b7855366b21a6d80`, app.asar SHA-256 `b781ea76ed8fdfef354d22033db798569c3aebd824310b8e2000c6fb05047a15`. `out/refactoring-package-{inputs,verification}-r05-panels-2026-10-21.json`에 입력/크기/해시를 기록했다. 22절의 package 기록도 별도 파일로 유지했다. 시작 원본과 git 상태는 `%TEMP%/gamejam-r05-panels-start-12ac012dc6e64868b4ff6fedeec509ba`, 로그는 `%TEMP%/gamejam-r05-panels-*.log`다. 책임/검증 설명은 `docs/architecture/workspace-panels.md`다.

이번 패널 기능 단위는 구현·검증 완료이며 **R00/R01/R02/R03/R04/R06 완료, R05 진행, R07/R08/R09/R10 미완료**를 유지한다. 단계별 요청에 따라 여기서 멈춘다. 다음 작은 단위는 WorkspaceScreen에 남은 선택 항목의 복사/복제/삭제·배치 등 편집 명령 콜백과 작업 확인 창의 연결 경계를 정리하는 것이다. AI/히스토리 등 잔여 화면 조립까지 R05 완료 조건을 재검토한 뒤 R07 서버, R08 저장소/migration, R09 백업/복원, R10 Render 설정·검증 도구로 이어간다.

모든 검증은 임시 데이터·UUID/격리 프로필·로컬 서버/fixture를 사용했다. 통합 AI는 mock이며 실제 AI 계정/유료 실행, Discord 외부 전송, Render 자원 생성/운영 배포, 실사용 데이터 이전, S3/Windows→Linux 복원은 수행하지 않았다. 실제 외부 계정·서비스·다른 OS/망 확인을 이번 통과 결과로 주장하지 않는다. F01~F04 로그인·결제·웹 편집·iOS 기능도 계속 범위에서 제외한다. reset/revert/commit/make/release/게시 없음.

## 24. R05 다음 기능 단위 — 선택 명령과 삭제 확인 수명

2026-10-21, 23절의 다음 작업인 선택 복사/복제·단일/혼합 삭제·배치 명령과 삭제 확인 창의 경계를 구현했다. R05 전체 완료나 R07~R10 착수를 뜻하지 않는다.

- `selection-plan.ts`가 섹션 멤버의 중복 배치 제외, 접힌 문서의 표시/저장 높이, 8개 정렬/간격 계산, clipboard 선택 사본과 그림 복사 ID/시각을 담당한다. 명령 환경을 주입하며 입력을 변경하지 않는다. 기존 문서/혼합 복제 56px, 그림만 복제 32px 이동과 native 파일명/ID 정책을 유지한다.
- `CanvasSelectionActions`가 저장 flush·최신 revision 조회·기존 native 또는 혼합 단일 batch 명령·reload·선택/확인/알림 인정 순서를 담당한다. 문서만 복제/삭제하는 native 경로, 그림만 복제하는 optimistic 경로, 문서/HTML·섹션·그림을 한 번 기록하는 혼합 batch와 기존 Undo 의미를 유지한다. 문서 내용 전체 대신 시작 ID/path와 필요한 metadata·그림을 복사한다.
- `useSelectionScope`/`useSelectionActions`는 root/saveScope/sessionId/epoch/canvas/home과 화면 방문 순번을 고정한다. 대기 뒤마다 scope, 발행 전 권한·AI 보호를 다시 확인한다. 같은 화면의 이중 클릭은 동기적으로 막으며 이전 작업의 응답이 새 화면의 busy·선택·알림·오류를 변경하지 않는다. A→B→A 왕복도 이전 확인을 되살리지 않는다. 이미 backend가 반영한 명령을 UI가 취소/rollback했다고 주장하지 않는다.
- 삭제/복제의 game UI·drawing·문서 편집 flush 함수는 await 전에 캡처한다. game UI→drawing 순서와 문서별 병렬 flush를 유지한다. 삭제/배치의 AI 보호에는 섹션 멤버도 포함한다. 복제 입력 읽기를 AI 쓰기 잠금으로 새로 금지하지 않는다.
- `useSelectionDeletePrompts`와 `SelectionDeleteDialogs`가 단일/혼합 삭제 대상·확인 창 수명을 맡는다. 기존 두 DOM 위치, 문구·asset 원본 보존/HTML 관련 폴더 설명·busy/lock/취소·단일 오류 시 닫힘/혼합 오류 시 재시도 동작을 유지한다. 이전 setter/완료 응답은 새 확인 창을 닫지 않는다. 디자인/CSS 변경이나 라이브러리 교체는 없다.
- 실제 package 검사에서 복제 reload 뒤 React Flow 노드 생성이 늦어 복제 항목 선택이 누락되는 문제를 발견했다. `useCreatedSelection`이 복제 문서/그림 노드를 모두 확인한 뒤 선택을 한 번 적용하고 화면 전환 시 폐기하도록 보완했다. 고정 시간 지연으로 우회하지 않았다.
- 그 다음 실제 package에서 Undo/Redo 직후 이전 drawing generation으로 혼합 삭제가 거절되는 문제를 확인했다. backend의 충돌 거절은 정상 동작이므로 유지하고, history 명령 완료 전에 그림 목록을 직접 갱신하도록 보완했다. 변경 알림을 지연한 실제 App fixture와 최종 package에서 확인했다.

초기 타입 검사에서 새 port의 실제 API 반환형 차이를 수정했고, 실제 UI 검사는 노드 생성·선택/활성화 완료 후 사용자 명령을 수행하도록 조정했다. 두 package 실패는 각각 위 제품 수정을 수행하고 같은 시나리오를 끝까지 재실행했다. 실패 검사를 삭제하거나 generation 검사를 약화하지 않았다. 소스가 다른 세 버전을 각각 한 번 package했고, 최종 검증 결과물을 재사용했다. 이전 두 버전의 package 입력/해시는 시작 백업의 `first-package`, `second-package`에 보존했다.

### 24.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 명령/React hook 검사               | 15개 통과. 8개 배치 계산·사본/offset·명령 순서·fresh revision·혼합 batch·중복 클릭·세션 변경·늦은 응답·실패·권한/AI 재검사·StrictMode·확인 만료·늦은 노드 선택·busy 격리 포함                      |
| 전체 자동 검사                        | 663개 통과, 실패/건너뜀 0. 마지막 WorkspaceScreen의 Undo drawing 직접 갱신은 아래 지연 알림 UI와 최종 실제 package로 추가 검증                                                                     |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 Undo 직접 갱신 뒤 기본 타입 재통과; contracts/core 소스는 변경하지 않음                                                                                                          |
| 린트 / 포맷                           | 통과. 기존 경고 2건 유지: 이전 AI queue package helper의 미사용 변수, Discord mock this 별칭                                                                                                       |
| 새 실제 App UI                        | 변경 알림 지연 상태에서도 혼합 복제/정렬/삭제·명령당 한 번 기록·Undo/Redo·이중 삭제 확인·캔버스 왕복 확인 만료·단일 HTML 삭제/Undo 통과                                                            |
| 기존 선택/그림 UI                     | native pointer/선택, 그림 resize/rotate/stroke/erase/cancel·혼합 삭제/Undo·재시도 통과. dark/light/compact 캡처 및 대표 이미지 직접 확인                                                           |
| 전체 integration                      | 로컬/공동 편집·파일·Undo/히스토리·요청/승인/mock AI·서버 중단/재개·실제 Chromium/4개 앱·캔버스 전환·한글/IME 저장·충돌 초안 통과. 마지막 노드 선택/Undo UI 보완은 새 UI와 최종 package로 추가 확인 |
| 기존 UI debug / native preload        | 전체 카탈로그·storage/action 격리·실제 preload/IPC·F12·iframe focus·preview/editor 보존 통과. fixture의 기존 미등록 kanban/AI queue API 로그는 production IPC 실패와 구분                          |
| 최종 Windows package                  | source/config/runtime 입력 지문 일치. 아래 검사에서 같은 결과물 사용                                                                                                                               |
| 같은 package 새 선택 검사             | 실제 Ctrl+A/Ctrl+D·혼합 정렬·Undo/Redo·삭제 확인 이중 클릭의 단일 기록·단일 HTML 삭제/Undo·캔버스 왕복·원래 Markdown 바이트와 복제 문서/그림·완전 재시작 보존 통과                                 |
| 같은 package clipboard                | native Ctrl+V·내부/외부 복사·Undo/Redo·reload·완전 재시작 보존 통과                                                                                                                                |
| 같은 package 게임 UI                  | inspector·개인 width/floating·잘못된 초안/Escape·범위 변경/Undo·Markdown·완전 재시작 보존 통과                                                                                                     |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 시작 원본/git 상태/이전 package 기록 보존, diff whitespace 확인                                                                                                |

최종 입력 지문 `d695ac7e1d4714af721a68c987e7033f977f3df27ccb26c0c2c8e64b246b6403`. EXE SHA-256 `adbe880e06075fbdd1fc733ce1b82bbfeeb285edf87d7395dbb36c6b77867818`(245,869,568바이트), app.asar SHA-256 `f49f9eb5af3c5bcae059a17c5d7f08f9523c3755b9d1573642a7aa0e28187941`(8,010,745바이트). `out/refactoring-package-{inputs,verification}-r05-selection-2026-10-21.json`에 기록했다. 시작 백업은 `%TEMP%/gamejam-r05-selection-start-2e30e3fce211433d91c14bc44cfe5ecd`, 검사 로그는 `%TEMP%/gamejam-r05-selection-*.log`다. 화면 캡처는 `out/selection-actions-{ui,packaged}/delete-many.png`, 책임과 검사 연결은 `docs/architecture/selection-actions.md`에 기록했다.

이번 선택 명령·삭제 확인 기능 단위는 구현·검증 완료다. **R00/R01/R02/R03/R04/R06 완료, R05 진행, R07/R08/R09/R10 미완료**를 유지한다. 단계별 요청에 따라 여기서 멈춘다. 다음 작은 단위는 섹션 생성·단일 섹션 해제/삭제와 멤버십 변경 확인 수명의 분리다. clipboard paste 큐/asset 가져오기, 실제 pointer 배치 저장, 최소화, AI/히스토리 등 잔여 화면 조립도 R05 완료 조건과 함께 이어서 확인한다.

모든 검사는 임시 데이터·UUID/격리 프로필·fixture/로컬 서버를 사용했다. 최종 선택 package 시나리오는 로컬 프로젝트를 검사했으며 각 선택 action을 실제 공동 서버에서 전수 실행했다고 주장하지 않는다. 공동 backend/IPC는 통합 검사 결과와 구분한다. 실제 AI 계정/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원·외부망/다른 OS 검사는 수행하지 않았다. F01~F04는 계속 제외하며 reset/revert/commit/make/release/게시 없음.

## 25. R05 다음 기능 단위 — 섹션 생성·해제·삭제와 멤버십 확인

2026-10-21, 24절의 다음 작업인 섹션 생성·단일 섹션 해제/동반 삭제·드래그 후 멤버십 변경과 확인 창 수명을 분리했다. 단계별 요청에 따라 이 기능 단위만 구현했으며, R05 전체 완료나 R07~R10 착수를 뜻하지 않는다.

- `sectionCreationInput`이 기존 선택 문서 bounds·최소 420×280·여백·접힌 문서의 저장 높이·제목 기본값을 담당한다. 생성 확인을 열 때 대상을 복사하고 `CanvasSectionActions`가 기존 createSection/deleteSection/moveDocumentToSection IPC·reload·확인/선택/알림 인정 순서를 맡는다. native 파일명/ID와 휴지통·히스토리/Undo·공동 명령 형식은 변경하지 않았다.
- `useSectionPrompts`가 생성 대상/제목, 단일 섹션의 동반 삭제 여부, 멤버십 문서/출발/도착/drag geometry를 소유한다. 일반 패널의 sectionDialogOpen 상태를 이 경계로 옮기고 기존 `SelectionScope`의 root/saveScope/sessionId/epoch/canvas/home/방문 순번에 연결했다. 프로젝트·캔버스 왕복 시 이전 확인이 되살아나지 않으며 이전 setter/완료 응답은 새 확인 창을 닫지 않는다.
- `useSectionActions`는 같은 화면의 확정 중복을 동기적으로 막고 다른 화면의 진행 상태를 이전 응답이 해제하지 못하게 한다. 선택 명령 busy와도 연결했다. 시작 화면이 바뀌거나 unmount되면 늦은 선택·알림·오류·확인 처리를 억제한다. 이미 backend가 반영한 명령을 UI가 rollback한다고 주장하지 않는다.
- 생성은 선택 문서, 해제/삭제는 섹션 정의와 멤버, 멤버십 변경은 문서와 출발/도착 정의에 대해 실행 직전 현재 권한·AI 보호를 확인한다. 실행 중 제목 입력과 확인/취소를 막는다. 취소는 쓰기 없이 reload하므로 권한을 잃어도 허용한다. 원래 drag revision을 그대로 보내며 최신 revision으로 교체해 충돌을 우회하거나 새 사전 저장/프로토콜을 추가하지 않았다.
- WorkspaceScreen의 인정 콜백은 현재 확인 대상과 시작 대상이 같을 때만 창·선택을 정리한다. 생성 섹션 선택을 기존 `useCreatedSelection`에 연결해 노드 준비 후 한 번 적용하며 기존 80ms timeout을 제거했다. 해제/삭제 실패 시 닫힘, 멤버십 실패 시 닫힘과 원래 위치 reload는 유지한다. 명령 성공 후 reload가 실패해도 쓰기를 재시도하지 않고 확인 콜백을 중복 실행하지 않는다.
- `SectionDialogs`로 원래 인접한 세 확인 창을 같은 DOM 순서에 조립했다. 기존 문구·아이콘·CSS·휴지통 안내·셸 Tab/포커스 처리를 유지한다. UI debug 카탈로그 소유 경계를 갱신하고 생성 미리보기는 샘플 대상을 직접 주입한다. 섹션 이름 변경·pointer 저장·최소화와 AI/히스토리 조립은 이 단위에 섞지 않았다.

단위 검사 첫 실행에서 Node의 TypeScript strip 모드가 parameter property를 지원하지 않아 명시적 필드/생성자 대입으로 수정했다. 실제 pointer 검사에서는 fixture의 HTML 창이 드래그 시작점을 덮어 목적지 위치를 조정했다. native package 검사는 파일 제거가 관측되는 시점과 IPC·히스토리 완료 시점을 혼동했고, preview API가 허용한 빈 목적지 섹션을 native도 허용한다고 가정했다. 또한 선택/확인 버튼이 활성화되기 전에 클릭하는 경로를 보완했다. 확인 창·busy 종료와 버튼 활성화를 기다리고 실제 다른 fixture 문서를 목적지 멤버로 지정한 뒤 동일 검사를 끝까지 실행했다. 기존 빈 섹션 거절·충돌·히스토리 검사와 제품 레이어 정책은 약화하지 않았다. 진단 로그는 `%TEMP%/gamejam-r05-sections-packaged-before-*.log`, `gamejam-r05-sections-packaged-membership-receipt.log`에 남겼다.

### 25.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 섹션/React hook 회귀               | 신규 12개 추가. 섹션 명령 10개와 기존 hook 3개+신규 hook 2개의 관련 15개 통과. bounds·사본·원래 revision·동반 삭제 플래그·보호 경로·중복 확정·지연/실패/세션 교체·권한·읽기 전용 취소·reload 실패·StrictMode·확인 만료/busy 격리 포함 |
| 전체 자동 검사                        | 675개 통과, 실패/건너뜀 0                                                                                                                                                                                                             |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 UI debug 조립 보완 뒤 기본 타입 재통과; 계약/core 소스 변경 없음                                                                                                                                                    |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지                                                                                                                                                        |
| 실제 App 섹션 UI                      | Ctrl+A/섹션 생성·생성 노드 선택·빠른 두 번 확정의 단일 기록, 해제/동반 삭제·Undo/Redo, native pointer 취소/추가/이동/제외·좌표/본문, Shift+Tab/Escape·캔버스 왕복 확인 만료 통과                                                      |
| 전체 integration                      | 로컬/공동 파일·편집·Undo/히스토리·승인/예약/mock AI·서버 중단/재개·실제 Chromium/4개 앱·캔버스 전환·한글/IME 저장·충돌 초안 통과. 마지막 debug 전용 샘플/카탈로그 보완은 아래 UI debug와 최종 package로 확인                          |
| UI debug                              | production renderer build의 전체 카탈로그 상태/홈·작업·F12·highlight·storage/action 격리 통과. 추출한 생성/멤버십/섹션 확인 포함                                                                                                      |
| Windows package                       | 최종 source/config/runtime으로 1회 생성, 입력 지문 일치. 검사 도구 수정 뒤 같은 결과물을 계속 사용                                                                                                                                    |
| 같은 package 새 섹션 UI               | 실제 Markdown/IPC/휴지통의 생성·해제·동반 삭제·한 번 기록·Undo/Redo, 실제 pointer의 멤버십 취소/추가/이동/제외·이중 확정·확인 만료, 원래 본문/custom metadata·membership·history의 완전 재시작 보존 통과                              |
| 같은 package 선택 UI                  | 문서/그림 혼합 복제·정렬·삭제·Undo/Redo·한 번 기록·단일 HTML 삭제/Undo·캔버스 왕복·원래 Markdown 바이트와 완전 재시작 보존 통과                                                                                                       |
| 같은 package 기존 R04 편집            | 잘못된 section/copy/layout ID 무변경/무기록, 섹션 이동·이름·복제/Undo, 실제 섹션/멤버 휴지통·복원·사용자 본문/custom metadata·다른 섹션·legacy history·완전 재시작 보존 통과                                                          |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 이번 시작 WorkspaceScreen/계획서/git 상태 보존, diff whitespace 확인                                                                                                                              |

최종 입력 지문 `ad4119aa27069f124d0d8544fa9ac57d8aa660fbf37a6c1d588b0e4c4c22434a`. EXE SHA-256 `a002f704813a6eb3edf1bdb21a71dc9ec29a9240ad84e82e855823560eb717ed`(245,869,568바이트), app.asar SHA-256 `16ac9751f352820e19f8858d94a387b44d3ed75d9d6c63f7e30f19d7b5c04fc4`(8,014,235바이트). `out/refactoring-package-{inputs,verification}-r05-sections-2026-10-21.json`에 기록했다. 시작 백업은 `%TEMP%/gamejam-r05-sections-start-37b7ba039ad1467e8b593b75b034d46b`, 로그는 `%TEMP%/gamejam-r05-sections-*.log`다. 캡처는 `out/section-actions-{ui,packaged}/{ungroup,membership}.png`에 남겼고 두 환경의 대표 화면을 직접 확인했다. 책임/검사 연결은 `docs/architecture/section-actions.md`다.

이번 섹션 기능 단위는 구현·검증 완료다. **R00/R01/R02/R03/R04/R06 완료, R05 진행, R07/R08/R09/R10 미완료**를 유지하며 여기서 멈춘다. 다음 작은 단위는 섹션 이름 변경과 문서·섹션 최소화/펼치기 명령의 화면/저장 경계다. 그 뒤 clipboard paste 큐/asset 가져오기, pointer 배치 저장, 나머지 inspector·AI/히스토리 화면 조립까지 R05 완료 조건을 다시 확인한다. R07 서버, R08 저장소/migration, R09 백업/복원, R10 Render 설정·검증 도구는 여전히 남아 있다.

임시 데이터·UUID/격리 프로필·fixture/로컬 서버만 사용했다. 새 섹션 UI package 시나리오는 로컬 프로젝트이며 각 action을 실제 공동 서버에서 전수 실행한 결과가 아니다. 공동 backend/IPC 통합 검사와 구분한다. 실제 AI 계정/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원·다른 PC/외부망 검사는 수행하지 않았다. F01~F04는 계속 제외하며 reset/revert/commit/make/release/게시 없음.

## 26. R05 다음 기능 단위 — 이름 변경과 최소화/펼치기 명령

2026-10-21, 25절의 다음 작업인 섹션 이름 변경과 문서·섹션 최소화/펼치기 명령을 구현·검증했다. 단계별 요청에 따라 이 기능 단위에서 멈추며 R05 전체 완료를 뜻하지 않는다.

- `CanvasSectionActions.rename`과 `useSectionPrompts.sectionRename`으로 기존 이름 변경 IPC와 확인 창 수명을 연결했다. 시작 path/title/revision과 화면 방문을 고정하고, 실패 시 확인을 남기며 성공한 명령의 reload 실패를 재시도로 처리하지 않는다. 빠른 두 번 확인·이전 화면/이전 확인의 완료 응답을 분리한다. 기존 제목 정규화·파일명/ID·본문/custom metadata·멤버·히스토리는 backend에 남겼다.
- `SectionRenameDialog`를 원래 DOM 위치에 조립해 기존 문구·입력 길이·Escape·디자인을 유지한다. busy 중 입력/확인/닫힘을 막고 UI debug 소유 경계를 갱신했다. 새 전역 modal 상태나 로그인/구독 정책을 추가하지 않았다.
- `CanvasCollapseActions`/`useCollapseActions`가 단일 문서 헤더/문맥 메뉴, 단일 섹션, 선택 항목의 최소화 명령을 담당한다. 문서 ID/path/title/collapsed만 복사하고 본문은 복사하지 않는다. 선택·섹션 멤버·미리보기 창·칸반 callback과 flush 함수를 await 전에 캡처한다. 화면/세션/캔버스 왕복·unmount·AI 보호 변경·중복 실행을 확인하고 이전 완료가 새 화면의 busy/선택/알림/문맥 메뉴를 변경하지 못하게 한다.
- 로컬 문서의 Markdown metadata/문서별 히스토리, 공동 문서의 기존 개인 collapsed map, 섹션/칸반의 개인 설정, HTML의 preview window 저장을 각각 유지한다. 여러 문서를 접을 때 새 단일 batch/단일 히스토리로 바꾸지 않는다. 저장된 확장 높이·ID·본문과 기존 preview 정규화/optimistic 반영·오류 안내 의미를 유지한다.
- 단일 섹션은 기존 문서 편집기만 flush하고, 선택 명령은 game UI→drawing→캡처한 문서 편집기 순서로 저장한다. 대기 뒤 최신 개인 설정에 섹션 값을 합쳐 다른 값을 덮지 않게 했고 멤버 선택 정리·섹션 선택·blur를 유지했다. 개인 표시 자체에 새로운 서버 역할 제한을 넣지 않으며 기존 AI 보호를 유지한다. 변경된 권한은 실제 쓰기의 기존 backend 검증을 따른다.
- 검색 중 펼침·임시 섹션 펼침·링크로 잠시 펼친 문서와 저장된 접기 값을 구분한다. 단일 문서 임시 펼침을 닫을 때는 기존처럼 개인/파일 IPC를 실행하지 않는다. 선택 중 하나라도 접혀 있으면 모두 펼친다. 문서 쓰기/flush 실패 또는 화면 변경 시 남은 작업을 중단하지만 이미 반영된 앞부분을 rollback했다고 주장하지 않는다. 미리보기 저장 오류의 기존 안내/계속 진행 경로도 유지한다.

첫 관련 단위 검사에서 permission 재검사 이벤트까지 업무 효과의 마지막 이벤트로 가정한 assertion을 수정했다. 실제 검증할 저장/설정/reload 순서를 구분했으며 제품 동작이나 실패 검사를 삭제하지 않았다. 이후 신규 16개를 포함한 전체 691개와 최종 관련 31개 검사가 통과했다. 마지막 문서 대상 사본 축소·동일 문서의 새 문맥 메뉴 보호는 관련 검사/타입과 최종 UI/package로 추가 확인했다. 책임/검사 연결은 `docs/architecture/presentation-actions.md`에 기록했다.

실제 package의 첫 native 선택 검사는 섹션 헤더의 고정 클릭 지점을 다른 문서가 덮어 실패했다. `elementFromPoint`로 실제 노출된 헤더 지점을 찾아 native pointer로 선택하게 보완했으며 제품의 레이어/배치를 변경하지 않았다. 기존 섹션 package 회귀에서는 확정 버튼의 활성 확인과 클릭 사이에 있던 history 조회를 앞으로 옮기고 클릭 직전 disabled 검사도 추가했다. 이중 확정·히스토리 수 검사는 그대로 유지한 뒤 같은 package에서 끝까지 통과했다. 실패 로그는 `%TEMP%/gamejam-r05-presentation-packaged-before-header-hit.log`, `gamejam-r05-presentation-packaged-sections-before-click-order.log`에 보존했다. 개발용 fixture 실행 중 ResizeObserver 알림이 1회 있었으며 기능 검사는 통과했다. 최종 실제 package의 같은 흐름에서는 동일 예외를 관측하지 않았다. 이를 수정 완료나 다른 환경에서의 재현 불가로 주장하지 않는다.

### 26.1 검증 확정

| 검사                                  | 결과                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 새 서비스/React hook 회귀             | 신규 16개 추가: collapse 11개·rename 3개·hook 2개. 이전 회귀를 포함한 관련 31개 통과. 대상 사본·저장/설정 순서·temporary 분리·중복·지연·중간 실패·AI 보호·확인 만료·StrictMode/busy 격리 포함                                                    |
| 전체 자동 검사                        | 691개 통과, 실패/건너뜀 0. 마지막 대상 사본 축소는 관련 31개, 화면의 문맥 메뉴 대상 비교는 아래 최종 UI/package로 추가 확인                                                                                                                      |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 사본/문맥 메뉴 보호 뒤 기본 타입 재통과. 계약/core 소스 변경 없음                                                                                                                                                              |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지                                                                                                                                                                   |
| 실제 App UI                           | 이름 변경 이중 확인의 단일 기록·원래 ID/path/멤버·Undo/Redo, 개인 섹션 접기/검색 펼침/무기록, 문서 헤더/문맥 메뉴 접기와 원래 높이·Undo/Redo, 선택 문서별 기록, 실제 pane 혼합 선택의 HTML 접기/geometry 보존, 캔버스 왕복 확인 만료 통과        |
| 전체 integration                      | 로컬/공동 파일·편집·Undo/히스토리·승인/mock AI·서버 중단/재개·실제 Chromium/4개 앱·캔버스 전환·한글/IME 저장·충돌 초안 통과. 마지막 UI 전용 문맥 메뉴 비교는 최종 UI/package로 추가 확인                                                         |
| UI debug                              | production renderer build의 전체 카탈로그 상태/홈·작업·F12·highlight·storage/action 격리 통과. 새 이름 변경 창과 문서/섹션 표시 상태 포함                                                                                                        |
| Windows package                       | 최종 source/config/runtime으로 1회 생성, 빌드 전후 입력 지문 일치. 검사 도구/사례 보완 뒤 같은 결과물 재사용                                                                                                                                     |
| 같은 package 새 표시 명령 UI          | 실제 IPC·Markdown의 이름 변경·문서 접기·문서별 히스토리·Undo/Redo, 개인 섹션/검색/확인 만료, 실제 문서+섹션+HTML 선택과 preview geometry 보존 통과. 원래 섹션 본문/custom metadata·문서 원문·멤버·history·개인 섹션 접기의 완전 재시작 보존 통과 |
| 같은 package 이전 섹션 UI             | 생성·해제·동반 삭제·중복 확정/한 번 기록·Undo/Redo, native pointer 소속 변경 취소/추가/이동/제외, 캔버스 왕복·원래 본문/metadata/membership·완전 재시작 보존 통과                                                                                |
| 같은 package R04 편집                 | 잘못된 section/copy/layout ID 무변경/무기록, 섹션 이동·이름·복제/Undo, 실제 섹션/멤버 휴지통·복원·사용자 본문/custom metadata·다른 섹션·legacy history·완전 재시작 보존 통과                                                                     |
| 기존 작업 보존                        | 최초 dirty/new 파일 69개 모두 존재. 이번 시작 원본/git 상태·이전 package 기록 보존, diff whitespace 확인                                                                                                                                         |

최종 입력 지문 `764f0735c98e1882bccf2baab2a9d000012dc1530aba0ede7089cb51128a4b90`. EXE SHA-256 `ec18aa2e61d156df161751472fade7563bf8ae763140f82b2db2de72dd4ba24b`(245,869,568바이트), app.asar SHA-256 `01b579a7ca2052544a79cd0b21b6da23a4b2f48c686b3d0792e219ab38cf7d53`(8,017,678바이트). `out/refactoring-package-{inputs,verification}-r05-presentation-2026-10-21.json`에 기록했다. 시작 백업은 `%TEMP%/gamejam-r05-presentation-start-a3db963bdb434fa48a866ef1ad25af77`, 로그는 `%TEMP%/gamejam-r05-presentation-*.log`, 직접 확인한 캡처는 `out/presentation-actions-{ui,packaged}/section-collapsed.png`다.

이번 이름 변경·최소화 기능 단위는 구현·검증 완료다. **R00/R01/R02/R03/R04/R06 완료, R05 진행, R07/R08/R09/R10 미완료**를 유지한다. 다음 작은 단위는 캔버스 드래그·크기 변경의 배치 저장과 pending geometry/화면 반영 경계다. clipboard paste 큐/asset 가져오기, 나머지 inspector·AI/히스토리 화면 조립도 남아 있으며 이를 연결해 R05 전체 완료 조건을 확인한다. 그 뒤 R07 서버, R08 저장소/migration, R09 백업/복원, R10 Render 설정·검증 도구로 이어간다.

임시 데이터·UUID/격리 프로필·fixture/로컬 서버만 사용했다. 새 표시 명령 package는 로컬 프로젝트이며 공동 문서 개인 collapsed map은 기존 backend 계약/자동·통합 검사와 구분한다. 칸반 혼합 callback·temporary 문서 닫힘까지 각각 native package에서 실행했다고 주장하지 않는다. 실제 AI 계정/유료 실행·Discord 외부 전송·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원·다른 PC/외부망 검사는 수행하지 않았다. F01~F04는 계속 제외하며 reset/revert/commit/make/release/게시 없음.

## 27. R05 잔여 화면 명령·조립 마무리

2026-10-21. 사용자의 R05 전체 마무리 요청에 따라 26절에 남긴 드래그/크기 저장, clipboard 큐·가져오기, inspector/속성/칸반, AI·히스토리 및 잔여 화면 조립을 구현했다. **잔여 구현과 아래 검증을 완료하여 R05를 완료 처리한다.** R07~R10과 F01~F04는 이번 변경에 포함하지 않는다.

- `geometry-plan`/`useCanvasGeometry`가 좌표 계산·pending sequence·혼합 저장을 소유한다. 소속 확인은 드래그의 reload/cleanup 뒤에 열어 이전 갱신과 확인 창이 경합하지 않게 했다. 내부 중복 reload를 줄였고 이전 sequence는 새 pending 좌표를 지우지 않는다.
- `useCanvasClipboard`가 native 마커·사본·직렬 큐와 프로젝트/화면 수명을 맡는다. `useWorkspaceImport`는 목적·확인/busy/error를 맡고, 붙여넣기·가져오기 선택은 고정 80ms 대신 실제 노드 준비 후 한 번 적용한다.
- `transfer-plan`/`useWorkspaceTransfers`가 문서/그림 이동의 단일 거래와 결과 폴더 이동을 맡는다. 파일 원자성·원래 Undo·fresh revision을 유지한다. `useCanvasNavigation`/`useNoteCreation`은 viewport·입력 flush·기존 서버 호환 생성을 맡는다.
- `useFileWorkflow`, `usePreviewWindows`, `useWorkspaceIndex`, `useWorkspaceHistory`로 속성 저장·개인 HTML 창·inspector 조회·히스토리 상태를 분리했다. 히스토리 조회 역순과 이전 세션 응답을 차단하고 렌더 전 복원 이중 클릭도 막는다. 칸반의 개인 보기·legacy 배치 이행·탐색/배치와 문서/HTML 보기 모델은 `features/kanban/useCanvasKanban`이 소유한다.
- AI 요청/승인 명령과 실행 상태·구독·완료 알림을 `useAiRequestCommands`/`useAiRun`으로 분리했다. editor flush 중 세션이 바뀌면 다른 세션에서 CLI를 시작하지 않는다. 준비 busy와 시작 ticket도 프로젝트 방문 수명에 묶어 이전 응답이 새 세션의 상태를 막거나 해제하지 못하게 했다. `useProjectLifetime`은 같은 프로젝트의 캔버스 전환을 허용해 캡처한 AI 목적지를 유지하고 프로젝트/세션 왕복에는 만료된다. 실제 CLI/예약/승인 규칙은 R06 서비스를 유지한다.
- 캔버스/도구/문맥 메뉴, 헤더/설정/inspector, AI 요청/실행, 히스토리, 자료 이동 확인창을 typed props·기능 콜백으로 조립한다. 노드 조립은 `useCanvasNodes`, 자료 읽기 연결은 `useProjectLoading`, 디버그 샘플은 `useWorkspacePreview`가 맡는다. 카탈로그의 실제 소스 경로도 갱신했다.
- 저장 상태의 소유자는 기존 DocumentSaveQueue다. 새 전역 Context/store로 옮기지 않았다. 콜백 identity와 기존 노드 identity/measured 보존을 유지한다. 디자인/CSS 순서·라이브러리·파일/IPC 형식·협업 프로토콜은 바꾸지 않았다.

책임 및 검사 연결: `docs/architecture/r05-workspace.md`. 이번 시작 원본/UI·계획서·git 상태는 `%TEMP%/gamejam-r05-final-start-713f44ec2c094ab6b654ac75d5941a63`에 보존했다. 새 경계 회귀 15개가 통과했으며 전체 검사·실제 UI·최종 package 결과는 아래에 확정한다.

### 27.1 최종 검증과 완료 조건

| 검사                                       | 결과                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 자동 테스트                           | **706개 통과, 실패/건너뜀 0**. 이번 경계/수명 회귀 15개 포함. 최종 AI 준비 busy·프로젝트 수명 보완 후 전체 재확인                                                                                                                                                                            |
| 기본 타입 / strict contracts / strict core | 최종 소스에서 모두 통과                                                                                                                                                                                                                                                                      |
| 린트 / 포맷                                | 745개 파일 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지                                                                                                                                                                                                    |
| 자동 저장·동기화 UI                        | title/body/source/focus 편집기의 55개 native 입력, 실제 HTTP/SSE·peer metadata·lock 해제 중 추가 입력 보존 통과. 최종 소스의 sync UI에서 200/500/1500ms 저장·한글/IME commit·초안 충돌·반복 드래그·최신 좌표·이미지/체크리스트 DOM 보존 통과                                                 |
| 필수 기능 UI                               | canvas-selection, document-links, drawings, game-ui, html-preview 통과. 선택/섹션/표시 명령·패널·AI 요청/검증/승인/예약/닫힘·히스토리 UI 통과                                                                                                                                                |
| UI review / 디버그                         | 최종 소스의 전체 카탈로그·홈/작업·F12·highlight·storage/action 격리, dark/light·최소 980×640·더 작은 overflow·빠른 토글·reduced motion·입력/포커스 보존·도구 순서 통과. 실제 preload/IPC·iframe focus·에디터 보존도 통과                                                                     |
| 전체 integration                           | 최종 소스의 `npm run test:integration` 전체 종료 코드 **0**. local/shared 명령·파일/Undo/히스토리·요청/승인/mock CLI, 실제 Chromium/4개 앱, 캔버스 전환·cross-canvas AI 목적지, 한글/IME·200/500/1500ms 저장·초안 충돌 통과. 전체화면 pointer lock 진입/해제 때 bootId와 게임 상태 보존 확인 |
| Windows package                            | 두 소스 버전에서 각각 1회 생성. 첫 검증 뒤 발견한 AI 수명 문제를 보완해 최종 소스를 1회 다시 package했고, 아래 **10개 검사 모두 동일한 최종 결과물** 사용. 검증 전후 입력 지문 일치                                                                                                          |
| 새 package 화면 명령                       | 실제 이동 확인 이중 클릭·단일 기록·경로/본문·Undo/Redo, 히스토리 목록/변경 전후 읽기·복원 확인 이중 클릭/단일 기록, 결과 폴더 이동·원래 HTML/Markdown 바이트·완전 재시작 보존 통과                                                                                                           |
| 같은 package 선택/섹션/표시                | 문서/그림 혼합 복제·삭제·배치·Undo/Redo, 섹션 생성/해제/휴지통·native pointer 소속 변경/취소/이동/제외·단일 기록·확인 만료, 이름 변경·개인 접기·HTML geometry·원래 문서/custom metadata·재시작 보존 통과                                                                                     |
| 같은 package 패널/편집/클립보드/게임 UI    | Home 왕복·명령/플러그인/칸반 상태 관리·Tab/Escape/focus, R04 stale ID 거절/본문/휴지통/legacy history, native Ctrl+V·내부/외부 복사·Undo/Redo·재시작, 게임 UI inspector/개인 geometry/잘못된 입력/Undo·재시작 통과                                                                           |
| 같은 package AI/공동 연결                  | 격리 mock CLI의 로컬 예약/취소/2개 결과, 내장 Node/서버와 독립 앱의 durable 예약·잠금·자동 실행 통과. 공동 생성/참여/복구/역할/초대·offline 홈·실제 UI 충돌 해결/초안 백업·원래 local 복귀 통과                                                                                              |
| 기존 작업 보존                             | 최초 dirty/new 69개와 이번 시작 UI 파일 97개 모두 존재. 시작 원본·이전 package 입력/해시 보존. Windows CRLF를 보존하는 diff whitespace 검사 통과                                                                                                                                             |

완료 조건을 다시 확인했다. App는 provider/화면 조립을 담당하며 각 기능은 명령·상태·보기 모듈에서 수정할 수 있다. 문서 저장 상태를 복제하지 않고 기존 편집 세션·IME·노드/iframe identity·개인 보기·Undo·협업 형식을 유지한다. 노드 의존 콜백 identity 회귀를 추가해 unrelated render의 불필요한 전체 노드 계산을 방지했다. 큰 파일을 단순 재배치한 것만으로 완료 처리하지 않았다.

검증 중 실패는 검사 삭제나 조건 약화 없이 처리했다. 첫 integration은 마지막 칸반 파일 이동 중 Vite가 캔버스 fixture를 재로딩해 중단됐으며 소스를 고정한 뒤 캔버스/sync 구성 검사가 통과했다. 최종 검토에서 AI 준비 busy의 세션 간 잔류를 발견해 제품 코드를 보완하고 회귀 2개를 추가했다. 이후 단위 검사와 함께 실행한 integration은 기존 `waitForStep2`의 HTML 시작 대기에서 실패했고 정리 중 ENOENT/symlink 진단이 뒤따랐다. 병렬 검사가 끝난 뒤 소스를 바꾸지 않고 전체 integration을 단독 실행해 종료 코드 0을 확인했다. 이 재실행을 최종 결과로 기록하며 이전 실패 로그는 보존했다. 최종 AI UI·debug/native·package도 재확인했다.

native F12의 기존 settings 소스 경로 기대값은 실제 추출 위치로 변경한 뒤 재통과했다. package 섹션 helper는 관찰과 클릭 사이 시작 카드가 교체되는 것을 확인해 준비 확인/클릭을 같은 브라우저 작업에서 한 번 수행하도록 보완했다. 원래 UI·프로토콜·본문·기록 assertions와 timeout은 유지했다. 새 결과 폴더 package fixture는 지원하지 않는 임의 HTML 이름 대신 기존 지원 경로 output/index.html을 사용했다. 검사 도구 보완만으로 제품을 재빌드하지 않았으며, 두 번째 제품 빌드는 위 AI 수명 코드 변경 때문에 수행했다. 첫 소스의 package 검사 10개와 입력/해시 기록은 `out/r05-final-first/`에 별도 보존했다.

최종 빌드 입력 지문: `533be87b83d717ac4e5ef23779fe1b36a36641026625bcbc1c16eee07d1862f1`. EXE SHA-256 `bae2934d879279da0732c53bba9804a4be1e861ddec451fb643c8ae508b10ca8`(245,869,568바이트), app.asar SHA-256 `f2dde6284132be18a922c376457c6272bb5c711b7be91ceea7d681e64f83936d`(8,053,749바이트). `out/refactoring-package-{inputs,verification}-r05-final-2026-10-21.json`과 `out/r05-final-verification.json`에 기록했다. UI/package 실행별 기록은 `out/r05-final-{suites,package-suites}.json`, 로그는 `out/r05-final-*.log`다. 최종 UI review의 footer-visible과 실제 표시 명령의 section-collapsed 캡처를 직접 확인했다.

현재 **R00/R01/R02/R03/R04/R05/R06 완료, R07/R08/R09/R10 미완료**다. 이번 요청 범위인 R05는 마무리했으며 다음 구현은 R07 협업 서버의 서비스/실행 수명 분리다. 그 뒤 R08 저장소/migration, R09 백업/복원, R10 Render 설정·검증 도구를 진행한다.

실제 AI 계정/유료 호출·외부 Discord·Render 자원 생성/운영 배포·실사용 데이터 이전·S3/Windows→Linux 복원·다른 PC/외부망/OS 검증은 수행하지 않았다. 모든 프로젝트/프로필/서버는 임시·격리 자료이며 AI는 mock CLI다. F01~F04 로그인·결제·웹 편집·iOS 구현은 계속 제외한다. 기존 PC 협업 서버 기능과 개인 로컬 무료 정책을 유지했고 commit/make/release/게시/운영 서버 재시작은 하지 않았다.

## 28. R07 첫 기능 단위 — HTTP 경계와 SSE 연결 수명

2026-10-21. 사용자의 다음 단계 요청에 따라 R07의 첫 항목인 HTTP 전송 경계부터 구현했다. 단계별 진행 원칙에 따라 이번에는 이 단위에서 멈춘다. **R00~R06 완료, R07 진행 중, R08~R10 미완료**이며 F01~F04 구현을 포함하지 않는다.

- `server/http/{router,request,response,errors}.ts`로 Origin 검사·URL/route dispatch·분할 UTF-8와 JSON 객체 입력·기존 22,000,000바이트 제한·JSON 응답/실패 변환을 분리했다. 기본 상태 400, ApiError 상태와 failure/code/lifecycle, 보안/캐시 헤더를 유지한다. route가 처리 여부를 명시하고 body는 기존 경로에서 읽어 인증/한도 검사 순서를 유지한다.
- `routes/health.ts`는 기존 이름/protocol/version/capability를 응답한다. `routes/events.ts`는 기존 GET 경로를 식별하고 서버가 인증한 actor와 active 프로젝트를 확인한 뒤 사용자별 한도와 연결을 적용한다. body/query의 memberId/role을 신뢰하지 않으며 토큰·Origin·프록시 정책을 바꾸지 않았다.
- `ProjectEvents`가 프로젝트별 SSE 연결·80개 한도·10초 heartbeat·현재 멤버 권한 회수·느린 연결 종료·purge·서버 종료 정리를 소유한다. 서버 전체 context/프로젝트 사본 대신 최신 revision/lifecycle과 현재 멤버 유효성 조회 두 port를 주입한다. 기존 저장 성공 뒤 알림 위치, 초기 이벤트, 이름 없는 revision, play-lobby epoch/revision, 헤더와 폴링/delta fallback을 유지했다.
- `createCollaborationServer(options)`와 return의 server/port/close 호출 형태를 유지한다. 나머지 명령·승인·AI·히스토리·휴지통·저장소 업무는 현재 위치에 남겼다. 경로를 일부 분리했다는 이유로 R07 전체를 완료 처리하지 않는다.

책임/검사 연결은 `docs/architecture/server-http.md`다. 시작 서버/계획서 원본과 전체 git 상태는 `%TEMP%/gamejam-r07-http-start-9318d5d6e9454ef89eee76bcc62df436`에 보존했다. 이전 R05 최종 asar/입력 지문/검증 기록은 `out/r05-final-artifact-before-r07/`에 보존했으며 공용 out 패키지 경로는 이제 이번 R07 소스의 결과물이다.

### 28.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 HTTP/SSE 경계                    | 8개 통과. UTF-8 청크/JSON/정확한 크기 한도, Origin·health·오류, 인증 actor와 한도 순서, 프로젝트별 이벤트/최신 revision, heartbeat 권한 회수, 80개 한도·backpressure·purge/close, 실제 HTTP 소켓 포함                       |
| 전체 자동 테스트                      | **714개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/document-links/approval/queue/multiplayer 회귀 포함                                                                                              |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                   |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 뒤에 추가한 native 검사 도구/문서는 별도 lint/포맷 확인                                                                                     |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 4개 검사를 같은 결과물로 순서대로 실행했고 검증 전후 입력 지문 일치                                                                                                                       |
| 새 package SSE                        | 실제 내장 Node/서버·임시 데이터·두 프로젝트로 초기/lobby 이벤트, commit revision과 프로젝트 격리, 단절 중 변경의 기존 클라이언트 state/revision 복구, 재연결, 실제 heartbeat의 권한 회수 후 연결 종료·재접속/저장 거절 통과 |
| 같은 package 공동 연결                | 실제 UI/IPC·내장 서버의 생성/참여/복구/탈퇴·초대/역할, 오프라인 홈 편집·동기화 충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                   |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                              |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                  |
| 보존/감사                             | 시작 시 dirty/new 파일과 최초 기준 파일의 존재, 시작 원본·검증 로그·Windows CRLF를 고려한 diff whitespace 확인                                                                                                              |

새 native SSE fixture 첫 실행은 기존 명령 계약에 없는 `notes:create`를 사용해 클라이언트 reducer에서 거절됐다. 검사를 지원되는 기존 `documents:create-idea` 명령으로 수정하고 동일 package에서 전부 재실행해 통과했다. 제품 코드·권한/거절 assertion·timeout을 바꾸거나 실패를 삭제하지 않았다. 실패 로그는 `out/r07-http-events-packaged-before-command.log`다. 패키징의 기존 gray-matter eval 경고와 Node의 기존 MODULE_TYPELESS_PACKAGE_JSON 알림을 관측했으며 새 오류로 처리하거나 해결했다고 주장하지 않는다.

최종 입력 지문 `e46190a97e263f7097e25de6c499743393aacfeb2c8d750f7f44d1358ad9aad3`. EXE SHA-256 `f4d1cc9e631589fbf64613b2b7856cb55dc1f4f5a60238628fa04a34c0e65b5e`(245,869,568바이트), app.asar SHA-256 `2c47e6545df47c36c4d5cef3d5b041814bb65fdad2c5c1e55440296621b87d77`(8,054,695바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-http-2026-10-21.json`, `out/r07-http-verification.json`, `out/r07-http-*.log`에 둔다.

다음 작은 단위는 **프로젝트별 직렬 큐와 인증/관리자/편집 권한 정책 분리**다. HTTP 없이 호출 가능한 명령 경계로 연결하면서 큐 안의 권한·revision·lock·receipt 재검증과 저장 후 이벤트 순서를 유지한다. 그 뒤 프로젝트/명령/승인/AI/히스토리/수명 서비스, 나머지 route, bootstrap을 순차적으로 분리해 R07 완료 조건을 검토한다. R08 저장소/migration·R09 백업/복원·R10 Linux/Render는 아직 착수하지 않았다.

모든 검증은 임시 프로젝트·UUID/격리 프로필·임의 로컬 포트를 사용했다. 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 자료 이전은 검증하지 않았다. 운영 서버/터널과 사용자 프로젝트를 변경하지 않았으며 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다.

## 29. R07 다음 기능 단위 — 프로젝트 큐와 접근 정책

2026-10-21. 28절의 다음 작업인 프로젝트별 직렬 큐와 인증/관리자/편집 권한 정책을 구현·검증했다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다.

- `ProjectQueue`가 프로젝트별 FIFO·호출별 반환/실패·실패 후 후속 실행·종료 drain을 소유한다. 서로 다른 프로젝트를 직렬화하지 않는다. 완료한 tail을 정리해 서버 실행 중 완료 프로젝트의 Promise를 계속 쌓지 않으며, 같은 프로젝트의 새 tail이 있으면 이전 완료가 이를 제거하지 않는다. 별도 checkpoint 큐와 lease heartbeat의 기존 실행 위치를 유지했다.
- `createAccessPolicy`로 현재 멤버/토큰 인증·presence 인정, 관리자/뷰어·legacy AI 전체 잠금, 변경 파일의 revision·객체 ID·속성 세대·현재 편집 잠금·기존 AI 작업 문서 제한을 분리했다. token 비교·시계·presence 기록·현재 잠금 조회만 주입하며 HTTP 객체나 repository/서버 전체 context를 받지 않는다.
- 정책은 프로젝트 사본을 소유하지 않는다. 기존 ingress 인증과 큐 안의 최신 프로젝트 조회/재인증·편집/revision/lock 검증 호출 위치를 유지한다. metadata-only 변경과 다른 멤버의 content 잠금 양립, drawing/game-ui reducer의 세부 검증, scoped AI 보호, save lockToken·sequence·receipt·저장 후 이벤트를 기존 경로에 남겼다.
- `ApiError`의 정의를 HTTP에 의존하지 않는 `server/services/errors.ts`로 옮기고 HTTP 모듈은 같은 클래스를 re-export한다. 기존 instanceof·status/code/lifecycle/failure 형식을 유지한다. 새 인증/역할 정책·구독/로그인·저장 형식 변경은 없다.

책임/검사 연결은 `docs/architecture/server-access.md`다. 시작 서버·HTTP errors·계획서 원본과 전체 git 상태는 `%TEMP%/gamejam-r07-policy-start-0d6d8457c7fb41ac95aff80b825ef24e`에 보존했다. 이전 HTTP 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-http-artifact-before-policy/`에 보존했다. 공용 out package 경로는 이번 소스로 갱신했다.

### 29.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 큐/접근 정책 회귀                  | **10개 통과**. 같은 프로젝트 순서/다른 프로젝트 독립, 동기·비동기 실패와 재시도, 이전 완료와 후속 tail 경합·drain, 현재 멤버/토큰/presence, 역할/AI 잠금, revision·객체/속성 세대·metadata 예외, 큐 대기 뒤 최신 프로젝트의 권한 회수/revision/잠금 확인. HTTP 없이 검증                                                     |
| 전체 자동 검사                        | **724개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/approval/queue/multiplayer 회귀 포함                                                                                                                                                                                                              |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                                                                                                                    |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 확장한 package 검사 도구와 문서는 별도 검사                                                                                                                                                                                                  |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 4개 검사를 동일 결과물로 순차 실행. 검증 전후 입력 지문 일치                                                                                                                                                                                                                               |
| 확장한 package 서버 검사              | 두 프로젝트 동시 명령, 같은 요청 동시 재전송의 단일 history/revision/result, 다른 actor의 receipt 재사용 거절, 실패한 명령을 같은 ID로 수정한 재시도, payload admin/memberId 위조 시 viewer 거절 통과. 기존 SSE 프로젝트 격리·commit revision·state/revision 복구·재연결·실제 heartbeat 권한 회수 종료/재접속·저장 거절 유지 |
| 같은 package 공동 연결                | 실제 UI/IPC·내장 서버의 생성/참여/복구/탈퇴·초대/역할, 오프라인 홈 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                                                                           |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                                                                                                                               |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                                                                                                   |
| 보존/감사                             | 최초 기준 파일과 이번 시작 dirty/new 파일 모두 존재. 내장 server.mjs/node.exe와 준비한 runtime의 해시 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                                                                                                       |

확장 native fixture의 첫 raw command는 이미 속성별 동기화를 활성화한 프로젝트에 capability/version 필드 없이 전송해 기존 서버 호환성 검사에서 거절됐다. 기존 클라이언트가 사용하는 propertySyncVersion/sessionId/sequence와 canvas/status/file-property version을 fixture에 포함하고 동일 package에서 처음부터 재실행해 통과했다. 제품의 호환성 거절·역할/receipt/history assertion·timeout을 약화하지 않았고 제품 재빌드도 없었다. 실패 로그는 `out/r07-policy-events-packaged-before-client-versions.log`다. 큐 단위 검사의 commit 실패는 주입한 작업 오류이며, native 실패 재시도는 잘못된 명령의 수정 재시도다. 실제 SQLite commit 실패 주입과 receipt/알림의 원자성 검증 완료를 주장하지 않으며 다음 명령 서비스 단위에서 연결한다.

최종 입력 지문 `bfec754b2689b1bd362237d926e6343093ae9a4cee3a01ed93065be95d0db3c0`. EXE SHA-256 `8fa600be08bcda4f1e6868fb05096fec6fc92013813248ef9da6047af5ac0de1`(245,869,568바이트), app.asar SHA-256 `1c92a6df27a7b1b095ea122b888dc017ef4a0d4bcb6334f5ba15681d49dd6264`(8,055,048바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-policy-2026-10-21.json`, `out/r07-policy-verification.json`, `out/r07-policy-*.log`다. 패키징의 기존 gray-matter eval 경고와 Node의 MODULE_TYPELESS_PACKAGE_JSON 알림은 유지한다.

다음 작은 단위는 **queued command의 업무 서비스 분리**다. HTTP callback에 남은 명령 receipt·sequence·reducer·저장·반영 결과를 필요한 port를 받는 경계로 옮기고, HTTP 없이 저장 실패·재전송·권한/revision/잠금 재검증·저장 후 이벤트 순서를 검증한다. 이후 프로젝트/승인/AI/히스토리/수명 서비스와 나머지 route/bootstrap을 분리해 R07 전체 완료 조건을 검토한다.

임시 프로젝트·격리 프로필·임의 로컬 포트만 사용했으며 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았고 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. R08~R10 및 F01~F04 구현은 계속 제외한다.

## 30. R07 다음 기능 단위 — 명령 처리 서비스

2026-10-21. 29절의 다음 작업인 queued command의 업무 경계를 `server/services/command-service.ts`로 분리했다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다.

- 서비스가 작업 생성 관리자 검사·요청 ID·legacy/current receipt·actor 충돌·원래 historyId/result 재사용, 현재 save lockToken·canvas capability·sequence, reducer·AI 보호·revision/객체/속성 세대 검사, 후보/히스토리/순번/receipt 생성과 저장/결과 반환을 소유한다. 파일 변경이 없는 historyId=null과 receipt 500개 한도를 유지했다.
- 권한/현재 잠금·reducer·AI 보호·revision 검사·사본·히스토리·persist·envelope만 주입했다. HTTP 객체·SQLite나 서버 전체 context를 받지 않는다. 기존 공통 ingress 인증, 큐 안의 최신 프로젝트 재조회/재인증·lifecycle/capability gate·AI 만료 처리는 기존 위치에 남기고 큐를 중복 획득하지 않는다.
- 명령 후보에 파일·히스토리·순번·receipt를 함께 기록하고 persist 완료 뒤 응답한다. 저장 전 실패는 현재 프로젝트를 바꾸지 않으며 같은 ID 재시도/재전송은 원래 결과/기록을 유지한다. 저장 후 알림은 기존 persist adapter에 남겼다. 명령 reducer와 파일/IPC/협업 프로토콜·디자인·라이브러리는 변경하지 않았다.

책임/검사 연결은 `docs/architecture/server-command.md`다. 시작 서버·계획서·전체 git 상태는 `%TEMP%/gamejam-r07-command-start-871d874f8b424923848071dada6531bd`에 보존했다. 이전 policy 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-policy-artifact-before-command/`에 보존했으며 공용 out package 경로는 이번 소스의 결과물이다.

### 30.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 명령 서비스 회귀                   | **10개 통과**. commit 대기·실패·원본/순번/receipt 보존, 같은 ID 재시도/동시 재전송, 다른 actor 충돌, legacy/null history, capability·ID·sequence·save lockToken·content 세대, receipt 제거 후 오래된 순번 거절, AI 보호·관리자, 큐 대기 뒤 최신 인증을 HTTP 없이 검증 |
| 실제 SQLite 중단/재개방               | 실제 SyncStore/SQLite transaction에서 blob 삽입 뒤 project INSERT를 RAISE(ABORT)로 중단. blob·project·history·receipt 롤백/알림 없음, trigger 제거 후 같은 ID 성공·한 번 기록, 저장소 재개방 후 같은 receipt 재사용 통과                                              |
| 전체 자동 검사                        | **734개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/approval/queue/multiplayer 회귀 포함                                                                                                                                                       |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                                                             |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 검사                                                                                                                                                       |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 4개 검사를 같은 결과물로 순차 실행. 검증 전후 입력 지문 일치                                                                                                                                                                        |
| 확장한 package 서버 검사              | 실제 내장 Node/서버의 SQLite trigger 중단 때 DB 값·blob 수·history·SSE revision 유지와 성공 알림 미발행 확인. 같은 ID 재시도/재전송으로 한 번 기록/결과 인정 통과. 기존 두 프로젝트 동시 명령·actor/역할 위조·SSE 격리/재연결/권한 회수 검사 유지                     |
| 같은 package 공동 연결                | 실제 UI/IPC·내장 서버의 생성/참여/복구/탈퇴·초대/역할, 오프라인 홈 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                    |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                                                                        |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                                            |
| 보존/감사                             | 최초 기준 파일과 이번 시작 dirty/new 파일 모두 존재. 내장 server.mjs/node.exe와 준비 runtime의 해시 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                                                  |

첫 신규 단위 검사에서 저장소 JSON 직렬화가 생략하는 undefined 필드까지 메모리 결과와 같다고 가정했고, 지원하지 않는 red 카드 색을 사용해 2개가 실패했다. 저장소 재개방 기대값을 실제 JSON 경계의 결과로 비교하고 기존 지원 색 yellow로 fixture를 수정했다. DB/파일/receipt/알림/순번의 assertion이나 제품 동작을 약화하지 않았으며 실패 로그는 `out/r07-command-boundary-before-fixture.log`에 보존했다. 이후 신규 10개와 전체 734개가 통과했다. 최종 native package 검사는 처음부터 모두 통과했으며 제품 재빌드는 없었다.

최종 입력 지문 `7b92158390715600d05f27df88d7266f1d604c15c88c3ccc9e877452712ea152`. EXE SHA-256 `f01f0a1752e634c8ddf608d773f2767668658047b1afe1537c3b083bf6b7adea`(245,869,568바이트), app.asar SHA-256 `a981a5c3797d79d89f2bd5ab53f1754f0a3ec428115eada103d4dc2d2082b6e8`(8,055,366바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-command-2026-10-21.json`, `out/r07-command-verification.json`, `out/r07-command-*.log`다. 기존 gray-matter eval 경고와 Node의 MODULE_TYPELESS_PACKAGE_JSON 알림은 유지한다.

29절에 남겼던 실제 SQLite commit 실패·receipt/알림 검증을 이번 단위에서 연결했다. 검증한 장애는 실제 SQLite trigger에 의한 트랜잭션 중단이며 물리 디스크/전원 장애 검증을 뜻하지 않는다. DB commit 뒤 runtime/checkpoint/lifecycle 복구 파일 내보내기 실패 구분과 repository/migration은 R08 범위로 남기고 기존 persist adapter를 유지했다.

다음 작은 단위는 **프로젝트·멤버 관리 서비스 분리**다. 생성/참여/복구·초대/멤버 역할과 프로젝트 기본 관리의 인증/큐/저장 흐름을 필요한 port를 받는 경계로 나눈다. 이후 승인/AI/히스토리/수명 서비스와 나머지 route/bootstrap을 분리해 R07 전체 완료 조건을 검토한다. offline apply·history/restore 등 별도 처리도 아직 남아 있다.

임시 프로젝트·격리 프로필·임의 로컬 포트만 사용했고 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트는 변경하지 않았으며 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. R08~R10 및 F01~F04 구현은 이번 단위에 포함하지 않는다.

## 31. R07 다음 기능 단위 — 프로젝트·멤버 관리 서비스

2026-10-21. 30절의 다음 작업인 생성/참여/복구·초대/멤버 역할과 프로젝트 기본 관리를 필요한 port를 받는 업무 서비스로 분리했다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다.

- `createProjectService`가 생성 기본값·이름/snapshot·기존 프로젝트 수 제한, 참여의 초대 정규화/검색·큐 안 최신 active/초대/인원 재검증, 복구 키 검사와 소유자 token/recoveryKey 회전, 이름 변경의 관리자/AI/expectedName·같은 이름 재시도를 소유한다. 생성/참여는 저장 성공 뒤 기존 presence 인증을 수행하며 복구의 기존 응답/권한 인정 순서를 유지한다.
- `createMemberService`가 초대 hash/만료·히스토리, 역할/제거 대상·생성자/AI 실행자 보호, leave의 presence/현재 멤버 잠금 정리를 맡는다. role/owner를 요청 body로 주입해 참여 권한을 얻을 수 없으며 leave는 기존처럼 durable 멤버/token을 삭제하지 않는다. 역할 변경 시 잠금 해제의 기존 persist 전 순서도 유지했다.
- 프로젝트 조회 count/all/get·큐·시계/ID/토큰 생성/비교·권한/인증·저장/history/envelope와 필요한 presence/잠금 port만 주입한다. HTTP 생성 키·rate limit·body/응답과 공통 큐 내부 인증/lifecycle/capability gate는 조립부에 남겼다. 서버 전체 context나 HTTP 객체를 서비스에 넘기지 않는다.
- 기존 서버 state의 Member/StoredHistory/Job/Project/Lock 타입을 `server/project-state.ts`로 옮겼다. 서비스가 bootstrap 파일을 역으로 import하지 않게 하는 타입 경계이며 기존 JSON/SQLite schema·파일/IPC/협업 프로토콜은 변경하지 않는다. 계획의 runtime context/bootstrap 전체 분리를 완료한 것으로 간주하지 않는다.

책임/검사 연결은 `docs/architecture/server-projects.md`다. 시작 서버·계획서·전체 git 상태는 `%TEMP%/gamejam-r07-projects-start-9e1564db945e4defb47e531416a70536`에 보존했다. 이전 command 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-command-artifact-before-projects/`에 보존했으며 공용 out package 경로는 이번 소스 결과물로 갱신했다.

### 31.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 프로젝트/멤버 서비스 회귀          | **16개 통과**. 생성 기본값/원본/hash/시계/ID·입력/한도·commit 대기와 실패, 참여 정규화/권한 위조 거절·대기 중 초대 회전/만료/삭제·동시 인원 제한, 복구의 key/token 회전·동시 중복/이전 키 거절·삭제 응답·저장 실패, rename 재시도·역할/AI 보호·leave의 presence/잠금·durable 멤버 보존을 HTTP 없이 검증 |
| 실제 SQLite 중단/재개방               | SyncStore/SQLite trigger로 참여/복구의 트랜잭션을 중단. 저장된 멤버/기존 token/recoveryHash·파일과 현재 프로젝트 보존, 실패 후 기존 key로 재시도, 저장소 재개방 뒤 새 자격 정보/hash·파일 보존 통과                                                                                                     |
| 전체 자동 검사                        | **750개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/approval/queue/multiplayer 회귀 포함                                                                                                                                                                                         |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                                                                                               |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                                                                                                                                         |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 4개 검사를 동일 결과물로 순서대로 실행. 검증 전후 입력 지문 일치                                                                                                                                                                                                      |
| 같은 package 공동 연결                | 실제 UI/IPC·내장 Node/서버의 생성/참여/복구/연결 종료·초대 회전/역할, 오프라인 홈 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                                       |
| 같은 package 서버/SSE                 | 두 프로젝트 동시 명령·중복 receipt·다른 actor 충돌·역할 위조 거절, 실제 내장 SQLite 중단의 DB/blob/history/receipt 롤백과 SSE 성공 알림 미발행·같은 ID 재시도, SSE 격리·재연결·권한 회수 뒤 종료/재접속·저장 거절 통과                                                                                  |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                                                                                                          |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                                                                              |
| 보존/감사                             | 최초 기준 파일과 이번 시작 dirty/new 파일 모두 존재. 내장 server.mjs/node.exe와 준비 runtime의 해시 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                                                                                    |

신규 16개와 전체 750개·최종 native package 검사는 모두 통과했다. 실패 assertion 삭제·timeout 완화·제품 재빌드 없이 동일 소스/결과물을 검증했다. 프로젝트 20개 제한은 기존 조회 시점의 정책이며 새 전역 생성 큐를 추가하거나 동시 생성의 전역 원자성을 새로 보장했다고 주장하지 않는다. 역할 변경 실패 때 ephemeral 잠금 해제까지 rollback한다고 주장하지 않으며 기존 순서를 유지한다.

최종 입력 지문 `64444bbb2e24d89a71277f1f03971cbd69cbf2609534188b65d3d966e9c47fe4`. EXE SHA-256 `56425f4142f3aef589f56de7f997f7e10b78b4d9ee3f86b1c65f7cb0f0bf601e`(245,869,568바이트), app.asar SHA-256 `e2e3d1d7f2b8d5cdccac2d7920d462736907f5cf0e9236d21450bb28a1b65880`(8,056,789바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-projects-2026-10-21.json`, `out/r07-projects-verification.json`, `out/r07-projects-*.log`다. 기존 gray-matter eval 경고와 Node의 MODULE_TYPELESS_PACKAGE_JSON 알림은 유지한다.

다음 작은 단위는 **승인 요청 관리 서비스 분리**다. 요청 목록/읽기·작성·수정·취소·보완의 author/관리자·revision·검토 입력·저장 흐름을 나누고 HTTP 없이 검증한다. 승인 시작/AI 조정, offline apply·히스토리/복원·프로젝트 수명과 나머지 route/bootstrap은 이어서 분리해 R07 전체 완료 조건을 검토한다. DB commit 뒤 복구 파일 내보내기 실패 구분·repository/migration은 R08 범위로 남아 있다.

모든 검사는 임시 프로젝트·격리 프로필·임의 로컬 포트로 수행했다. 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았으며 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. R08~R10 및 F01~F04 구현은 이번 단위에 포함하지 않는다.

## 32. R07 다음 기능 단위 — 승인 요청 관리 서비스

2026-10-21. 31절의 다음 작업인 요청 목록/읽기·작성·수정·취소·보완의 업무 흐름을 `server/services/approval-service.ts`로 분리했다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다. `requests-start` 승인 시작/AI 실행 조정은 이번 추출 대상에서 제외하고 기존 경로를 유지한다.

- 서비스가 목록 정렬·읽기와 현재 입력 검토, viewer 변경 거절/관리자 보완·본인 수정/취소, pending/feedback·현재 revision, commandId/actor/내용 지문 receipt, 요청 정제/복사 출처·변경 이력·requestsVersion과 저장을 소유한다.
- 관리자 검사·사본·persist·시계·지문 hash·입력 검토 계획의 6개 port만 주입한다. HTTP 객체·서버 전체 context 없이 실행하며 공통 ingress 인증과 큐 안 현재 프로젝트/actor 재조회·lifecycle/capability 검사 위치를 유지하고 큐를 중복 획득하지 않는다.
- 요청·변경 이력·requestsVersion·receipt를 후보 사본에 함께 반영하고 저장 완료 뒤 반환한다. 문서 files/revision/history와 기존 저장/알림 adapter를 바꾸지 않는다. 검토 실패는 reviewError로 읽으며 읽기가 저장 상태를 변경하지 않는다. 같은 명령 receipt는 원래 requestId의 현재 항목을 반환하고 권한 검사를 건너뛰지 않는다.
- 현재 코드의 요청 1,000개·승인 변경 receipt 2,000개 한도를 그대로 유지한다. 일반 편집 명령의 receipt 500개와 별도임을 확인했다. receipt가 제거된 뒤에도 생성 ID 충돌·기존 요청 revision/status 보호를 유지한다. token/provider 등 계약 밖의 필드는 공유 요청에 저장하지 않으며 기존 파일/IPC/HTTP 형식·디자인·라이브러리는 변경하지 않았다.

책임/검사 연결은 `docs/architecture/server-approvals.md`다. 시작 서버·계획서·전체 git 상태는 `%TEMP%/gamejam-r07-approvals-start-c71b7c25ca3b418ebf29180bc724f8d8`에 보존했다. 이전 projects 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-projects-artifact-before-approvals/`에 보존했다. 공용 out package 경로는 이번 소스 결과물로 갱신했다.

### 32.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 승인 요청 서비스 회귀              | **12개 통과**. 작성자/관리자/viewer·stale revision·terminal 상태·검토 오류·요청 정제/이력 사본, actor/지문 충돌·현재 항목 재사용, 두 보관 한도·receipt 제거 뒤 충돌/revision 보호, commit 대기/실패·큐 경쟁/권한 회수를 HTTP 없이 검증                                                         |
| 실제 SQLite 중단/재개방               | SyncStore/SQLite trigger로 요청·requestsVersion·receipt 트랜잭션 중단. 이전 프로젝트/DB 보존·알림 없음·같은 ID 재시도·저장소 재개방 뒤 receipt 재사용 통과. 입력 검토 계획은 신규 서비스 검사에서 주입한 port이며 실제 planApproval 경로는 기존 전체 서버 회귀와 UI/native package로 별도 확인 |
| 전체 자동 검사                        | **762개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/approval/queue/multiplayer 회귀 포함                                                                                                                                                                                |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                                                                                      |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                                                                                                                                |
| 승인 UI                               | `npm run test:gamejam-approval` 통과. 로그인 없는 요청, 공동 수정·보완·stale review·입력 변경·관리자 시작·실행 입력 고정 확인                                                                                                                                                                  |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 **5개 검사 모두 동일한 결과물**로 순차 실행. 검증 전후 입력 지문 일치                                                                                                                                                                                        |
| 같은 package 승인 UI                  | 실제 독립 관리자/팀원 IPC·내장 Node/서버의 요청 수정/보완·오래된 검토 거절·실제 승인 버튼, 격리 mock CLI·검증한 HTML 게시·역할 검사·서버 재시작 후 기록 보존 통과. 팀원 완료 요청 캡처를 직접 확인                                                                                             |
| 같은 package 공동 연결                | 생성/참여/복구/연결 종료·초대 회전/역할, 오프라인 홈 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                                                           |
| 같은 package 서버/SSE                 | 두 프로젝트 동시 명령·중복 receipt·actor/역할 위조 거절, 실제 내장 SQLite 중단의 DB/blob/history/receipt 롤백과 SSE 성공 알림 미발행·같은 ID 재시도, SSE 격리·재연결·권한 회수 뒤 종료/재접속·저장 거절 통과                                                                                   |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                                                                                                 |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                                                                     |
| 보존/감사                             | 최초 기준 파일과 이번 시작 dirty/new 파일 모두 존재. 내장 server.mjs/node.exe와 준비 runtime의 해시 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                                                                           |

신규 12개·전체 762개·승인 UI·최종 native package 검사는 모두 통과했다. 실패 검사 삭제·timeout 완화·제품 재빌드는 없었다. 개발용 승인 UI fixture에서 Vite의 Node 모듈 외부화 알림을 관측했으나 기능 검사는 통과했다. 최종 패키지의 기존 gray-matter eval 경고와 Node의 MODULE_TYPELESS_PACKAGE_JSON 알림을 해결했다고 주장하지 않는다.

최종 입력 지문 `24ce3990ee73a8540694083e90fa1550b8c23d29183def36088731bfd5eda4a0`. EXE SHA-256 `d0a270efe7edf5bd05162b2da97279d74c037e1ec46c92ccca36c1b10db0dbcd`(245,869,568바이트), app.asar SHA-256 `c40915ef0399ff25a5475b96c7dd01a169b499cc7ea428d261793fe356b3def8`(8,056,975바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-approvals-2026-10-21.json`, `out/r07-approvals-verification.json`, `out/r07-approvals-*.log`다. 실제 팀원 완료 화면은 `out/gamejam-approval/packaged-team-completed.png`에 남겼다.

다음 작은 단위는 **승인 시작과 서버 AI 조정 경계 분리**다. `requests-start`의 검토 토큰·요청 revision·중복/동시 승인과 준비 입력을 기존 실행·예약/claim 규칙에 연결해 분리한다. offline apply·히스토리/복원·프로젝트 수명과 나머지 route/bootstrap도 이어서 R07 완료 조건을 확인한다. DB commit 뒤 복구 파일 내보내기 실패 구분·repository/migration은 R08에 남아 있다.

모든 검사는 임시 프로젝트·격리 프로필·임의 로컬 포트로 수행했다. 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았으며 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. R08~R10 및 F01~F04 구현은 이번 단위에 포함하지 않는다.

## 33. R07 다음 기능 단위 — 승인 시작·서버 AI 시작 조정

2026-10-21. 32절의 다음 작업인 `requests-start`와 공유 `ai-start`/`ai-claim` 흐름을 `createAiCoordinator.start`로 분리하고, 승인 재전송/검토 준비는 `prepareApprovalExecution`으로 나눴다. 이번 시작 기능 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다. heartbeat·progress/event·취소·완료 결과 반영은 이번 추출에 섞지 않고 기존 서버 경계에 남겼다.

- `approval-execution.ts`가 현재 요청/commandId·요청 revision/status와 입력 검토 token, 예약/실행 재전송의 provider/model/reasoning·원래 검토값 일치를 확인한다. 예약은 원래 queuedTask를, 실행 중 재전송은 같은 실행자에게만 원래 lease/taskPath를 반환한다. 기존 재전송 응답 필드를 유지하며 계획/검토 자체로 저장하거나 lease를 만들지 않는다.
- `ai-coordinator.ts`가 관리자·제공자/모델/추론, FIFO claim/기존 임대·예약 baseline, task 명세와 canvas/multiplayer/document/HTML/workflow capability·편집 잠금·기존 결과·예약 충돌을 검사한다. 검증한 예약의 실행 설정을 사용하고 stale 입력은 실패 상태로 저장하되 실행 임대를 주지 않는다.
- 동결 executionRequest·승인자/원래 revision/reviewToken/실행 설정, task 파일·히스토리·예약 또는 job/lease·결과 경로를 후보에 함께 반영한다. 기존 persist 이후에 응답하고 저장 후 알림·queue/run 최종 상태 조립은 기존 adapter에 남긴다. legacy 직접 실행의 예약 우회를 막는 기존 정책과 단일 실행 한도를 유지했다.
- 필요한 권한·사본·저장/envelope·planApproval·현재 잠금·task 상태·히스토리와 시계/ID/secret/hash만 주입한다. HTTP 객체·서버 전체 context나 실제 CLI 인증을 전달하지 않는다. 공통 ingress 인증/큐 안 현재 상태·lifecycle/capability·만료 처리 위치를 유지하고 큐를 다시 획득하지 않는다. 기존 queue 모델 함수의 시계·파일 보호/충돌 정책도 바꾸지 않았다.

책임/검사 연결은 `docs/architecture/server-ai-start.md`다. 시작 서버·계획서·전체 git 상태는 `%TEMP%/gamejam-r07-ai-start-bcbb6cf20ab24fd692d50995ecdb0342`에 보존했다. 이전 approvals 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-approvals-artifact-before-ai-start/`에 보존했고 공용 out package 경로는 이번 소스 결과물로 갱신했다.

### 33.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 승인/AI 시작 회귀                  | **13개 통과**. 시작 lease/시계/ID·관리자/실행 설정/프로젝트 revision, 승인 token/현재 요청과 동결·같은 실행자 재전송/설정 변경 거절·동시 승인, 예약/FIFO claim/임대 격리/stale baseline, capability/편집 잠금/기존 결과·legacy 우회 거절, commit 대기/실패와 큐 대기 뒤 현재 요청/actor를 HTTP/CLI 없이 검증                      |
| 실제 SQLite 중단/재개방               | SyncStore/SQLite trigger로 동결 승인·task 파일·히스토리·예약 트랜잭션 중단. blob/project 롤백·현재 프로젝트/알림 보존, 같은 명령 재시도·저장소 재개방 뒤 같은 queuedTask 재사용 통과. 신규 서비스 검사의 승인 plan/상태 저장 조립은 주입한 port이며 실제 planApproval/persist 경로는 전체 서버 회귀·UI/native package로 별도 확인 |
| 전체 자동 검사                        | **775개 통과, 실패/건너뜀 0**. 기존 collaboration/network/property/offline/approval/queue/multiplayer 회귀 포함                                                                                                                                                                                                                   |
| 타입 / strict contracts / strict core | 최종 소스에서 모두 통과                                                                                                                                                                                                                                                                                                           |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수와 Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                                                                                                                                                                   |
| 승인 UI                               | 로그인 없는 요청·공동 수정/보완·stale review·입력 변경·관리자 시작·동결 요청 통과                                                                                                                                                                                                                                                 |
| AI 예약 UI                            | 공동 재료 보호 표시/개수·추가 요청 허용·예약 개별 취소·완료 뒤 보호 해제 통과                                                                                                                                                                                                                                                     |
| Windows package                       | 최종 소스/설정으로 1회 생성. 아래 **5개 검사 모두 동일한 결과물**로 순차 실행. 검증 전후 입력 지문 일치                                                                                                                                                                                                                           |
| 같은 package 승인 UI                  | 독립 관리자/팀원 IPC·내장 Node/서버의 요청 수정/보완·오래된 검토 거절·실제 승인 버튼, 격리 mock CLI·검증한 HTML 게시·역할 검사·서버 재시작 후 기록 보존 통과. 팀원 완료 요청 캡처 직접 확인                                                                                                                                       |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·결과, 내장 Node/서버·독립 앱의 durable 예약·잠금·자동 claim/실행 통과                                                                                                                                                                                                                              |
| 같은 package 공동 연결                | 생성/참여/복구/연결 종료·초대 회전/역할, 오프라인 홈 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                                                                                              |
| 같은 package 서버/SSE                 | 두 프로젝트 동시 명령·중복 receipt·actor/역할 위조 거절, 실제 내장 SQLite 중단의 롤백·SSE 성공 알림 미발행·같은 ID 재시도, SSE 격리/재연결/권한 회수 뒤 종료·거절 통과                                                                                                                                                            |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                                                                                                        |
| 보존/감사                             | 최초 기준 파일과 이번 시작 dirty/new 파일 모두 존재. 내장 server.mjs/node.exe와 준비 runtime의 해시 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                                                                                                              |

초기 추출의 정적 검사에서 승인 재전송 객체의 괄호와 결과 반영 경로에 남아 있는 canvasId import 누락을 확인해 수정했다. 초기 타입 진단은 `out/r07-ai-start-typecheck-initial.log`에 보존했다. 최종 신규 13개·전체 775개·두 UI·native package 검사는 모두 통과했고 assertion 삭제·timeout 완화·제품 재빌드는 없었다. 개발 fixture의 기존 Vite Node 모듈 외부화 알림, 패키징의 gray-matter eval 경고와 Node MODULE_TYPELESS_PACKAGE_JSON 알림을 해결했다고 주장하지 않는다.

최종 입력 지문 `cdf2d22a3bb46c6c03e8bcdc877aa9515b89045ded531ad256f46f118b0e593a`. EXE SHA-256 `95c0b6ae254c78e6440d6de55062c8b9f549f3eda4a8af405eb6cd7623d99697`(245,869,568바이트), app.asar SHA-256 `5383855ed915c8bb5d94097aa8d9a7af8525fa7814869b4e10b3b488f9ab306d`(8,057,574바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-ai-start-2026-10-21.json`, `out/r07-ai-start-verification.json`, `out/r07-ai-start-*.log`다. 실제 팀원 완료 화면은 `out/gamejam-approval/packaged-team-completed.png`에 남겼다.

다음 작은 단위는 **실행 중 서버 AI 수명과 결과 반영 서비스 분리**다. heartbeat·이벤트/progress·취소·완료 결과 검증/반영과 예약 개별 취소·만료/승인 최종 상태의 잔여 조립을 확인한다. offline apply·히스토리/복원·프로젝트 수명과 나머지 route/bootstrap도 R07에 남아 있다. R08의 DB commit 뒤 복구 파일 실패 구분·repository/migration은 아직 착수하지 않았다.

모든 검사는 임시 프로젝트·격리 프로필·임의 로컬 포트로 수행했고 AI는 격리 mock CLI다. 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았으며 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. 개인 무료 로컬 사용·PC CLI 실행·기존 PC 협업 기능을 유지하며 R08~R10 및 F01~F04 구현은 이번 단위에 포함하지 않는다.

## 34. R07 다음 기능 단위 — 서버 AI 실행 수명·결과 반영

2026-10-21. 33절의 다음 단위인 heartbeat·progress·실행 취소·완료 검증/반영, 예약 개별 취소·만료 및 예약/승인 최종 상태 조립을 구현·검증했다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다.

- `ai-run-service.ts`가 현재 lease 소유자/토큰·runId·권한, 진행 상태·만료와 후보 task/히스토리/이벤트 조립을 담당한다. 관리자·사본·저장/envelope·taskState/recordChanges·시계/hash를 주입하고 HTTP/CLI/서버 전체 context는 받지 않는다. 기존 프로젝트 큐 안의 현재 인증/공통 gates와 만료 처리 위치를 유지했다.
- `ai-result.ts`의 순수 결과 준비는 scoped/legacy baseline·정확한 허용 결과 파일·기존 문서/출처/HTML/분석 검증·새 문서 배치·완료 메타데이터를 다룬다. 실패/취소 결과물을 반영하지 않고 기존 코드/메시지 제한·파일 형식·HTML 조각 허용을 보존한다.
- `ai-state.ts`는 persist 후보의 예약 상태·종료 baseline 정리와 승인 완료/실패/중지를 동기화한다. 종료 이력/revision을 중복 생성하지 않으며 기존 persist의 SQLite save 이전 위치에 연결했다. heartbeat는 기존처럼 현재 임대만 30초 연장하고 별도 DB 저장/알림을 만들지 않는다.
- 실제 코드에서 progress가 원본 job.event를 먼저 바꿔 SQLite 실패에도 메모리에 상태가 남는 문제를 확인했다. 후보 사본을 저장하도록 보완하고 대기/실패·실제 SQLite abort 회귀를 추가했다. 프로토콜을 변경하지 않으면서 저장 전 실패의 상태 오염을 방지하기 위한 계획 보완이다.

책임과 오류 경계는 `docs/architecture/server-ai-run.md`에 기록했다. 시작 서버·계획서·전체 git 상태는 `%TEMP%/gamejam-r07-ai-run-start-c2046d75327744c49bb6e8fafd552aaf`에 보존했다. 이전 시작 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-ai-start-artifact-before-ai-run/`에 복사했고 이전 asar 해시 일치를 확인했다.

### 34.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 실행 수명 회귀                   | **20개 통과**. 임대/역할·heartbeat 무저장, 진행 상태, 순수 결과 준비·성공/실패/취소 반영, scoped/legacy baseline·잘못된 결과/HTML, 실행/예약 취소·재전송, 만료 경계·승인 동기화 반복, 저장 대기/실패와 재시도·큐 대기 중 lease 교체                     |
| 실제 SQLite 중단/재개방               | progress/finish를 SyncStore와 RAISE(ABORT) trigger로 중단. 현재/DB lease·파일·blob·히스토리·승인 보존, 성공 알림 미발행, 재시도와 재개방 통과. 서비스 검사의 recordChanges/envelope 등은 주입 port이며 실제 조립은 서버 회귀·native package로 별도 확인 |
| 전체 자동 검사                        | **795개 통과, 실패/건너뜀 0**                                                                                                                                                                                                                           |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                                                               |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                                                                                           |
| 승인 / 예약 UI                        | 무로그인 제출·공유 편집·보완·stale 검토·시작/동결, 재료 보호/개수·추가 요청·개별 취소·완료 잠금 해제 통과                                                                                                                                               |
| Windows package                       | 최종 소스/설정으로 **1회** 생성. 아래 **5개 검사**를 동일 결과물로 순서대로 실행. 검증 전후 입력 지문 일치                                                                                                                                              |
| 같은 package 승인                     | 실제 독립 관리자/팀원 UI·IPC, 승인·격리 mock CLI·HTML 완료 반영·역할, 재시작 후 결과 보존 통과. 팀원 완료 화면도 확인                                                                                                                                   |
| 같은 package AI 예약                  | 격리 mock CLI의 로컬 예약/취소·2개 결과 버전, 내장 Node/서버와 독립 앱의 durable 예약·잠금·자동 실행 통과                                                                                                                                               |
| 같은 package 공동 연결                | 생성/참여/복구/연결 종료·초대/역할, 오프라인 편집·충돌 UI 해결·초안 백업·기존 로컬 복귀 통과                                                                                                                                                            |
| 같은 package 서버/SSE                 | 프로젝트별 동시 명령·receipt 재전송·actor 충돌/역할 위조 거절, 실제 SQLite 중단 롤백·성공 알림 미발행/재시도, SSE 격리·재연결·권한 회수 통과                                                                                                            |
| 같은 package multiplayer              | 실제 Windows 앱 4개·독립 인증 사용자·production IPC/preload·고정 게임·준비/시작·native 입력·방장 퇴장 통과                                                                                                                                              |
| 보존 / 감사                           | 최초 기준 **69개**와 이번 시작 dirty/new **427개** 모두 존재. 준비 runtime과 내장 server.mjs/node.exe의 SHA-256·크기 일치, Windows CRLF를 고려한 diff whitespace 확인                                                                                   |

초기 신규 HTML 음성 테스트는 HTML 조각을 거부할 것으로 잘못 가정해 16개 중 1개가 실패했다. 기존 inspectHtml이 조각을 허용함을 확인하고 허용 호환성 assertion을 추가했으며 거부 대상 코드 블록 검증을 유지했다. 초기 실패 기록은 `out/r07-ai-run-boundary-first.log`에 남겼다. 추출 중 결과 status의 반환 타입 확대 진단도 명시적인 terminal 상태 타입으로 수정했다. 기존 실패 검사를 삭제/약화하거나 timeout을 늘리지 않았고 최종 제품 소스의 검사·패키지를 불필요하게 반복하지 않았다. 기존 Vite 모듈 외부화·gray-matter eval·Node MODULE_TYPELESS_PACKAGE_JSON 알림은 해결했다고 주장하지 않는다.

최종 입력 지문 `60021c10781879d8481f3b815675b19bbfd2e369920de9720091339d2bd6a855`. EXE SHA-256 `9efa63992b25b57d6887abf0da7bc8ca74d1eddecae7c2a9e9654422169db5b5`(245,869,568바이트), app.asar SHA-256 `fc777a1d511e3b31a7b8b8df40b398c82a303b493220345e3011987493e002b3`(8,058,293바이트). 기록은 `out/refactoring-package-{inputs,verification}-r07-ai-run-2026-10-21.json`, `out/r07-ai-run-verification.json`, `out/r07-ai-run-*.log`다. 실제 팀원 완료 화면은 `out/gamejam-approval/packaged-team-completed.png`에 남겼다.

다음 작은 단위는 **오프라인 변경 반영(offline apply) 서비스 분리**다. 히스토리/복원·프로젝트 수명과 나머지 route/bootstrap도 R07에 남아 있다. **SQLite commit 뒤 lifecycle/runtime/checkpoint 파일 실패의 구분과 repository/migration은 R08에 남아 있으며, 이번 작업으로 모든 persist 실패의 원자적 롤백을 보장하지 않는다.** SQLite trigger 검증은 물리 디스크 장애나 전원 차단 검증이 아니다.

모든 검사는 임시 프로젝트·격리 프로필·임의 로컬 포트로 수행했고 AI는 격리 mock CLI다. 실제 AI 계정/유료 호출·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 검증하지 않았다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았고 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. 개인 무료 로컬 사용·PC CLI 실행·기존 PC 협업 기능을 유지하며 R08~R10과 F01~F04 구현은 이번 단위에 포함하지 않는다.

## 35. R07 다음 기능 단위 — 오프라인 변경 반영 서비스

2026-10-21. 34절의 다음 단위인 `offline-sync` 반영을 HTTP에서 분리하고 파일 변경 준비와 저장 조정을 나눴다. 이번 단위에서 멈추며 **R00~R06 완료, R07 진행, R08~R10 미완료**를 유지한다.

- `offline-sync-service.ts`는 캔버스 capability·작업 ID·receipt/actor, 편집 권한, AI 보호·revision/잠금, 후보/히스토리/receipt 저장과 응답 순서를 담당한다. 기존 큐 안 현재 인증/프로젝트·lifecycle/capability·만료 처리를 유지하고 권한·사본·저장/envelope·히스토리 조립만 주입한다. 요청 body의 memberId/role을 권한 근거로 쓰지 않는다.
- `offline-changes.ts`의 순수 `planOfflineChanges`가 변경 객체·1~500개 항목·경로·string/null·온라인 전용 파일 제한과 최종 snapshot을 검사한다. 생성/수정/삭제·한글 내용, 최종 파일/크기/ID/참조 검사와 HTML 관리 문서의 workflow-only 예외를 그대로 사용하며 원본 파일이나 부분 batch를 반영하지 않는다.
- 보관된 같은 actor의 receipt는 새 편집 권한/본문 검증보다 먼저 재전송 응답을 반환한다. 다른 actor의 ID 충돌 거부, 현재 파일 revision/잠금·scoped/legacy AI/예약 보호, receipt 500개 한도, no-op batch의 revision/빈 변경 히스토리/receipt 생성도 보존했다. 새 fingerprint·프로토콜·파일 형식·제품 정책을 추가하지 않았다.
- 일반 온라인 명령의 reducer/속성 순번과 오프라인 snapshot 반영의 검사·재전송 순서가 달라 독립 서비스와 순수 준비 함수를 R07 생성 목록에 보완했다. 단순 파일 이동에 그치지 않고 저장 대기/실패·동시 재전송·현재 actor/revision·실제 DB/SSE 경계를 검증했다.

책임과 검증 연결은 `docs/architecture/server-offline-sync.md`다. 시작 서버·계획서·기존 native 검사·이전 구조 문서·전체 git 상태는 `%TEMP%/gamejam-r07-offline-start-fc4233f8c0244545871dad752e0d6ec7`에 보존했다. 이전 AI 수명 단위의 asar·내장 server.mjs·입력/검증 기록은 `out/r07-ai-run-artifact-before-offline/`에 복사했고 이전 asar 해시 일치를 확인했다.

### 35.1 검증 결과

| 검사                                  | 결과                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 오프라인 서비스 회귀             | **18개 통과**. 순수 snapshot 생성/수정/삭제·batch/경로/HTML 범위, 저장 대기·실패/재시도, 동시 receipt/actor 충돌·검사 순서, revision/잠금/AI 보호·대기 중 권한/현재 버전 변경, receipt 한도·no-op                       |
| 실제 SQLite 중단/재개방               | SyncStore와 RAISE(ABORT)로 파일/blob·히스토리·receipt와 현재 상태 보존, 재시도 및 저장소 재개방 뒤 같은 ID 재전송 통과. 직접 서비스 검사의 recordChanges/envelope는 주입 port이며 아래 native 검사에서 실제 조립도 확인 |
| 전체 자동 검사                        | **813개 통과, 실패/건너뜀 0**. 기존 offline/client 초안·네트워크·AI 보호·협업/속성 회귀 포함                                                                                                                            |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                                                               |
| 린트 / 포맷                           | 통과. 기존 AI queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                                                           |
| 편집/동기화 UI                        | 저장 대기 중 최신 한글/포커스·동료 색상 갱신·이미지/체크리스트 DOM·반복 drag·IME, 충돌 초안과 편집기 재개방 통과                                                                                                        |
| Windows package                       | 최종 소스/설정으로 **1회** 생성. 아래 **2개 검사**를 동일 결과물로 순차 실행하고 검증 전후 입력 지문 일치 확인                                                                                                          |
| 같은 package 공동 연결/오프라인 UI    | 실제 UI/IPC·내장 Node/서버 생성/참여/복구/연결 종료·초대/역할, 오프라인 홈 편집·충돌 선택 UI·초안 백업·기존 로컬 복귀 통과                                                                                              |
| 같은 package 실제 offline route       | 신규 native 회귀로 실제 `offline-sync`의 SQLite 저장을 중단. DB/blob·현재 파일·히스토리·receipt 롤백, 성공 SSE 미발행, 같은 ID 재시도/재전송 1회 반영, 다른 actor ID/역할 위조·stale revision 거부·한글 문서 보존 통과  |
| 같은 package 서버/SSE                 | 기존 프로젝트별 동시 명령·receipt/actor/역할 검사, 명령 SQLite 중단 롤백/재시도와 SSE 격리·재연결·권한 회수도 유지                                                                                                      |
| 보존 / 감사                           | 최초 기준 **69개**와 이번 시작 dirty/new **432개** 모두 존재. 준비 runtime과 내장 server.mjs/node.exe의 SHA-256·크기 일치, Windows CRLF를 고려한 diff whitespace 확인                                                   |

새 경계 테스트 18개는 첫 실행부터 모두 통과했다. 초기 lint에서 추출 후 남은 CANVAS_SHEETS_PATH import 경고를 확인해 제거하고 최종 소스로 전체 자동 검사·루트 타입·린트를 다시 확인했다. 초기 lint/unit 로그는 `out/r07-offline-{lint,unit}-initial.log`에 보존했다. contracts/core 입력에는 변경이 없어 통과 결과를 재사용했다. 기존 assertion 삭제·약화나 timeout 완화는 없었고 제품 package는 한 번만 생성했다. 기존 Vite 모듈 외부화·gray-matter eval·Node MODULE_TYPELESS_PACKAGE_JSON 알림을 해결했다고 주장하지 않는다.

최종 입력 지문 `4642caaf12481280c6a39a97f986bb70af2cb309b68166c14cb8fdacf897aff1`. EXE SHA-256 `be9c233cf6059c272632823aeb2ca63ad2e90c1d08a0c78b7bc137e5e93bde40`(245,869,568바이트), app.asar SHA-256 `9971ee47806b97ce9385ec3ac168773517e638993b3f69e310256f82fd4a2259`(8,058,602바이트). 입력/결과물은 `out/refactoring-package-{inputs,verification}-r07-offline-2026-10-21.json`, 종합 기록은 `out/r07-offline-verification.json`, 로그는 `out/r07-offline-*.log`다. 현재 동기화 UI 캡처 `out/sync-ui/sync-ui.png`도 확인했다. 이 단위의 native 회귀는 공동 연결과 서버/SSE 두 가지이며 AI/multiplayer native 전체를 다시 실행했다고 주장하지 않는다.

다음 작은 단위는 **히스토리 조회·undo/redo·복원 서비스 분리**다. 프로젝트 수명·휴지통과 나머지 route/bootstrap도 R07에 남아 있다. SQLite commit 뒤 lifecycle/runtime/checkpoint 파일 실패 구분과 repository/migration은 R08에 남으며, 모든 persist 오류의 원자적 복구를 새로 보장하지 않는다. SQLite trigger 중단은 물리 디스크 장애·전원 차단 검증이 아니다.

모든 검사는 임시 데이터·격리 프로필·임의 로컬 포트로 수행했다. 이 단위에서 실제 AI 계정이나 mock CLI를 새로 실행하지 않았고 AI 보호는 fixture 임대·기존 자동 회귀로 검증했다. 외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 데이터 이전은 미검증이다. 운영 서버/터널·사용자 프로젝트를 변경하지 않았고 reset/revert/commit/make/release/게시/운영 배포는 수행하지 않았다. 개인 무료 로컬 사용·PC CLI 실행·기존 PC 협업 기능을 유지하며 R08~R10과 F01~F04는 이번 단위에서 구현하지 않았다.

## 36. R07 요청 1 — 히스토리 조회·undo/redo·복원 서비스

2026-10-22. 사용자가 남은 작업 목록의 1·2번을 함께 요청하여 히스토리 단위를 먼저 구현하고 경계 테스트를 확인한 뒤 37절의 수명 단위로 진행했다. 두 단위는 최종 소스에서 함께 전체 검사·실제 패키지를 검증했다. R07 전체 완료는 아니다.

- `history-query.ts`는 최신순 목록·변경 전후 파일 읽기와 기존 AI 지시서 snapshot/legacy fallback을 유지한다. `history-restoration.ts`는 섹션·이미지·불러온 HTML의 묶음 복원 제한과 결과 경로 재연결·snapshot 검증을 순수 계산으로 분리한다.
- `history-service.ts`는 본인의 user 편집 undo/redo, 편집 권한→receipt 검사 순서·actor 충돌·잠금·AI 보호와 후보 기록/저장·응답을 조정한다. 다른 속성을 보존하는 inverse merge, receipt 500개 한도와 기존 오류/파일 형식을 유지한다.
- 관리자의 복원은 전체 잠금 해제·현재 프로젝트 revision·completed 기록을 확인한다. 저장→checkpoint→응답 순서를 유지하며, checkpoint 실패가 이미 저장된 결과를 되돌리지 않는 현재 동작과 오래된 revision의 재요청 거부를 검사했다. commit 이후 오류 구분은 R08이다.
- 필요한 권한/잠금/AI 검증·사본/히스토리·저장/checkpoint/envelope만 주입한다. 현재 인증·공통 lifecycle/capability·임대 만료·FIFO 큐 위치는 바꾸지 않았고 서비스가 큐를 다시 획득하지 않는다.

새 회귀 `tests/server-history.test.mjs` **14개 통과**. 조회/순수 준비·본인 권한/receipt·잠금·동시 다른 속성 보존·묶음 복원·AI 보호·저장 대기·현재 revision/role 재검증과 actual SyncStore/SQLite abort를 확인했다. 실패한 undo/restore가 DB/blob·현재 파일·히스토리/receipt·checkpoint 호출을 남기지 않고 재시도·재개방하는 검증이다. 직접 서비스 검사의 recordChanges/envelope는 주입 port이며 실제 조립은 아래 package 검사로 구분했다.

최종 `collaboration-session-packaged`는 실제 Windows 앱/내장 Node·서버에서 문서 변경, history 읽기, undo/redo, 히스토리 패널의 변경 전 선택→파일 복원→확인 버튼, 패널 재개방 후 restore 기록과 서버 재시작 후 내용 보존을 확인했다. 재연결 안내를 정상 확인한 뒤 UI를 조작하도록 fixture를 정리하고 최종 캡처를 남겼다. 책임/검증 연결은 `docs/architecture/server-history.md`다.

## 37. R07 요청 2 — 프로젝트 수명·휴지통 서비스

2026-10-22. 히스토리 경계 검사 다음에 기존 프로젝트 수명/휴지통 정책과 파일 작업을 분리했다. **요청한 1·2번 단위 완료, R00~R06 완료, R07 진행, R08~R10 미완료**다.

- `lifecycle-policy.ts`가 active/version 0 기본값과 수명 조회·PROJECT_TRASHED/PROJECT_PURGED의 410·미존재 404 계약을 제공한다. 기존 ingress/프로젝트 서비스에서 같은 정책을 사용한다.
- `lifecycle-service.ts`는 관리자·이름/버전/팀 확인·AI 중지, checkpoint 대기·trashing/trashed·restoring/active·purging/tombstone 처리와 유지보수를 담당한다. 기존 7일 보관, 복구 시 revision/lifecycle version 증가·초대 만료, 잠금/presence·SSE 정리 순서를 보존한다.
- `project-retention.ts`는 원래의 프로젝트 ID·trash ID 검사와 statDirectory/moveChecked/purgeChecked를 유지한다. 경로 탈출·symlink/junction·정체성 교체·목적지 덮어쓰기 보호를 제거하지 않는다. 전체 폴더와 숨김/미등록 파일을 보존한다.
- 실제 코드에서 유지보수가 큐 대기 전 프로젝트 객체를 계속 사용하던 부분을 확인했다. 큐 안에서 현재 프로젝트를 다시 읽고 lifecycle을 확인하도록 보완했다. 이미 active로 교체되거나 제거된 프로젝트에 오래된 이동/삭제를 수행하지 않는 경계 테스트를 추가했다.
- 수명은 영속 중간 단계와 파일 이동/삭제를 조합한다. 저장 실패 시 기존 현재 객체의 단계 상태 변경을 그대로 유지하며, 전체 작업의 원자적 롤백이나 DB commit 이후 marker 실패의 완전한 처리를 새로 보장하지 않는다. 저장소/commit 오류 구분은 R08에 남긴다.

새 `tests/server-lifecycle.test.mjs` **12개 통과**. 실제 임시 디렉터리와 checked 파일 함수로 권한/이름/버전/확인/AI·checkpoint 대기·파일 보존·재전송·복구/만료·tombstone port 기록·폴더 교체/junction/경로 차단·trashing/restoring/purging 재개·큐 뒤 현재 상태를 확인했다. 저장 단계/marker는 주입 port이며 기존 서버 통합 휴지통 테스트와 내장 번들 검사로 실제 조립을 별도 확인했다.

### 37.1 두 요청 단위의 최종 검증

| 검사                                  | 결과                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 서비스 경계                      | 히스토리 **14개**, 수명/휴지통 **12개**, 총 **26개 통과**                                                                                                                               |
| 전체 자동 검사                        | **839개 통과, 실패/건너뜀 0**. 기존 history·AI/예약·offline·휴지통/재시작·네트워크 회귀 포함                                                                                            |
| 타입 / strict contracts / strict core | 모두 통과. 마지막 소스 보완 후 영향 있는 루트 타입/전체 자동 검사/린트를 갱신                                                                                                           |
| 린트 / 포맷                           | 통과. 기존 queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지. 최종 기록 문서는 별도 포맷 확인                                                                              |
| 최종 package 공동 연결/히스토리       | 실제 Windows 앱·내장 서버의 history 읽기·undo/redo·실제 복원 확인 UI·패널 재개방/재시작 보존, 기존 연결/복구/오프라인 충돌 UI/초안 보존 통과                                            |
| 최종 내장 서버 수명                   | 휴지통 이동 후 재시작·접근 차단 유지·복원 파일/version, 다시 휴지통/완전 삭제 후 재시작·checkpoint 부활 거부 통과                                                                       |
| 같은 package 휴지통 UI                | 확인/취소·전체 이동·숨김 파일/초안 복구·이름 확인 영구 삭제·팀 삭제/복원·공동 로컬 사본 복구 통과. 이 UI suite의 팀 backend는 소스 서버이며, 내장 번들은 위 공동 연결 suite로 별도 확인 |
| 같은 package 서버/SSE                 | 기존 프로젝트 큐·receipt/actor/role, 실제 SQLite command/offline abort 롤백·알림 미발행/재시도, SSE 격리/재연결/권한 회수 통과                                                          |
| 보존 / 감사                           | 최초 기준 **69개** 및 이번 시작 dirty/new **436개** 모두 존재. 이전 asar 보존/해시 확인, 준비/내장 server.mjs·node.exe 해시·크기 일치와 Windows CRLF diff whitespace 확인               |

초기 휴지통 checkpoint 대기 테스트는 setImmediate만으로 파일 I/O 완료를 가정해 1건 실패했다. checkpoint 진입 신호를 명시적으로 기다리도록 수정했고 assertion/timeout을 약화하지 않았다. `out/r07-lifecycle-boundary-first.log`에 보존했다. 최종 경로 비교 검토에서 프로젝트 ID 검사도 원래대로 유지하도록 보완하고 관련 테스트·전체 검사·결과물을 갱신했다.

초기 package가 백그라운드로 넘어간 뒤 native 검사를 먼저 실행한 실수로 dxcompiler.dll 잠금/EPERM 실패가 발생했다. 겹친 검사 결과는 최종 증거에서 제외하고 실패/overlap 로그를 보존했다. 패키징 시도는 총 **3회(실패 1회, 성공 2회)**다. 첫 성공 결과물은 마지막 ID 검사 보완 이전 소스이므로 대체했으며, **마지막 소스는 1회 빌드하고 완료 확인 후 동일 결과물로 최종 3개 suite를 순서대로 검증했다.**

기존 휴지통 package 검사의 버전 기대값 0.15.0은 현재 package.json 버전과 엄격 비교하도록 수정했다. 휴지통 버튼 선택자의 앞 공백도 trim 처리했고, 기존 기능 assertion을 삭제/완화하지 않았다. 초기 실패는 `out/r07-history-lifecycle-trash-package-{initial,selector-initial}.log`에 보존했다. Native fixture 보완은 테스트 파일만 변경했으며 제품을 재빌드할 사유로 삼지 않았다. 최종 시각 확인 후 재연결 안내 확인과 복원 기록 재개방 검사도 강화했다. 기존 MODULE_TYPELESS_PACKAGE_JSON·gray-matter eval 알림을 해결했다고 주장하지 않는다.

최종 입력 지문 `49c946fb9d42e8bf251d8370b31293ef6a91ad20517446145e0fb3ecf0eec5be`. EXE SHA-256 `3ff6509fa147f7c5a3d10237e87987fe0fc0e1cc5773a3360be064f190d875de`(245,869,568바이트), app.asar SHA-256 `86819e7ea8dcb159c3da2758a46defc30984d3345c0f8ac8f92a3b7b988bffd3`(8,059,943바이트). 입력/결과물은 `out/refactoring-package-{inputs,verification}-r07-history-lifecycle-2026-10-22.json`, 종합 기록은 `out/r07-history-lifecycle-verification.json`, 로그는 `out/r07-history-lifecycle-*.log`다. 캡처는 `out/r07-history-lifecycle/history-restored.png`, `out/qa/trash-server-retained.png`다.

시작 사본은 `%TEMP%/gamejam-r07-history-lifecycle-start-17781a4b04754ee596e7c7d79a921a99`, 이전 검증 결과물은 `out/r07-offline-artifact-before-history-lifecycle/`에 보존했다. 구조/검증 설명은 `docs/architecture/server-history.md`와 `docs/architecture/server-lifecycle.md`다.

다음은 남은 작업 목록의 **3번: 상태 조회·편집 잠금·응답 조립 분리**다. 4번 나머지 route/bootstrap과 R08~R10도 남는다. 실제 AI 계정·외부 Discord·다른 PC/외부망·Linux/Render·S3/운영 자료 이전은 미검증이며, SQLite/phase 주입과 프로세스 재시작을 물리 디스크 장애/전원 차단 검증으로 안내하지 않는다. 개인 무료 로컬·PC CLI·기존 PC 협업을 유지했고 운영 서버/터널·사용자 자료를 변경하지 않았다. reset/revert/commit/make/release/게시/운영 배포·유료 자원 생성과 F01~F04 구현은 수행하지 않았다.

## 38. R07 요청 3 — 상태 조회·편집 잠금·응답 조립

2026-10-22. 사용자가 요청한 남은 목록의 3·4번 중 첫 단위다. 이전 37절의 다음 작업을 이어 구현했다.

- `server/services/state-service.ts`가 state/lock/unlock을 처리한다. 권한·AI 잠금·프로젝트 잠금·envelope·시계/token·알림을 주입하며 HTTP나 저장소 없이 검증한다. 호출자는 큐 안에서 현재 인증/수명/기능 지원을 검사한다.
- `project-envelope.ts`가 기존 전체 응답/capabilities/state를 조립한다. 삭제 참여자·인증 비밀·예약 baseline을 제외하고, presence와 관리자 초대 만료 조회를 유지한다.
- `project-response.ts`가 기존 v1 delta와 그림 변경분을 조립한다. 현재 committed 내용/삭제·revision·속성·작성자를 사용하고, 히스토리 첫 revision이 끊기거나 입력이 유효하지 않으면 기존 전체 응답으로 복구한다. metadataOnly 우선과 같은 revision 생략 규칙을 유지한다.
- 30초 lease와 소유자/token 갱신, 재진입 token 재사용, task 관리자/sections/Markdown/AI 검사 순서, no-op unlock 알림과 엄격한 만료 비교를 보존했다. 새 영속 잠금이나 프로토콜을 도입하지 않았다.

`tests/server-state.test.mjs` **9개 통과**. 비밀/예약 제외·presence·조회 우선순위·잘못된 갱신 입력·소유권/token·시계/재진입·잠금 보호·해제 알림·현재 내용/삭제 delta·fallback을 검사했다. 초기 fixture가 시각 1,000ms에서 기존 presence 기본값 판정을 잘못 가정해 실패했다. fixture 시각을 20,000ms로 정리했고 제품 정책/assertion을 약화하지 않았다. 실패 로그는 `out/r07-state-boundary-initial.log`다. 책임 설명은 `docs/architecture/server-state.md`다.

## 39. R07 요청 4 — HTTP 경로·서버 조립·전송 adapter 및 완료 검사

2026-10-22. **요청한 3·4번 완료, R00~R07 완료, R08~R10 미완료**다. 이번 요청 범위는 R07 마무리이며 R08 구현은 시작하지 않았다.

- `collaboration-server.ts`는 기존 createCollaborationServer/activeEvent·type export의 호환 진입점으로 유지한다. `server/bootstrap.ts`가 기능 서비스·HTTP/WS·종료를 연결한다. 기존 options와 server/port/close 형태, PC 협업 서버 진입점/번들 경로는 보존했다.
- `server/context.ts`가 인스턴스별 프로젝트·잠금·presence·큐를 소유한다. 서비스에는 각 기능에 필요한 port만 제공한다. `project-request.ts`가 큐 안의 현재 프로젝트/actor 재조회와 수명·버전·AI 만료·기능 gate를 맡고, `project-actions.ts`가 기능 서비스를 선택한다. body의 actor/role을 권한 근거로 사용하지 않는다.
- health/events 외 projects/members/commands/history/approvals/ai/multiplayer route를 구현했다. 공통 프로젝트 HTTP adapter는 ingress 한도→현재 인증→참여자 한도→body→큐 안 재인증→응답 순서를 유지한다. 생성/join/recover의 key-before-body, 알 수 없는 작업·method·Origin 처리, multiplayer의 별도 진단/오류 계약도 보존했다.
- `project-capabilities.ts`는 기존 검사 순서/예외 목록을 유지한다. `project-history-writer.ts`는 후보 이력·revision·속성·작성자를 만들고 clock/id를 주입받는다. workflow 검증과 기존 이력 제한을 보존한다. 공통 clone/digest/승인 연산은 `project-operations.ts`에 둔다.
- `rate-limit.ts`는 기존 category/identity·시각별 한도를 유지하며 X-Forwarded-For를 신뢰하지 않는다. `lifetime.ts`는 timer/listen/timeout과 멀티플레이/SSE→진단→HTTP→큐 drain→checkpoint→store close 순서를 소유한다. 서로 다른 서버 인스턴스가 가변 상태를 공유하지 않는다.
- `adapters/http/collaboration-transport.ts`에 fetch/signal을 주입했다. CollaborationClient의 공개 API·세션/오프라인·재시도 흐름과 POST/auth/key/12초 timeout·429·JSON/5xx·도메인 failure/lifecycle·history-read string/null 응답을 유지한다.

계획의 파일명/서비스 목록은 실제 기능 경계에 맞춰 보완했다. R07의 저장소 주입은 기존 서비스 port까지 완료했으며, SQLite 시작 복원/persist/checkpoint/export/marker 구현은 bootstrap에 남겨 **R08의 repository/persistence 추출**로 진행한다. commit 이후 파일 오류를 새로 보장했다고 처리하지 않는다. R07 항목 8의 운영 모드별 rate limit 보완은 기존 정책 보존 원칙에 따라 프록시·readiness/draining과 함께 R10에서 검증한다. 기존 Origin 차단이나 사용자 IP 신뢰 정책을 여기서 바꾸지 않는다. 구조 설명은 `docs/architecture/server-assembly.md`다.

### 39.1 최종 검증

| 검사                                  | 결과                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 경계 검사                        | 상태 9개, 조립/수명/현재 인증 7개, 실제 임시 HTTP route 4개, fake fetch 전송 5개: **25개 통과**                                                                                 |
| 전체 자동 검사                        | **864개 통과, 실패/건너뜀 0**. 기존 명령/권한/receipt·저장 실패 재시도·AI·오프라인·히스토리·휴지통·멀티플레이 포함                                                              |
| 타입 / strict contracts / strict core | 모두 통과                                                                                                                                                                       |
| 린트 / 포맷                           | 통과, 기존 queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지                                                                                                       |
| package 공동 연결                     | 최종 Windows 앱/내장 Node·서버의 생성/join/recover/leave·초대/role·오프라인 충돌/초안 backup·히스토리 읽기/undo/redo/복원 UI·재시작, 내장 서버 휴지통/복구/purge/tombstone 통과 |
| package 서버/SSE                      | 두 프로젝트 큐·중복 receipt/actor·권한 회수, 실제 SQLite command/offline abort의 무성공 알림·롤백·같은 ID 재시도와 SSE 격리/재연결 통과                                         |
| package 승인/AI 예약                  | 독립 관리자/팀 앱·실제 승인 UI·mock CLI 실행/HTML 게시·권한/재시작, 개인/공동 예약·잠금·취소/자동 실행 통과                                                                     |
| package 멀티플레이                    | 실제 Windows 앱 4개 격리 사용자·IPC/preload·고정 게임·ready/start·native 입력·host leave 통과. text generation 모드는 실행하지 않음                                             |
| package 휴지통 UI                     | 취소/이동·전체 폴더/숨김 파일/초안 복구·이름 확인 영구 삭제·팀 삭제/복원·로컬 사본 복구 통과. 팀 backend는 소스 서버이며 내장 번들은 공동 연결 suite로 별도 검증                |
| 결과물/보존                           | 최종 소스 **package 1회**, 완료 후 같은 결과물로 **6개 suite 순차 통과**. 준비/내장 server.mjs·node.exe 해시/크기 일치, 시작 dirty/new **447개**와 최초 기준 **69개** 모두 존재 |

초기 타입 검사에서 이동한 helper의 상대 import/type 참조와 AI action union을 보완했다. 초기 실패는 `out/r07-assembly-typecheck-initial.log`에 보존했다. 최종 소스의 전체 자동/타입/린트 통과 후 제품 소스를 변경하지 않았으며, 이후 문서만 갱신했다. 기존 MODULE_TYPELESS_PACKAGE_JSON·gray-matter eval 알림은 남아 있다. 테스트를 삭제하거나 기능 assertion/timeout을 약화하지 않았다.

최종 입력 지문 `eda343b2306417322d5b3201e009c026a8968c77a4d9d3579ddf0e2180c85380`. EXE SHA-256 `ca8d01d226496ed25c5f93b4db704516acc25db16edeee75d2bac12d0859468a`(245,869,568바이트), app.asar SHA-256 `557e7224ec68f2336213e23e50d2d6e8fd51076e41273c5a3c0f26d343be1cec`(8,062,626바이트). 입력/결과물은 `out/refactoring-package-{inputs,verification}-r07-assembly-2026-10-22.json`, 종합 기록은 `out/r07-assembly-verification.json`, 검사 로그는 `out/r07-assembly-*.log`다. 시각 확인은 `out/r07-history-lifecycle/history-restored.png`, `out/gamejam-approval/packaged-team-completed.png`, `out/qa/trash-server-retained.png`다.

시작 원본/status 사본은 `%TEMP%/gamejam-r07-assembly-start-0cc1fdae6c2e440e9d20d0426e1e5f2a`, 이전 asar/서버/입력·검증 기록은 `out/r07-history-lifecycle-artifact-before-assembly/`에 보존하고 기존 asar 해시를 확인했다. Windows CRLF를 고려한 diff whitespace와 최종 기록 문서 포맷도 검사한다.

다음은 **R08: 저장소 port/SQLite adapter·스키마 migration·checkpoint/lifecycle 저장 책임과 commit 이후 오류 분리**다. 이후 R09 백업/복원, R10 Render 배포 준비 순서로 진행한다. AI는 mock CLI이며 실제 계정·외부 Discord·다른 PC/외부망·Linux/Render/S3·운영 자료 이전은 미검증이다. SQLite trigger/재시작은 물리 디스크 장애/전원 차단 검증이 아니다. 개인 무료 로컬·PC CLI·기존 PC 협업·데이터 형식/프로토콜과 사용자 자료를 보존했고 reset/revert/commit/make/release/게시·운영 배포·유료 자원 생성과 F01~F04 구현은 수행하지 않았다.

## 40. R08 — 저장소 port·SQLite adapter·복구 파일 책임 및 완료 검사

2026-10-22. **R00~R08 완료, R09~R10 미완료**다. 이번 요청은 남은 목록의 1번인 R08이며 R09 백업/외부 저장소 구현이나 운영 자료 이전은 시작하지 않았다.

### 40.1 구현

- application/ports/collaboration-project-repository.ts에 비동기 loadAll/load/commit/tombstone/tombstones/purge/close 계약을 만들었다. 프로젝트 큐를 대체하지 않는다. tombstones 조회는 기존 동기 404/410 계약을 유지하기 위한 읽기 사본이며 purge commit 뒤에만 갱신한다.
- adapters/sqlite/project-repository.ts에 기존 FULL WAL 트랜잭션과 blobs/projects/project_tombstones·프로젝트 JSON 형식을 유지했다. 파일·히스토리·receipt를 함께 commit한다. tombstone 검사는 쓰기 트랜잭션 안에서 수행해 완전 삭제한 ID의 재저장을 거절한다. rollback 후 hash 캐시를 비워 같은 요청의 재시도에서 blob이 누락되지 않게 한다. 현재/이력 blob의 누락과 SHA-256 불일치도 검사한다.
- adapters/sqlite/migrations.ts가 구형 스키마 0을 기존 JSON을 다시 쓰지 않고 version 1로 이행한다. schema_migrations와 user_version을 한 트랜잭션으로 기록한다. migration 실패는 새 테이블/버전까지 rollback하며, 예상보다 새로운 스키마는 journal 설정/테이블 변경 전에 중단하고 연결을 닫는다.
- server/persistence/{project-persistence,checkpoint-store,lifecycle-store}.ts로 DB commit 이후의 현재 프로젝트 공개와 runtime/head/checkpoint/수명 표식 기록·재시도를 분리했다. 파일 export 실패는 이미 저장한 명령을 실패로 되돌리지 않는다. 경고/대기 상태로 남겨 기존 유지 주기 및 종료 시 재시도한다. 같은 프로젝트 runtime/checkpoint와 수명 표식의 순서를 각각 보존한다. 시작 시 DB 활성 자료를 복구 export 대상으로 등록하고, 종료 flush 실패 시에도 DB 연결을 닫는다.
- lifecycle-service는 각 단계의 candidate를 복제해 저장한다. 초기 trash commit 실패는 현재 수명/잠금을 바꾸지 않고, 복원 최종 commit 실패는 저장된 restoring 단계에 남아 재개한다. async purge는 tombstone commit 뒤에만 표식/메모리 제거로 진행한다.
- 웹 게시와 self-host 멤버 확인은 adapter의 읽기 전용 projection을 사용한다. 게시 projection에는 활성 프로젝트의 이름/revision/현재 파일만 포함하며 비공개 이력·세션·초대/복구 정보·개인 AI 인증을 반환하지 않는다. 읽기 전용 조회는 schema 0도 migration 없이 읽는다. sync-store.ts의 기존 동기 SyncStore/readSyncFiles export는 호환 진입점으로 유지한다.
- contracts/server-limits.ts에 기존 이력 300/receipt 500/파일 500/프로젝트 20/참여자 20 및 바이트 한도를 모았다. property-sync 명령은 기존 sequences map에 세션 전체 요청 순번도 저장해, receipt가 제거된 생성/no-op 요청의 중복 적용을 거절한다. 보관 중인 receipt 재생이 먼저이며 commit 실패는 순번을 소비하지 않는다. 기존 revision/객체별 순번·기능 gate도 유지한다. 모든 과거 클라이언트의 요청을 보관 기간 밖까지 무제한 중복 제거한다고 안내하지 않는다.

책임과 검사 연결은 docs/architecture/server-persistence.md에 기록했다. PostgreSQL 전환, 새로운 프로토콜, 사용자 데이터 형식 변경과 캐시 정책 변경은 포함하지 않았다.

### 40.2 검증

| 검사                              | 결과                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신규 저장소/복구 경계             | 14개 통과. 인공 schema 0의 무변경 읽기/이행/수정/재시작, migration/commit/purge rollback, 두 연결과 프로젝트 큐, 현재/이력 blob 손상·누락, 비공개 projection, export/표식 실패 재시도와 순서, tombstone 보호                                             |
| receipt 보관 한도                 | 실제 501회 commit으로 생성 receipt 제거를 확인하고, 과거 순번의 생성 요청을 재시작 전후 모두 거절. 기존 scoped sequence 및 offline revision 검사 유지                                                                                                    |
| 수명 실패 경계                    | 초기 trash 저장 실패의 현재 객체/잠금 보존, 복원 최종 저장 실패의 restoring 재개, async purge 완료 순서 3개 추가 통과                                                                                                                                    |
| 전체 자동 검사                    | **882개 통과, 실패/건너뜀 0**. 기존 864개+신규 18개                                                                                                                                                                                                      |
| 타입/strict contracts/strict core | 모두 통과                                                                                                                                                                                                                                                |
| 린트/포맷                         | 통과. 기존 AI queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지                                                                                                                                                                             |
| R08 전용 실제 서버                | 소스와 최종 package 내장 Node/server 모두 schema 0 이행, 실제 post-commit runtime/checkpoint 오류의 성공 응답·같은 ID 재생·강제 프로세스 재시작, 수명 표식 오류 중 trash/restore/purge, 구형 체크포인트 재등장 차단, 미래 schema의 무변경 시작 실패 통과 |
| package 서버/SSE                  | 두 프로젝트 큐·receipt/actor·권한, 실제 SQLite command/offline abort rollback·무성공 알림·같은 ID 재시도, SSE 격리/재연결 통과                                                                                                                           |
| package 공동 연결/히스토리        | 실제 앱/내장 서버의 생성/join/recover/leave·초대/role·오프라인 충돌/초안 backup·히스토리 읽기/undo/redo/복원 확인 UI·재시작, 내장 서버 휴지통/복구/purge/tombstone 통과                                                                                  |
| package 휴지통 UI                 | 취소·전체 폴더/숨김 파일/초안 복구·이름 확인 영구 삭제·팀 삭제/복원·로컬 사본 복구 통과. 팀 backend는 소스 서버이며 내장 번들은 위 공동 연결 suite로 별도 확인                                                                                           |
| package 승인/AI 예약              | 독립 관리자/팀 앱·실제 승인 UI·mock CLI 실행/HTML 게시·권한/재시작, 개인/공동 예약·잠금·취소/자동 실행 통과                                                                                                                                              |
| package 멀티플레이                | 실제 앱 4개 격리 사용자·IPC/preload·고정 게임·ready/start·native 입력·host leave 통과. text generation 모드는 실행하지 않음                                                                                                                              |
| 결과물                            | 최종 제품 소스 package **1회**, 동일 결과물로 R08 전용 검사와 기존 **6개 suite 순차 통과**. 빌드 전후 입력 지문 일치, 준비/내장 server.mjs·node.exe·라이선스의 해시/크기 일치, 시작 시 dirty/new 파일 **474개** 모두 존재                                |

초기 신규 경계 검사에서 helper 이동 중 return 줄바꿈과 검사 cleanup 순서를 바로잡았다. 전체 검사에서는 self-host 인공 fixture에 실제 저장 자료의 id가 빠져 있음을 확인해 필드를 보완했다. package 서버 검사에서는 이전 순번을 새 ID에 재사용하던 입력을 신규 요청의 다음 순번(2/3)으로 고쳤다. 지원하지 않는 명령의 거절, 실제 SQLite 실패 주입, 같은 ID 재시도 및 권한 단언은 유지했다. 초기 실패는 out/r08-\*-initial.log, out/r08-lifecycle-receipts.log와 out/r08-server-events-packaged-initial.log에 보존한다. 제품 assertion/timeout을 약화하거나 검사를 삭제하지 않았다.

입력 지문은 af6fb2886a260b63473fa2a44e2eadb9ca324991cd62fc76eca4449e2d5a27d7이다. EXE SHA-256은 b8787bcbafad7cb23fdf2498c2d7d0f545f40c1fc07342b8e35511cda79e86e8(245,869,568바이트), app.asar는 91da9097bbf4e00bc09a0d1bca110a622832c43e57d557de4c8a5bcc803285a6(8,068,216바이트)이다. out/refactoring-package-{inputs,verification}-r08-2026-10-22.json에 입력/크기/해시를 기록했다. 패키지 생성 후 제품 소스/빌드 설정을 바꾸지 않았으며, 이후 변경은 문서와 package 검사의 순번 fixture다.

검사 로그는 out/r08-\*.log, suite 결과는 out/r08-package-suites.json 및 out/r08-package-runtime.json이다. 최종 UI 캡처 out/r07-history-lifecycle/history-restored.png, out/gamejam-approval/packaged-team-completed.png, out/qa/trash-server-retained.png를 직접 확인했다. 시작 원본/status/binary diff는 %TEMP%/gamejam-r08-start-cJ9P66, 이전 asar/서버/검증 기록은 out/r08-before-artifact에 보존했다. 기존 MODULE_TYPELESS_PACKAGE_JSON·gray-matter eval 안내는 남아 있다.

### 40.3 저장 성능과 후속 최적화

인공 프로젝트 20개, 각 현재 파일 8개·이력 300개·본문 payload 4KiB, 이후 한 프로젝트에 600회 추가 저장을 측정했다. Windows x64/Node 24.19.0, warm filesystem cache와 같은 프로세스에서 측정한 한 번의 관찰값이며 운영 성능 보장이 아니다. 배포 단계별 시간 측정을 추가한 것이 아니다.

| 항목                          | 관찰값                                              |
| ----------------------------- | --------------------------------------------------- |
| repository 열기+전체 로드     | 267.64ms                                            |
| 실제 서버 시작/listen         | 299.67ms                                            |
| 저장 median/p95/max           | 2.33 / 4.14 / 17.09ms                               |
| DB 크기 (정상 close 후)       | 32,632,832바이트                                    |
| RSS: 로드 전/후/추가 저장 후  | 149,655,552 / 197,275,648 / 290,824,192바이트       |
| heap: 로드 전/후/추가 저장 후 | 21,970,952 / 74,871,368 / 76,173,264바이트          |
| 본문 hash 캐시                | 6,020개·24,929,630바이트 → 6,620개·27,414,230바이트 |

재현 도구는 scripts/measure-collaboration-storage.mjs, 원본은 out/r08-storage-measurement.{json,log}다. 이력이 300개로 유지돼도 새 본문 600개가 캐시에 계속 남는 증가를 확인했다. **후속 성능 변경에서 bounded cache/참조 없는 blob 정리 정책을 우선 검증하고 lazy loading·이력 조회 분리는 별도 측정 후 적용한다.** R08에서 성급하게 캐시 정책이나 저장 포맷을 변경하지 않았다. RSS는 GC/allocator/SQLite의 영향도 포함하므로 증가 전체를 hash 캐시 때문이라고 단정하지 않는다.

다음 기본 작업은 **R09: 백업·복원·Windows→Linux 이전**이다. 이후 R10의 Linux/Render 배포 준비를 진행한다. 실제 AI 계정·외부 Discord·다른 PC/외부망·Linux/Render/S3·운영 자료 이전은 미검증이며, 인공 SQLite 오류/프로세스 종료를 물리 디스크 장애·전원 차단 검증으로 안내하지 않는다. 개인 무료 로컬·PC CLI·기존 PC 협업·사용자 자료를 보존했고 운영 서버/터널·실제 계정을 변경하지 않았다. commit/make/release/게시·운영 배포·유료 자원 생성과 F01~F04 구현은 수행하지 않았다.

## 41. R09 — 백업·복원·호스트 이전 구현 및 Windows 검증

2026-10-22. **R00~R08 완료, R09 구현/Windows 로컬 검증 완료·외부 복구 실증 대기, R10 미완료**다. 사용자에게 실제 비공개 S3 저장소와 Linux 환경의 부재를 알렸으며, 사용자는 '아직 없음 — 구현 후 외부 검증 항목을 남겨주세요'를 선택했다. 같은 디스크나 로컬 TLS fixture로 R09의 외부 복구 완료 조건을 대체하지 않는다.

### 41.1 구현 경계

- application/ports/backup-target.ts와 adapters/backup/{local-target,s3-target}.ts로 immutable object put/get/list/remove를 제공한다. S3는 명시적 endpoint/bucket/region/자격 증명만 사용하고 AWS SDK의 서명과 조건부 PUT으로 업로드한다. SHA-256/크기를 대조하고 SHA-256 응답이 없으면 전체 GET으로 검증한다. ETag/자체 metadata만으로 성공 처리하지 않는다. bucket/유료 자원을 생성하지 않는다.
- server/operations/maintenance.ts가 새 영속 요청을 HTTP 503/SERVER_MAINTENANCE/Retry-After로 거절하고 이미 받은 요청·큐·checkpoint/lifecycle 작업을 기다린 뒤 한 세대를 캡처한다. state도 AI 만료를 저장할 수 있어 gate 안에 둔다. 기본 정리 대기 한도는 15초이며 실패/시간 초과에서 gate를 해제한다. archive 검증/업로드는 쓰기 재개 후 실행한다.
- writer-lock.ts의 SQLite sidecar 트랜잭션으로 서버/중지 상태 CLI/복원/이전의 동시 writer를 차단한다. 프로세스 강제 종료 후 OS가 잠금을 해제한다. 오래된 PID 파일 삭제나 잠금 우회 옵션을 만들지 않았다. spool도 writer lease로 분리한다.
- BackupService는 현재 SQLite 연결의 node:sqlite.backup으로 일관된 DB를 캡처한다. 중지 상태 CLI는 읽기 전용 연결을 사용하므로 schema 0 원본을 백업하며 migration하지 않는다. 복구 파일·lifecycle·trash와 manifest를 함께 검증하고 임시 archive를 완료 이름으로 rename한다. source/spool/local target 분리, 디스크 여유, 경로/링크/중복/크기를 검사한다.
- .gjbackup은 버전이 있는 스트리밍 컨테이너이며 payload 4GiB/manifest 16MiB/파일+폴더 100,000개 한도를 둔다. 압축/multipart를 구현했다고 주장하지 않는다. 최신 공개 head의 checkpoint만 캡처하고 미완료 export·임시 파일·purge한 자료의 오래된 export는 수집하지 않는다. 등록되지 않은 파일은 중단하여 호스트/개인 CLI 인증을 업로드하지 않는다. 첫 checkpoint가 없더라도 DB-only 자료는 복구한다.
- restore.ts는 빈 staging에서 원본 archive/파일 SHA와 SQLite integrity/blob/프로젝트/revision/수명/tombstone을 먼저 확인한다. 검증한 새 폴더의 lifecycle identity만 재등록하고 원본 증거·변환 전후 identity·목적지 해시를 .restore-report.json에 따로 남긴다. .restore-in-progress 표식은 실패 시 남아 일반 서버 시작을 차단한다. 원본이나 실패 staging을 자동 삭제하지 않는다.
- 중단된 trashing/restoring/purging은 기존 서버 유지 흐름으로 재개한다. 실행 중 AI lease는 기존 고아 실행 실패 정책을 따르며 같은 run을 재실행하지 않는다. 대기 예약과 run ID는 유지한다. 클라이언트의 재시도 가능한 heartbeat 실패에서는 lease를 보존하도록 보완했고 짧은 snapshot 뒤 같은 lease로 재개하는 회귀 검사를 추가했다. 서버의 기존 만료 정책은 유지한다.
- migrate-host.ts는 공유 파일 시스템에서 최종 백업/원본 frozen→대상 staged→격리 검사→원본 retired→대상 active 또는 활성화 전 취소를 제공한다. transfer-host.ts는 공유 경로 없이 Windows→Linux 등 다른 호스트로 옮길 수 있도록 원본 동결과 별도 인계 기록/백업 지문 대조, 대상 staging/검증/활성화를 제공한다. 공유 경로 없는 활성화는 운영자의 원본 동결·세션 검증 확인이 필요하며 원본 동결을 자동 해제하지 않는다. 검사 후 대상 revision/수명이 바뀌면 활성화를 거절한다.
- 서버 환경 설정이 있을 때만 기본 24시간 예약, 외부 완료 7개/로컬 완료 2개 보관을 켠다. 업로드 실패에서도 최신 검증 archive를 남기고 로컬 개수를 제한한다. backup-status.json에 phase·최근 시도/성공·object 지문과 오류 단계 코드를 남긴다. 시스템 시각 변화로 새 object를 정리하지 않는다.
- 종료 시 진행 중 백업을 정리하고, 진단/체크포인트 실패에도 나머지 종료 단계와 DB/writer 해제를 시도하며 첫 오류를 반환한다. close 호출을 합쳐 같은 종료를 두 번 실행하지 않는다.

운영 명령은 scripts/{backup-collaboration,restore-collaboration,verify-collaboration-backup,migrate-collaboration}.mjs이며, Node 24와 저장소 checkout/의존성이 필요하다. CLI를 설치 앱에 독립 실행 파일로 배포한 것은 아니다. 책임 연결은 docs/architecture/server-backup.md, 운영·복원·양쪽 호스트 이전 명령은 docs/operations/backup-restore.md에 기록했다.

### 41.2 검사

| 검사                              | 결과                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 새 백업/복원·S3 검사              | **25개 통과**. 실제 HTTP의 같은 ID/초안·짧은 유지 gate 중 AI lease 보존, 업로드 중 쓰기, 업로드 실패/보관 개수, DB-only·schema 0, 역할/이력/receipt, writer 충돌/강제 종료, 손상/탈출/중복/링크, 수명 단계/identity, AI 고아·예약, tombstone, 공유/비공유 경로 인계 및 CLI 포함 |
| 종료 실패 회귀                    | 1개 추가 통과. 진단·checkpoint 실패에도 HTTP/큐/store를 모두 정리하고 최초 오류를 유지                                                                                                                                                                                          |
| 전체 자동 검사                    | **908개 통과, 실패/건너뜀 0**. R08의 882개+신규 26개                                                                                                                                                                                                                            |
| 타입/strict contracts/strict core | 모두 통과                                                                                                                                                                                                                                                                       |
| 린트/포맷                         | 통과. 기존 AI queue package 미사용 변수·Discord mock this 별칭 경고 2건 유지                                                                                                                                                                                                    |
| 최종 package R09                  | 내장 Node/server의 실제 예약 루프→격리 TLS S3 프로토콜 업로드/해시/크기 대조→업로드 중 실제 편집→CLI 다운로드/새 폴더 복원→같은 세션·역할·이력/receipt 재생·휴지통 identity·tombstone·고아 AI 실패/예약 유지→수정 후 재시작·원격 내용 손상 거절 통과                            |
| 최종 package R08/서버/SSE         | 구형 DB/실제 post-commit 오류·재시작·미지원 schema 및 SQLite command/offline rollback·무성공 SSE·같은 ID 재시도·큐/actor/권한·SSE 격리/재연결 통과                                                                                                                              |
| 최종 package 공동 연결/히스토리   | 실제 앱/내장 서버 생성/join/recover/leave·초대/role·오프라인 충돌/초안 backup·히스토리 읽기/undo/redo/복원 UI·재시작·서버 휴지통/복구/purge/tombstone 통과                                                                                                                      |
| 최종 package 휴지통 UI            | 취소·전체 폴더/숨김 파일/초안 복구·이름 확인 영구 삭제·팀 삭제/복원·로컬 사본 복구 통과. 이 suite의 팀 backend는 소스 서버이며 내장 서버는 별도 공동 연결/R09 검사로 확인                                                                                                       |
| 최종 package 승인/AI 예약         | 독립 관리자/팀 앱의 실제 승인 UI·mock CLI/HTML 게시·권한/재시작, 개인/공동 예약·잠금·취소·자동 실행 통과                                                                                                                                                                        |
| 최종 package 멀티플레이           | 앱 4개 격리 사용자·IPC/preload·고정 게임·ready/start·native 입력·host leave 통과. text generation 모드는 실행하지 않음                                                                                                                                                          |
| 외부 환경                         | **실제 외부 S3 저장소, Windows→Linux 실제 복원, 운영 데이터/주소 전환은 미검증**. 로컬 TLS S3 fixture와 같은 디스크의 복원 검사는 외부 복구 실증이 아님                                                                                                                         |

처음에는 인공 검사에 없는 setPersistence 메서드/생성 title 인자를 가정한 부분과 capability 입력을 수정했고, purge 후 빈 휴지통 상위 폴더를 백업 대상에서 제외했다. package 검사 도구의 종료 대기에는 이미 signal로 끝난 자식 처리도 추가했다. 생성 명령의 title은 지원 입력이 아니므로 최종 검사는 반환된 실제 경로와 파일 바이트로 업로드 중 수정의 제외/복원 후 수정의 재시작 보존을 대조한다. 마지막에는 유지 503이 클라이언트 lease를 null로 바꾸는 실제 동작을 새 회귀 검사로 재현하고 제품 코드를 수정했다. 원본 단언/시간 한도를 약화하거나 검사를 삭제하지 않았다. 초기 실패와 수정 후 결과는 out/r09-\*-initial.log, out/r09-backup-tests-second.log, out/r09-backup-boundary-current.log, out/r09-ai-heartbeat-{reproduction,fixed}.log, out/r09-backup-packaged-{initial,second,final,verified}.log에 보존했다.

### 41.3 결과물과 남은 조건

최초 구현 package 1회에서 검사를 수행한 뒤, 위 heartbeat 제품 코드 변경 때문에 **최종 소스로 package 1회를 추가**했다. 최종 소스의 결과물은 재생성하지 않고 R09 전용 1개+기존 7개, 총 **8개 suite**에서 재사용했다. 전체 자동/타입/린트도 변경한 최종 소스로 갱신했다. 새 제품 소스 변경 없이 같은 소스를 반복 빌드한 것은 아니다.

최종 입력 지문 d11ed7443068aea0243eb95c3254be4efd7b43b2541d0a31d7bf5bb18d642c28. EXE SHA-256 5dc7ccce6c2d510e6d60267f51e7e4bff4e79e635765be616c2740c7aa945610(245,869,568바이트), app.asar SHA-256 4e08d2537a1e3bbe9e19b6f134ae87a374fbbfb9d43150a9b0cc9b89243d7062(8,091,296바이트), server.mjs SHA-256 9dcc4a9f2816975caa7f6d1325d590bbd045751fed9bc60b213b49a2869bc3ca(1,975,508바이트)다. out/refactoring-package-{inputs,verification}-r09-2026-10-22.json에 입력/크기/해시를 기록했다. 준비/내장 server.mjs·node.exe·Node 라이선스 해시가 일치하고, 시작 시 dirty/new 파일 **489개**가 모두 존재한다. 이후 변경은 문서와 package 검사 fixture뿐이다.

검사 로그는 out/r09-\*.log, package suite 기록은 out/r09-package-suites.json 및 out/r09-package-backup.json이다. 시작 원본/status/binary diff는 %TEMP%/gamejam-r09-start-fwybcX, R08 package는 out/r09-before-artifact, heartbeat 보완 전 package/입력/검증 기록은 out/r09-before-heartbeat-artifact에 보존했다. 최종 package의 히스토리/승인/휴지통 캡처도 유지한다. 기존 MODULE_TYPELESS_PACKAGE_JSON·gray-matter eval 안내와 S3 거절 fixture의 SDK streaming 실패 안내는 검사 성공과 구분한다. AWS SDK 의존성을 설치했으며 설치 도구의 allow-scripts 안내를 이유로 추가 스크립트 승인을 실행하지 않았다.

**R09 전체 완료를 위해 남은 실증:** 실제 비공개 외부 저장소에 저장한 한 세대를 원본 서버/디스크 없이 별도 환경에서 복구하고, 실제 Windows archive의 Linux 복원·권한/이력/재연결·종료/재배포를 확인해야 한다. 실제 계정/엔드포인트·Linux 환경과 보관 정책이 정해지면 진행한다. 백업/복원 1시간 등의 계획 목표를 보장으로 안내하지 않는다. 개발 카드의 다음 단계는 R10이며, R09의 외부 실증 대기는 별도로 유지한다. R08에서 확인한 bounded cache 최적화도 별도 후속 성능 작업이다.

개인 무료 로컬·PC CLI·기존 PC 협업과 사용자 자료를 보존했다. 사용자 실제 AI 계정/외부 Discord/운영 서버·터널을 실행하거나 변경하지 않았고, 물리 디스크 장애/전원 차단을 실증하지 않았다. commit/make/release/게시·운영 배포·유료 자원 생성과 F01~F04 구현은 수행하지 않았다.

## 42. R10 — Linux·Render 운영 준비 구현 및 Windows 검증

2026-10-22. **R00~R08 완료, R09·R10 구현/Windows 검증 완료·실제 외부/실행 환경의 실증 대기**다. 현재 PC에는 Linux 실행 환경이 없고 사용자는 R09에서 실제 외부 저장소 검증을 남기도록 지정했다. Linux CI 파일을 만들었다는 이유로 Linux 성공을 선언하지 않는다. F01~F04는 새로운 제품 기능이므로 이번 리팩토링 마무리에 포함하지 않는다.

### 42.1 구현과 확인한 수정

- `server/config.ts`가 GAME_CANVAS_PORT→PORT→4317 우선순위, host·공개 설정·service mode·종료 상한을 검증한다. self-host 기본값과 기존 공개 서버의 32자 생성 키 검증을 유지한다. managed-beta는 생성 키가 필수이고 managed는 F01 전 시작을 거절한다. 클라이언트의 paid/selfHost 값은 서비스 모드를 변경하지 않는다.
- `/health` wire contract는 유지하고 `/ready`를 추가했다. listen 이전/복구 실패 때 수락 상태를 열지 않고, snapshot/종료 중에는 ready 503이다. 종료 gate는 snapshot finally로 다시 열리지 않는다. 수락한 durable 쓰기와 HTTP 응답을 정리한 뒤 SSE·WS/queue/checkpoint/저장소·writer를 종료한다. 정상 종료 상한은 25초이며 standalone은 상한/정리 실패를 exit 1로 처리한다.
- 명시한 proxy IP/CIDR만 X-Forwarded-For의 오른쪽 hop부터 신뢰한다. 기본값은 socket identity이며 임의 프록시 헤더·Origin을 신뢰하지 않는다. create/join/recover 및 project ingress에 같은 peer 정책을 연결하고 인증 후 member/project 제한을 보존한다. 실제 Render ingress 주소/헤더 동작은 추측하지 않고 현장 검증 항목으로 남겼다.
- 요청 로그는 임의 URL·query·본문·인증 값을 제외하고 requestId/정규 route/상태/소요 시간/프로세스별 HMAC 프로젝트 참조를 기록한다. `operations-status.json`은 최근 256개 표본의 요청·저장 p95, 누적 실패율, RSS, event loop 지연, disk 여유, backup 상태를 기록한다. 외부 공개 상태 API를 만들지 않았다.
- 독립 서버와 Forge self-host는 같은 `buildServerBundle`을 쓴다. 실제 module graph·package metadata·lockfile·빌드 스크립트/옵션·Node/플랫폼/아키텍처·출력 해시를 검증한 캐시만 재사용한다. 빌드 중 입력 변경을 거절하고 Node/라이선스/PowerShell 파일도 실제 해시를 확인한다. 오래된 출력을 강제로 재사용하는 옵션은 없다.
- Node 24.19.0을 고정하고 `.env.example`, 수동 배포·단일 인스턴스·5GB 디스크의 `render.yaml`, 타입/린트/Windows 테스트/Linux 서버 CI를 추가했다. 서버 전용 Linux 설치에서만 Electron 다운로드를 생략한다. Windows는 실제 Electron 검사가 있어 설치를 유지한다.
- Windows CI가 합성 문서·PNG·이력·조회자 권한의 archive를 생성하고 Linux CI가 내려받아 같은 서버 결과물에서 별도 폴더 복원을 검사하도록 연결했다. 실제 Windows archive의 Windows 재복원은 로컬에서 통과했고 Linux 실행은 아직 확인하지 않았다.
- `trash-files.canonical`은 Windows에서만 소문자로 정규화한다. Linux의 대소문자가 다른 폴더를 같은 대상으로 취급하지 않으며 링크 검사는 유지한다.
- 이미지 fixture에서 R09 백업의 실제 오류를 발견했다. materialize된 PNG를 data URI 문자열과 비교해 정상 백업을 거절하던 동작을 decode한 바이트 비교로 수정하고, state에는 있으나 캡처에 빠진 checkpoint 파일도 거절한다. 정상 이미지 복원·손상·누락 검사를 추가했다.

초기 테스트의 임시 폴더 정리 순서, 잘못된 PNG 샘플, 부하 fixture의 문서 잠금 누락을 고쳤다. Windows child.kill을 Unix SIGTERM으로 가정한 검사도 제품 밖의 IPC harness로 분리했다. Windows에서는 동일 종료 handler의 프로세스 이벤트를 발생시켜 정상 정리/exit 0을 검증하고 Linux job은 실제 OS SIGTERM을 전달한다. 원래 단언을 약화하거나 Linux 검사를 skip해서 성공으로 바꾸지 않았다. 초기/수정 후 로그는 out/r10-\*.log에 보존했다.

### 42.2 최종 검증

| 범위                 | 결과                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 전체 자동 테스트     | 917개 통과, 실패/skip 0. 새 운영 경계 8개와 binary backup 1개 추가                                                                                                       |
| 타입                 | root typecheck·strict contracts·strict core 통과                                                                                                                         |
| 린트/형식            | 통과. 기존 ai-queue-packaged의 미사용 click, mock Discord this alias 경고 2개 유지                                                                                       |
| 독립 번들            | 저장소/node_modules 밖에서 실제 Node 프로세스 시작; health/ready·한글/PNG·역할·SSE/WS·receipt 재전송·정상/강제 재시작·백업/별도 폴더 복원 통과                           |
| 캐시/경계            | 동일 소스의 캐시 재사용과 output mtime 유지, 결과물 손상/누락·입력 변경·runtime 변경·Electron 모듈 혼입 거절 통과                                                        |
| 실제 Windows package | 동일 최종 결과물로 독립 Node/server 검사, R09 TLS S3 protocol backup, repository, events, session/history UI, trash UI, approval, AI queue, multiplayer의 9개 suite 검사 |
| 외부 실증            | 실제 Linux 실행/SIGTERM, 실제 외부 S3 복구, 실제 Render ingress·재배포/운영 자료 이전은 미검증                                                                           |

최종 제품 소스의 server.mjs SHA-256은 **9a5418220535d5df87922a46776424c1e4def6dadeb7937c28b44426f69bc195**, 입력 지문은 **9a1d1fc1dd0eb919c4ba2e42591de48e27bd312b748e9b27937177e23f34861b**다. 독립/준비/패키지 내 server.mjs가 같고 내장 node.exe는 검증 Node 24.19.0과 바이트가 같다. package 생성 후에는 검증한 출력 파일을 그대로 재사용한다.

첫 package의 운영 상태에서 listen 성공 전에는 ready로 기록하지 않도록 제품 코드를 보완해 최종 source package를 한 번 추가했다. 제품 소스 변경 때문에 전체 자동 검사·root 타입·번들 실행·package 검증을 갱신했다. 중간 server build는 구현·검사 중 실제 소스/설정 변경으로 다시 생성한 것이며 같은 최종 소스의 캐시는 Forge hook과 캐시 검사에서 재사용했다. R09 package는 out/r10-before-artifact, 첫 R10 package는 out/r10-before-readiness-artifact에 보존했다. 운영 배포 단계별 시간 측정은 추가하지 않았다.

부하 fixture는 **5개 프로젝트×4개 클라이언트**, 프로젝트마다 문서 50개+PNG 1개, 순차 저장 20개/동시 layout 20개/새 클라이언트 재연결 20개를 통과했다. 최종 Windows loopback 결과는 command p95 약 **135ms**, persist p95 약 **46ms**, RSS 약 **84MiB**, event loop p95 약 **31ms**, DB 163,840바이트/backup 349,378바이트다. 총 명령 40개가 모두 성공했으며 외부망·장기 부하·메모리 캐시 증가나 실제 서비스 인원 한도를 보장하지 않는다.

주요 증거는 out/r10-tests-verified.log, out/r10-types-verified.log, out/r10-{contracts,core}.log, out/r10-cache-verified.log, out/collaboration-server/server.mjs.{manifest,verification}.json, out/r10-packaged-server.json, out/r10-package-suites.json에 있다. 최종 파일별 SHA-256/크기와 상태 요약은 out/r10-verification.json에 기록한다. 운영 설정/명령·배포 전 확인은 `docs/operations/render.md`, 구조는 `docs/architecture/server-operations.md`를 따른다.

### 42.3 전체 완료를 위해 남은 조건

1. 실제 Linux에서 명시 서버 테스트, 같은 번들의 실행/재시작/SIGTERM, 실제 Windows archive의 Linux 복원·권한/이력·재연결이 통과한 CI 기록을 확보한다. 현재는 설정과 Windows 검증만 완료했다.
2. R09: 실제 비공개 외부 S3에 저장한 백업을 원본 서버/디스크 없이 별도 환경에서 복구한다. 사용자의 외부 저장소 준비 전까지 보류한다.
3. Render 서비스/계정·도메인·운영 data 전환은 별도 배포 작업이다. 실제 ingress의 헤더/rate limit·HTTPS/SSE/WS, 디스크 재배포 중 초안 보존/동일 commandId 재전송을 확인한다.
4. R08의 bounded cache/참조 없는 blob 정리는 별도 후속 성능 작업이다. R10의 짧은 부하 fixture로 해결했다고 처리하지 않는다.

사용자 운영 서버·터널·프로젝트와 실제 AI/Discord/외부 계정을 변경하지 않았다. commit/push/make/release/게시·운영 배포·유료 자원 생성·WSL 설치와 F01~F04 구현은 수행하지 않았다. 리팩토링 구현은 마지막 카드까지 진행했으나 위 실증 전에는 R09/R10 전체 완료를 선언하지 않는다.

## 43. 완료 여부 재검토 — 2026-10-22

**후속 반영:** 아래 검토에서 발견한 보완 2건은 사용자의 구현 요청에 따라 44절에서 처리했다. 외부 실증과 별도 후속 작업은 계속 남아 있다.

사용자의 재검토 요청에 따라 계획의 완료 조건, 제품 코드, CI fixture와 최종 검증 기록을 대조했다. **현재 상태는 주요 구현 완료·추가 보완 2건·외부 실증 대기**다. 42절의 구현 완료 표현은 아래 발견 사항을 반영해 한정한다.

### 43.1 추가로 확인한 보완 항목

1. **오류 로그의 프로젝트 ID 익명화.** `src/server/bootstrap.ts`의 persistence recoveryError, 수명 표식 실패, 체크포인트 export 실패 경고가 원본 project ID를 출력한다. 정상 HTTP 요청 로그만 HMAC으로 익명화돼 있으므로 R10의 기본 로그 익명화 조건을 오류 경로 전체가 충족하지는 않는다. 격리 임시 서버에서 runtime.json 경로에 의도적인 checkpoint 오류를 만들고 명령이 정상 commit된 뒤 경고에 원본 ID가 포함되는 것을 실제로 재현했다. 토큰/문서 유출을 확인한 것은 아니다. 관련 경고를 같은 익명화 경계로 통일하고 오류 발생 시 회귀 검사를 추가해야 한다. 재현 결과는 `out/r10-review-log-reproduction.json`이다.
2. **교차 OS 복원 fixture 범위 보강.** `tests/create-windows-backup-fixture.mjs`가 생성하는 Windows archive는 활성 프로젝트의 한글/PNG·역할·이력을 포함한다. `tests/server-bundle-smoke.mjs`의 windowsFixture 분기도 그 파일/역할/이력만 대조한다. Windows에서 만들어진 휴지통 identity·삭제 tombstone·실행 중 AI/예약·같은 commandId의 receipt 재전송은 이 교차 OS fixture에 없다. 동일 OS 자동/패키지 검사에서 다룬 사례와 구분해 Windows fixture 및 Linux 복원 분기에 추가하고 실제 Linux에서 통과 기록을 남겨야 한다. 이 항목은 확인된 데이터 손실 버그가 아니라 검증 범위의 공백이다.

### 43.2 기존에 남겨 둔 작업

- R09/R10 완료 조건: 실제 Linux 서버 실행·OS SIGTERM·Windows archive의 Linux 복원/재연결 검증. CI 설정은 있으나 실행 결과는 없다.
- R09 완료 조건: 실제 비공개 외부 S3에 저장한 백업을 원본 디스크 없이 다른 환경에서 복구. 사용자 요청으로 저장소 준비 전까지 보류한다.
- 별도 배포 작업: 실제 Render ingress/프록시 주소·rate limit·HTTPS/SSE/WS·재배포 중 초안/동일 commandId 처리와 운영 주소 전환 검증. 서비스 생성·배포 자체는 이번 리팩토링 범위 밖이다.
- 별도 후속 성능 작업: R08에서 확인한 본문 캐시 증가에 대한 bounded cache·참조 없는 blob 정리 정책. 짧은 부하 검사로 해결된 것으로 처리하지 않는다.
- F01~F04의 서비스 계정·결제·웹·iOS는 새 제품 기능이며 리팩토링 미완료 건수에 섞지 않는다.

재검토 시 기존 제품 입력 537개가 최종 기록과 일치했고 결과물 5개와 package suite 로그 9개의 SHA-256도 일치했다. 기존 917개 테스트/9개 package suite의 성공 기록은 유효하지만 위 공백까지 검증했다는 의미는 아니다. 제품 소스·설정은 이번 검토에서 변경하지 않았고 운영 데이터·외부 계정·배포는 건드리지 않았다. 문서 상태와 발견 사항만 갱신했다.

## 44. 재검토 보완 2건 반영 — 2026-10-22

사용자가 요청한 **오류 로그 익명화와 교차 OS 복원 fixture 보강을 구현하고 Windows에서 검증했다.** 실제 Linux 실행과 외부 S3 실증은 이번 보완 결과와 구분한다.

### 44.1 저장 오류 경고 익명화

- `telemetry.recoveryError`가 request 관찰과 같은 프로세스별 HMAC 함수를 사용한다. persistence recoveryError, 명시적 checkpoint export 실패, 최종 lifecycle marker 실패의 세 경고 경로를 이 함수로 통일했다.
- `recovery-pending` JSON에는 고정 안내·checkpoint/lifecycle 단계와 16자리 익명 프로젝트 참조만 남긴다. 원본 ID·파일 경로·예외 메시지·토큰·문서 내용은 포함하지 않는다. 알 수 없는 phase는 unknown으로 바꿔 임의 문자열도 기록하지 않는다.
- 같은 인스턴스의 요청/경고 참조 일치와 다른 인스턴스의 참조 변경을 검사했다. 실제 runtime 파일을 막아 persist 실패 경고를 만들고, history restore의 별도 checkpoint 실패와 purge의 최종 marker 실패까지 실행해 각 catch 경로의 경고가 출력되는지 검사했다. DB commit 성공/원래 복구 동작은 유지한다.
- 새 `tests/server-error-logs.test.mjs` 2개와 공통 `tests/recovery-warnings.mjs`가 검사하며, 같은 파일 시스템 오류 시나리오를 독립 번들과 실제 패키지의 Node/server에서도 실행했다.

### 44.2 Windows→Linux fixture 검사 보강

- 실제 Windows producer가 schema 2 archive와 기대값을 만든다. 한글/PNG·권한·전체 기존 이력 외에 휴지통의 원본 폴더 identity, 삭제 tombstone, 옛 Windows checkpoint, 진행 중 AI 1개와 대기 예약 1개, 정확한 commandId/sessionId/sequence 및 원래 receipt를 포함한다. 실제 공급자/CLI는 실행하지 않는다.
- 빈 출력 폴더를 요구하고 `--output`으로 새 폴더를 선택할 수 있다. 이전 schema 1 fixture는 reader에서 거절한다. 기존 fixture는 out/ci/windows-backup-before-followup에 보존했다.
- `tests/transferred-backup.mjs`는 listen 전에 복원 DB의 파일·기존 이력·revision·진행/대기 작업·receipt를 원본과 정확히 대조하고, 휴지통 identity가 실제 대상 폴더로 rebind됐는지 확인한다.
- 검증한 복원 폴더에 옛 Windows checkpoint를 추가해도 삭제 tombstone 때문에 프로젝트가 되살아나지 않는지 검사한다. 서버 시작 후 기존 실행은 한 번 실패 처리되고 기존 이력은 유지되며 대기 예약 전체·run/task ID와 파일은 보존된다. 실패한 task의 status/ai_updated_at 이외 메타데이터·본문과 다른 파일도 대조한다.
- 동일 commandId를 두 번 재전송했을 때 원래 결과/historyId가 반환되고 revision·이력 수·receipt 수가 늘지 않는지 확인한다. 휴지통을 복원하고 원본 파일/권한을 확인한 뒤 프로세스를 다시 시작하여 같은 조건을 한 번 더 검사한다.
- 기존 Linux CI 명령이 같은 producer/reader를 실행하므로 별도 workflow 우회나 가짜 Linux 입력은 추가하지 않았다. 최종 결과의 windowsArchiveRestored=win32와 windowsFixtureChecks 성공은 **Windows 로컬 검사**이며 Linux 통과를 뜻하지 않는다.

### 44.3 검증과 결과물

전체 자동 **919개 통과, 실패/skip 0**. root 타입 검사와 린트/형식 검사 통과. contracts/core strict 입력은 변경이 없어 42절의 통과 결과를 재사용했다. 기존 lint 경고 2개와 MODULE_TYPELESS_PACKAGE_JSON·gray-matter eval 안내를 해결했다고 주장하지 않는다.

제품 소스의 독립 서버 번들을 한 번 빌드하고 검증한 뒤 같은 번들을 Forge hook에서 재사용하여 Windows package를 한 번 만들었다. 같은 최종 package로 변경 범위의 **3개 suite**(확장 fixture/경고 익명화를 포함한 Node/server, 기존 repository/SQLite 장애 복구, TLS S3 protocol 예약 백업·복원)가 모두 통과했다. UI/renderer와 무관한 다른 package UI 검사는 불필요하게 반복하지 않았다. 외부 S3 계정은 로컬 TLS fixture로 대체됐다고 보고하지 않는다.

최종 server.mjs SHA-256은 **16cd55e3ed92e0b44904802f5fef12d7bede03e5397c92fd366c776dbe23b8ef**, 서버 입력 지문은 **e4159ae910fcfc7009f4688a1ee9a62c38ef5f2d003090833a21bc1590331083**이다. 독립/준비/패키지 server.mjs와 내장 Node/라이선스/운영 도구의 해시가 일치했다. 전체 제품 입력 지문은 **9aa1f6e7ecb67bd399a306a6b45e3fcbb245bcef5be7d1559e496e5916d79143**이며 기존 변경 파일 489개도 모두 존재한다. 이전 package는 out/r10-before-followup-artifact, 수정 전 관련 소스/검증 기록은 out/r10-followup-before-source에 보존했다.

증거는 out/r10-followup-tests.log, out/r10-followup-types-initial.log, out/r10-followup-lint-\*.log, out/r10-followup-bundle-initial.log, out/r10-followup-package-suites.json, out/r10-followup-verification.json과 최신 out/r10-packaged-server.json이다. 기존 42절의 917개/9개 package suite 기록은 당시 소스의 기록으로 유지하며 이번 소스에서 재실행한 범위와 혼동하지 않는다.

**남은 조건:** 실제 Linux에서 확장 archive의 복원/재시작·OS SIGTERM 검증, 실제 외부 S3 복구 실증, 별도 Render 운영 배포 검증, 별도 R08 캐시 성능 최적화는 유지한다. 사용자 운영 데이터·터널·외부 계정은 변경하지 않았고 commit/push/make/release/게시·운영 배포·유료 자원 생성·WSL 설치와 F01~F04 구현은 수행하지 않았다.

## 45. v0.34.0 배포 통합 — 2026-10-22

사용자의 Windows 앱 배포·커밋·푸시 요청에 따라 기존 리팩토링 커밋과 원격 main의 v0.33.0까지 24개 커밋을 통합했다. 중단된 작업 파일과 기존 패키지는 out/release-restart-2026-10-22에 보존했다. 서비스·contracts·runtime 분리를 유지하면서 부분 지우기, 요청 삭제 이력, 디스코드 검토 문서, 캔버스 도구 배치와 자료 선택을 연결했다. 자료 이름의 이전 접두사를 제거했고, 협업 패널이 닫혀 있어도 멀티플레이 방 알림을 수신하도록 발견 구독을 유지했다.

통합 소스의 전체 자동 테스트 943개(실패/skip 0), root/contracts/core 타입, 린트/형식 검사를 통과했다. 데스크톱 저장·AI·오프라인 재연결·멀티 사용자·실제 Chromium HTML/마우스 잠금, 캔버스 전환/저장·IME, FIFO 예약/추론 강도, 프로젝트 세션, 디스코드 승인 IPC, 멀티플레이 진단 통합 검사도 통과했다. 외부 AI/디스코드 계정 대신 격리된 모의 실행을 사용한 범위는 유지한다.

새 실제 Windows schema 2 백업 샘플과 독립 서버 번들 실행/재시작/복원·짧은 부하 검증을 통과했다. 실제 패키지 검사 25종(핵심 UI 6종, 추가 UI/동작 15종, 중복 멀티플레이를 제외한 서버 4종)이 통과했다. 대화상자 포커스 회귀를 수정하고 새 테스트를 추가했으며, 새 패널 구조의 실제 클릭·키보드 검증도 유지했다.

GitHub Linux 실행에서 준비 완료 직후 SIGTERM을 보내면 종료 처리기 등록 전에 프로세스가 끝나는 초기화 경쟁을 발견했다. 처리기를 비동기 서버 초기화 완료 전에 등록하도록 수정하고 서버 번들·Windows package를 새로 만들었다. 최종 서버 번들 SHA-256은 9c5573876b8268c8f235ad787db852832cbe34b553d7d48507524dd974642f0c이다. 변경된 실제 패키지의 Node/server·SQLite 장애 복구·TLS S3 protocol 백업/복원·부분 지우기·멀티플레이 서버 검사를 모두 다시 통과했다. 앱 본체 app.asar와 실행 파일은 앞서 21개 UI/동작 검사를 통과한 파일과 각각 해시가 동일하여 결과를 재사용했다. 최종 제품 입력 552개의 지문은 25ee3e2f6236a1b544b1e7a739aa3fda4a67556288350ab02226f937f2175d8f이며 내장 서버 런타임 45개 파일의 해시/크기도 별도 기록했다.

검증 소스 d66604de18f280cab19ff150a760fe7e93ed2db7의 [GitHub CI](https://github.com/sehyeok3406/game-jam-dev/actions/runs/39730917943)에서 타입/린트와 Windows 943개 자동 테스트·Windows archive 생성, Linux 211개 서버 테스트·번들 빌드·실제 Windows archive 복원/재시작·동일 요청 재전송·부하·실제 OS SIGTERM 검사가 모두 통과했다. 44절에서 남겨둔 실제 Linux 검증 공백은 이 결과로 해소한다. 외부 비공개 S3 복구와 Render 운영 서버 전환, R08 캐시 성능 최적화는 별도 조건으로 유지한다. 실제 외부 S3와 Render 운영 변경은 이번 Windows 릴리스에서 수행하지 않는다. 게시 결과와 최종 검증은 UPDATES.md의 v0.34.0 기록에서 확인한다.
