# 개인 AI 실행의 경계

게임 제작 v2는 [게임 제작 계약](game-builds.md)과 [ADR 0005](decisions/0005-game-builds-and-standalone-html.md)를 따른다. 0~3단계의 저장·지침·준비 서비스를 [4단계 source 제작 실행](game-build-execution.md)에 연결했다. 새 gamejam HTML 요청은 preparation → source → 고정 빌드를 사용하고, 기존 v1 명세의 1~2회 CLI·stage·반영은 유지한다. 생성 capability `gameBuildVersion:1`을 저장·지침 지원과 구분한다.

파일 구조 v2에서는 사용자 Markdown을 docs 바로 아래에 생성하고 문서 묶음·역할은 속성으로 식별한다. 실제 작업 명세와 실행 기록은 .gamejam 아래에 있지만 snapshot의 .ai/tasks·.history 식별 경로는 유지한다. 격리 stage와 불변 입력은 이 식별 경로를 그대로 materialize한다. 따라서 CLI 지시의 파일 접근 범위를 넓히지 않는다. 새 결과에는 생성 출처와 작업 참조를 기록한다. 자세한 경로·기존 작업/복구 호환은 [ADR 0003](decisions/0003-project-file-layout.md)을 따른다.

개인 앱은 로그인/구독/서버 연결 없이 기존처럼 로컬 CLI를 실행한다. 협업 서버는 요청·승인·예약·lease·결과 저장을 담당하며 사용자의 CLI 인증이나 프로세스를 대신 소유하지 않는다.

| 책임                             | 구현                            | 주입하거나 보유하는 자원                            |
| -------------------------------- | ------------------------------- | --------------------------------------------------- |
| 공급자/모델/추론 수준 목록       | core/ai/catalog                 | 공통 계약만 참조                                    |
| CLI 인자·설정·출력 파서·탐색     | adapters/node/ai                | 기존 제한 인자와 읽기 전용 probe                    |
| 실행·취소·UTF-8 스트림           | desktop/ai/node-executor        | 실행별 child process와 AbortSignal                  |
| 격리 작업 공간                   | desktop/ai/stage-workspace      | 시작 프로젝트의 history/workspace/input             |
| 단계 입력·산출물 검증·반영       | application/ai/run-service      | stage, 프로젝트 저장소, HTML 검사, clock            |
| durable 예약·중복/충돌·전환      | application/ai/queue-service    | 큐 저장소, 프로젝트 capture, ID/clock               |
| 공동 claim                       | claimSharedAiRun                | 기존 서버 클라이언트의 claim/begin adapter          |
| 앱/Discord 승인 실행 gate        | application/ai/approval-service | 권한 검사, flush, serial, reserve/execute           |
| 실행 상태·단계 전환·종료         | application/ai/run-coordinator  | 시작 session·lease에 고정된 실행, 단일 완료 Promise |
| 이벤트 identity·bounded timeline | application/ai/run-events       | 시작 actor/provider/session, 200개 로그와 상태 전환 |
| JSON/로그 framing                | adapters/node/ai/run-output     | 공급자별 parser, 단계별 buffer와 결과               |
| task·히스토리·진단 기록          | desktop/ai/run-records          | 시작 root/run/task, 기존 JSON·SHA-256 형식          |
| desktop 연결 수명                | desktop/bootstrap               | updates, web viewer/sync, self-host                 |

로컬 결과는 stage 검증 → 원본 입력 충돌 검사 → validating 히스토리 → 기존 원자 파일 반영 → completed 히스토리 순서다. 마지막 히스토리 기록이 실패하면 해당 반영에서 변경한 파일 전체를 이전 상태로 복구한다. 공동 결과는 기존 서버 lease를 통해서만 반영한다. lease가 사라지면 로컬 반영으로 대체하지 않는다.

HTML 초기 실행 검사는 격리된 Electron renderer에서 수행한다. 브라우저가 직접 발생시킨 `ResizeObserver loop completed with undelivered notifications.` 이벤트 중 예외 객체가 null인 크기 전달 알림은 경고로 남긴다. 브라우저가 보고하는 행·열 번호는 발생 시점에 따라 달라지므로 판별에 사용하지 않는다. 900ms 초기 관찰 중 10회 누적되면 안정화되지 않는 레이아웃으로 실패 처리한다. 같은 문구의 실제 JavaScript 예외·명시적 console.error·Promise 거절은 계속 실패한다. `tests/html-validation-runner.ts`에서 실제 ResizeObserver의 일시적/지속적 반복과 후속 실행 오류를 검증한다. 이 검사는 초기 실행 확인이며 게임 전체 진행이나 장시간 레이아웃 안정성을 보증하지 않는다.

두 단계 gamejam은 문서 정리 결과를 검증한 후 같은 run/lease로 HTML 단계에 전달한다. 새 명세에는 정리 문서뿐 아니라 원본 자료·단계별 사용자 지시·선택한 시스템 문서를 함께 전달한다. 동적으로 확정한 시스템 문서도 검증 후 다음 단계 입력/제작 기준에 추가한다. 두 단계의 결과는 마지막 검증까지 원본 프로젝트에 반영하지 않는다. 기존 단일 실행 제한, 출력 경로, 입력 보호, 새 버전/ID 규칙과 codex:\* IPC·JSON 형식을 유지한다.

HTML 구현 기본 지침 2판은 인게임 화면·장르별 HUD/메뉴·아트·카메라·피드백과 문서의 제작 기준을 연결한다. 라이브러리 이름 제한은 없고 최종 HTML 독립 실행 조건을 유지한다. 현재 v2 요청은 실제 의존성 준비/source/build 도구를 사용한다. 과거 v1 요청의 실행 방식은 바꾸지 않는다. 공통 default를 네 공급자의 새 요청·기본값 복원·로컬/서버 명세 생성에서 재사용한다. 과거 요청을 새로 준비할 때 확인 가능한 기본값만 갱신하고, 편집/구분 불가 내용·초안 재개·기존 공유 요청 편집과 과거 task/예약/실행은 보존한다. EffectiveInstructionsV2가 적용 내용/출처/해시를 기록한다. 특정 엔진·스타일을 강제하거나 생성된 게임의 시각적 품질을 자동 보증하지 않는다.

실행 coordinator가 상태 전이·단계 실행·최종 기록과 한 번의 자원 해제를 소유한다. 로그 callback에는 실행 단계 식별자를 붙여 이전 단계/완료 후 callback을 버린다. 실행 중 session이 바뀌면 결과 반영을 막고, 진단/실패/중지 기록은 시작 root에 남긴다. lease는 반영 직전에도 비교하며 새 lease의 작업을 대신 종료하지 않는다. 진단·히스토리·task 기록 실패는 각각 보고하면서 실행 슬롯 해제를 시도한다.

main은 CLI 연결 확인과 준비 작업, root/session/client를 캡처하는 adapter 조립 및 UI IPC를 맡는다. 실제 공급자 인증, 과금 호출과 운영 서버 배포는 이 구조 검증에 포함하지 않는다.

v2의 내부 실행은 `AiRunService.executePhase`와 application의 고정 제작 서비스가 맡고 coordinator가 단일 run/취소/완료를 계속 소유한다. 비공개 source 목록 검증 후 HTML과 immutable 원본 묶음을 기존 저장 경로에 함께 반영한다. 큰 HTML은 작은 shell의 sandbox iframe으로 IPC 전달하며 초기 리소스 decode/오류를 함께 검사한다. 자세한 현재 한도와 source/공급자/빌드 경계는 [제작 실행](game-build-execution.md)을 따른다.

## Grok Build

`grok-cli`는 공식 Grok Build 1.0.70 이상을 대상으로 한다. Grok의 기본 Read/Grep가 `dontAsk`에서도 외부 파일을 읽을 수 있어, 각 단계의 `taskFileLock` 보호 범위를 application에서 사본으로 전달한다. adapter는 JSON prompt 파일에 지시·문서·HTML과 이미지 content block을 담고, CLI에는 작업 폴더의 `write`만 허용한다. Read/Grep·셸·MCP·웹은 명시적으로 거절한다. 새 단계의 사본을 얻은 뒤 시작 세션을 다시 검사한다. 결과는 기존 검증·반영 흐름을 사용한다.

설정·prompt는 프로젝트 밖의 실행별 OS temp에 둔다. `GROK_HOME`은 이 임시 위치를, `GROK_AUTH_PATH`는 사용자의 기존 CLI 인증 파일을 가리킨다. 인증값을 복사하지 않는다. 외부 설정 탐색을 끄고 실행 전 `inspect --json`으로 예상하지 않은 설정·확장을 거절한다. 정상 종료·취소·준비 실패 시 임시 파일을 제거하며 강제 종료까지 정리한다고 보장하지 않는다. 연결 상태는 인증 정보 존재와 실제 유효성·모델 이용 권한을 구분한다.

협업 state의 `supportedAiProviders` 목록은 서버가 검증할 수 있는 공급자를 광고한다. 목록이 없는 구버전 서버는 기존 boolean에 따라 Codex 또는 기존 세 공급자만 허용한다. 로컬 실행에는 이 서버 능력을 요구하지 않는다. 상세 판단과 대안은 [ADR 0002](decisions/0002-grok-cli-and-provider-capabilities.md)에 기록한다.
