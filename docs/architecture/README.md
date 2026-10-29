# 구현을 위한 아키텍처 안내

2026-10-25 기준으로 기존 설계와 실제 구현을 연결한 개발 안내다. 구현 전 이 문서와 변경 영역의 문서·대표 코드만 읽는다. 과거 리팩토링 계획 전체를 매번 읽을 필요는 없다.

## 현재 구조와 유지할 방향

현재 실행 단위는 Electron 데스크톱, Node 협업 서버, 별도 읽기 전용 웹 게시 서비스다. 단일 저장소 안에서 책임을 나누는 구조를 유지한다.

- 개인 로컬 기능은 서버 연결·서비스 로그인·구독 없이 동작한다.
- AI CLI 실행과 인증은 사용자/관리자 PC가 소유한다. 협업 서버는 승인·예약·lease·공동 결과 반영을 소유한다.
- UI의 기능 표시와 서버의 권한 검증은 별개다. 플랫폼 능력, 프로젝트 접근 권한, 구독 권한을 서로 대신 사용하지 않는다.
- 프로젝트 작업은 시작 세션에 고정한다. 프로젝트를 바꾸거나 같은 경로를 다시 열었을 때 이전 작업의 늦은 결과가 새 상태에 반영되지 않아야 한다.
- 저장·동기화·히스토리·복구의 기존 확정 경계를 재사용한다. 화면 갱신 성공을 저장 성공으로 간주하지 않으며 실패·재시도·중복 요청도 설계한다.

웹 편집기, 운영 팀 서비스와 계정·구독 기능은 확장 방향이다. 계약 타입이나 port의 존재만으로 해당 기능이 구현되었다고 판단하지 않는다. 필요한 경계를 보존하면서 현재 요청에 필요한 범위만 구현한다.

## 책임과 의존 방향

| 위치                   | 소유하는 책임                              | 새 코드의 의존 기준                                                   |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `contracts`            | 공통 DTO·명령·API 계약                     | 다른 contracts만 참조. 플랫폼/구현 타입을 섞지 않음                   |
| `core`                 | 저장·통신 없는 계산과 검증                 | core·contracts만 참조. 시각·ID 등 변동 입력은 주입                    |
| `application`          | 업무 순서·실패 처리·세션 및 저장 경계 조정 | application·core·contracts. 외부 기능은 좁은 port로 받음              |
| `adapters`             | 파일·DB·HTTP·프로세스 연결 구현            | 필요한 port와 공통 규칙을 구현. 화면 의존 금지                        |
| `desktop`              | Electron IPC·OS 기능·프로젝트 실행 수명    | application과 adapter를 조립. IPC에서 업무 로직 중복 금지             |
| `server`               | 요청 검증·권한·큐·공동 데이터 확정·운영    | bootstrap에서 서비스와 저장소 조립. HTTP와 업무/저장 책임 구분        |
| `ui`·화면용 `features` | 표시·입력·화면 수명과 명령 조정            | contracts·브라우저용 계산·UI 모듈과 runtime. 구현 계층 직접 호출 금지 |

`src/main.ts`, `src/renderer.tsx`, `src/server/bootstrap.ts` 등은 실행 환경 조립 지점이다. 조립에 필요한 adapter 연결까지 금지하지 않는다. `features/self-host`는 UI와 Electron 구현이 함께 있으므로 디렉터리 전체를 브라우저 코드로 취급하지 않는다.

**현재 남은 차이:** `application`은 기존 루트 업무 모델도 참조하며 일부 경로는 간접적으로 Node에 의존한다. UI도 기존 브라우저용 모델을 재사용한다. `src` 루트 파일을 모두 폐기 대상으로 취급하거나 application을 곧바로 웹에서 실행 가능하다고 판단하지 않는다. 새 업무 로직은 위 계층에 배치하고 기존 의존성을 다룰 때 관련 동작 검증을 함께 수행한다.

## 변경 영역별로 읽을 문서

아래는 출발점이며 연결된 영역별 문서에서 세부 경계와 검사를 확인한다. 날짜가 붙은 완료/감사 기록은 당시 검증 근거이며 현재 모든 코드의 상태를 보증하지 않는다.

| 변경 영역                       | 설계 문서                                                                                                                          | 대표 구현·검사                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API·runtime·플랫폼 기능         | 이 문서, [R04 경계와 검증 범위](r04-completion.md)                                                                                 | `src/contracts/app-api.ts`, `src/ui/runtime/RuntimeProvider.tsx`, `tests/runtime-contracts.test.mjs`                                                                |
| 문서·캔버스 편집·저장           | [편집 명령](editing-commands.md), [프로젝트 파일](project-files.md)                                                                | `src/application/editing/document-service.ts`, `src/adapters/filesystem/document-repository.ts`, `tests/document-service.test.mjs`, `tests/shared-editing.test.mjs` |
| 홈·프로젝트 생성·전환·협업 연결 | [홈](project-home.md), [협업 세션](collaboration-session.md)                                                                       | `src/application/projects/home-service.ts`, `src/application/projects/project-session.ts`, `tests/project-session.test.mjs`                                         |
| 선택·복제·프로젝트 간 복사      | [선택 명령](selection-actions.md), [최근 복사 기능 계획](../plans/2026-10-24-selection-menu-and-project-copy.md)                   | `src/ui/canvas/selection-actions.ts`, `src/application/projects/project-copy-service.ts`, `tests/project-copy.test.mjs`                                             |
| UI 상태·패널·섹션               | [화면 분리](r05-workspace.md), [패널](workspace-panels.md), [섹션](section-actions.md), [표시 명령](presentation-actions.md)       | `src/ui/canvas/useSelectionActions.ts`, `tests/selection-hooks.test.mjs`                                                                                            |
| AI 준비·실행·취소·결과 반영     | [AI 실행](ai-execution.md), [서버 AI 실행](server-ai-run.md), [승인](server-approvals.md)                                          | `src/application/ai/run-service.ts`, `src/application/ai/run-coordinator.ts`, `tests/ai-run-service.test.mjs`                                                       |
| 서버 요청·권한·명령             | [조립](server-assembly.md), [HTTP](server-http.md), [권한](server-access.md), [명령](server-command.md)                            | `src/server/bootstrap.ts`, `src/server/services/project-request.ts`, `tests/server-command.test.mjs`                                                                |
| 서버 상태·동기화·히스토리       | [상태](server-state.md), [오프라인 동기화](server-offline-sync.md), [히스토리](server-history.md)                                  | `src/server/services`, `tests/server-*.test.mjs`                                                                                                                    |
| 서버 저장·삭제·복구·백업        | [저장](server-persistence.md), [수명](server-lifecycle.md), [백업](server-backup.md), [운영 절차](../operations/backup-restore.md) | `src/adapters/sqlite/project-repository.ts`, `tests/sqlite-project-repository.test.mjs`                                                                             |
| 검증 선택·배포                  | [회귀 검사](regression-matrix.md), [배포 순서](../../UPDATES.md)                                                                   | `package.json`, `.github/workflows/ci.yml`                                                                                                                          |

## 구현 판단 예시

- **문서 저장 추가:** UI는 runtime의 편집 API를 호출한다. application 서비스는 입력·원본 충돌과 작업 순서를 검증하고 repository port를 사용한다. 파일 교체는 adapter가 수행한다. `document-service.ts`와 `document-repository.ts`를 함께 참고한다. 클릭 처리기에 파일 저장·히스토리 기록을 복제하지 않는다.
- **프로젝트 전환 추가:** 기존 세션과 저장 큐 경계를 재사용한다. application이 전환 순서와 실패 처리를 조정하고 desktop이 실제 경로·연결을 제공한다. await 뒤 대상 세션을 다시 검사한다. 화면에서 파일 복사와 서버 참여 종료를 직접 묶지 않는다.
- **새 공통 데이터 추가:** 필요한 contracts에 타입을 정의하고 사용하는 계층에서 직접 import한다. 편의상 `src/shared.ts`에 다시 모으거나 Electron 타입을 공통 DTO에 넣지 않는다.
- **플랫폼 기능 추가:** port와 runtime의 지원 능력을 통해 연결한다. 미지원 환경에서 성공한 것처럼 반환하지 않는다. 실제 웹 기능이 요청되지 않았다면 미래 웹 adapter까지 미리 작성하지 않는다.

## 자동 검사와 예외 관리

`npm run test:architecture`는 검사기 회귀 테스트와 현재 소스의 경계 검사를 수행한다. `npm test`에도 포함되며 CI의 types 작업에서는 별도 단계로 실행한다. 독립적인 lint·타입 검사와 함께 사용할 수 있고 패키지 빌드가 필요하지 않다.

검사 구현은 [architecture-boundaries.mjs](../../scripts/architecture-boundaries.mjs), 기존 예외는 [boundary-exceptions.json](boundary-exceptions.json)에 있다.

- contracts/core의 허용 계층, application의 새 외부 의존성, UI의 직접 플랫폼/구현 계층 의존성을 검사한다.
- UI의 `window.gameCanvas`, `globalThis.gameCanvas`, 대괄호 접근, 전역 객체의 구조 분해와 `localStorage` 직접 참조를 검사한다. runtime의 주입된 API·preferences를 사용한다.
- `src/shared.ts`로 향하는 새 호환 import를 검사한다. 안정된 공개 서버 진입점 `src/collaboration-server.ts`는 무조건 금지하는 임시 타입 파일과 구분한다.
- src 하위 소스 파일을 재귀 검사한다. 정적 import/export, type import, literal dynamic import, require, import-equals를 확인하며 tsconfig로 로컬 별칭을 해석한다. 검사 대상 계층의 계산된 동적 모듈 로딩은 정적으로 판단할 수 없어 거절한다.
- 예외는 **규칙 + 참조 파일 + 대상 + 발생 수**로 고정한다. 다른 파일이나 대상에 재사용할 수 없고 발생 수가 늘면 실패한다. 해소된 예외도 검사 실패로 알려 목록에서 제거하도록 한다.
- 예외를 자동 갱신하는 명령은 제공하지 않는다. 새 예외가 불가피하면 정확한 항목, 이유, 제거 조건을 기록하고 책임/의존 방향 변경은 ADR로 설명한다. 통과만을 위한 범위 확대는 하지 않는다.

초기 예외는 기존 application→레거시 의존성, 기존 shared 타입 재수출 사용, 격리된 UI 디버그 미리보기의 전역 검사/메모리 저장 설정이다. 디버그 예외는 해당 파일의 해당 참조 수에만 적용된다.

이 검사는 **직접 소스 의존성과 일부 전역 접근**을 검사한다. 서드파티 내부나 모든 간접 런타임 의존, 전역 객체 별칭/리플렉션, 서버 내부 책임 분리와 업무 규칙을 완전히 증명하지 않는다. contracts/core의 전역 환경 제한은 별도 strict 타입 검사로 보완한다. 세션·권한·저장 원자성은 영역별 동작 테스트로 검증한다.

## 설계 문서와 결정 기록을 유지하는 방법

현재 규칙은 이 안내와 영역별 문서에 유지한다. [리팩토링 계획](../../REFACTORING_PLAN_2026-10-20.md)과 [2026-10-22 감사](../audits/2026-10-22-refactor-architecture-audit.md)는 배경·당시 제약의 근거다. 계획의 제안이나 감사의 과거 문제를 확인 없이 현재 구현으로 간주하지 않는다.

사용자의 최신 명시적 요구가 우선한다. 문서와 코드가 다르면 현재 동작을 확인하고 필요한 문서를 함께 수정한다. 제품 정책·데이터 소유권처럼 요청만으로 결정할 수 없는 충돌만 사용자에게 확인하고, 일반적인 책임 배치와 구현 선택은 기존 기준으로 진행한다.

여러 영역의 책임·의존 방향, 공개 API/프로토콜, 데이터 소유권·저장/복구 보장에 영향을 주는 결정은 `docs/architecture/decisions/NNNN-short-name.md`에 ADR을 남긴다. 단순 버그 수정이나 기존 패턴의 기능 추가에는 만들지 않는다. 최초 기록은 [0001](decisions/0001-architecture-guidance-and-checks.md)이다.

새 ADR에는 제목, 날짜, 상태(제안/채택/대체됨), 문제와 제약, 결정과 이유, 검토한 대안, 영향·이행 예외, 검증 방법·재검토 조건을 간결히 적는다. 채택되면 관련 현재 설계 문서도 갱신한다. 변경된 결정은 이전 기록을 지우지 말고 대체 기록으로 연결한다.
