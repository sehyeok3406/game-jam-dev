# 소스 기반 게임 제작 실행

2026-11-02. 4단계에서 연결한 실제 제작 흐름이다. 저장 계약은 [game-builds](game-builds.md), 의존성 준비는 [dependency-preparation](dependency-preparation.md), 결정 근거는 [ADR 0006](decisions/0006-game-builds-and-standalone-html.md)를 따른다.

## 시작과 호환성

현재 gamejam 요청에서 HTML 구현을 선택하면 `gamejamTaskInput`이 `CreateTaskInput.gameBuildVersion:1`을 지정한다. 개별 구현 명세는 `gamejam_workflow_version:2`, `game_build_version:1`을 가진다. 문서 정리와 함께 요청하면 상위 명세와 두 번째 구현 단계에 새 버전을 기록하고 첫 번째 문서 단계는 기존 계약을 사용한다.

`gameBuildTask`와 `workflowStages`가 버전·단계 조합·입력·출력·요구 맥락을 검증한다. 구현만 하는 v2는 단계 배열을 요구하지 않는다. 문서만 정리하는 작업은 준비/빌드를 실행하지 않는다. 과거 v1 명세와 생성 버전이 없는 기존 API 요청은 기존 직접 HTML 경로를 유지하며 저장된 명세를 자동 변경하지 않는다. 새 UI 요청을 구버전으로 줄여 보내지 않는다.

협업 `/health`와 state는 `gameBuildVersion:1`을 광고한다. 저장 `gameBuildStorageVersion:1`, 지침 `taskInstructionsVersion:2`, 기존 `gamejamWorkflow` boolean과 별개다. 클라이언트는 새 제작 요청/승인/실행 전에 서버 지원을 확인하고 요청 본문에 자신의 지원 버전을 보낸다. 서버는 작성·승인·예약·claim·재시도/lease 재반환·finish에서 해당 작업의 버전을 검사한다. 기존 요청 변환기 `reduceCollaboration`도 `gameBuildVersion`을 유지해야 한다. 이 필드를 빠뜨려 새 작업이 v1로 생성되는 문제를 실제 패키지 검사에서 발견해 수정했다.

## 순서와 소유 계층

```text
기존 요청/승인/예약 → 시작 session·lease·baseline 고정
→ 선택했다면 기존 문서 정리 실행/검증
→ 공통 라이브러리 준비: 조사/선정/exact lock/자료
→ 비공개 source 작성
→ 고정 Node/Rolldown 빌드·이미지/고지 내장
→ 기존 산출물/HTML 실행 검사
→ 기존 저장 큐 또는 서버 lease로 source·manifest·HTML 함께 반영
```

`AiRunCoordinator`가 실행/중지/완료와 기존 상태 enum을 계속 소유한다. workflow의 선택적 `executePhase` port는 해당 단계의 실행 방법만 바꾼다. v1/문서 정리는 기존 executor, v2 구현은 공통 제작 순서로 실행하며 상세 진행은 기존 progress 이벤트로 전달한다. 범용 workflow 엔진이나 새 서버 AI 실행 경로를 만들지 않았다.

| 구현                                                      | 책임                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `contracts/game-build-execution.ts`                       | 비공개 source 계획·생성 소스·컴파일 결과 DTO                               |
| `core/ai/game-build-source.ts`                            | source 목록/확장자/대소문자·파일/폴더 충돌·한도·선택 이미지 연결           |
| `core/projects/game-build-publication.ts`                 | revision metadata 계산·새 원본 묶음의 반영 범위                            |
| `application/ai/game-build-execution.ts`                  | 준비 → source → compile 순서, 단계 사이 취소/세션 확인, 자원 정리          |
| `application/ai/run-service.ts`                           | 기존 문서 단계, 소스 receipt/manifest 생성, 최종 검사와 기존 반영·rollback |
| `desktop/ai/game-build-execution.ts`                      | 기존 executor/parser·공급자 설정과 비공개 source stage 조립                |
| `adapters/node/game-preparation/compile.ts`, `builder.ts` | 도구 검증·프로세스·고정 bundler/resolver·HTML 내장                         |
| `adapters/node/game-preparation/tool-process.ts`          | 준비/빌드가 함께 쓰는 고정 worker 실행·환경·취소·출력/시간 한도            |
| `server/services/ai-result.ts`                            | 기존 lease 완료의 정확한 산출물·원본 정합성 검증                           |

desktop 조립은 실제 runtime/cache 경로·executor·세션/lease 확인을 주입한다. AI 실행과 준비/빌드는 사용자 또는 관리자 PC에서 수행한다. UI는 기존 runtime API만 사용한다. 앱이 구현하지 않은 플랫폼의 빌드 도구를 서버 능력과 혼동하지 않는다. 현재 동봉 도구 대상은 Windows x64다.

## 비공개 source 계약

source stage는 프로젝트 밖 실행별 임시 디렉터리다. 선택한 입력 사본과 `.ai/tasks/game-build-context.json`에 준비 결과·버전별 자료·이미지 목록을 전달한다. AI는 `source-plan.json`과 그 목록의 `source/<relative>` 파일만 작성한다.

```json
{
  "version": 1,
  "entry": "main.js",
  "html": "index.html",
  "files": ["main.js", "index.html", "style.css"],
  "assets": [{ "key": "hero", "path": "assets/images/selected.png" }]
}
```

- 소스는 JS/CSS/JSON/HTML, 최대 64개·각 2MB·합계 16MB다. entry는 JS, html은 선언한 HTML 파일이다. 목록에 없는 파일·누락·경로 탈출·대소문자/파일·폴더 충돌·링크를 거절한다. 최종 저장 경로의 240자 한도도 적용한다.
- 입력/앱 제공 context의 변경, 허용 밖 산출물, 잘못된 공급자 종료를 거절한다. 기존 Grok write-only 입력 사본과 Gemini 제한 설정을 재사용한다. 새 설치/셸/네트워크 권한을 공급자에게 추가하지 않는다.
- HTML에는 `entry`를 가리키는 `<script type="module" src="./main.js"></script>` 하나를 둔다. 실행 script를 추가하거나 외부 script를 참조하지 않는다. 비실행 `application/json`은 기존 멀티플레이 선언 등에 사용할 수 있다.
- 라이브러리는 준비한 root를 정상 module import한다. 소스에서 추가한 미준비 의존성은 자동 설치하지 않고 오류로 반환한다. 현재 실행 경로에서 임의 업그레이드를 허용하지 않으며 기존 연결 결과의 lock을 준비 서비스에 전달한다.
- JS에서는 `import assets from 'gamejam:assets'`, HTML/CSS에서는 `gamejam:asset/hero`를 사용한다. 이미지 key는 manifest의 원본 path/hash와 연결된다. 실제 입력 사본에 있는 추적 이미지만 사용할 수 있다.
- 7단계 실제 화면 검토를 반영해 source prompt는 작은 데스크톱 iframe에서도 게임판·필수 HUD·조작을 맞추고 의도하지 않은 페이지 스크롤을 피하도록 안내한다. 명시적 사용자 해상도와 인게임 카메라/월드 스크롤은 유지한다. 자동 화면 평가/수정이나 모든 생성물의 반응형 품질 보증은 아니다.

`source-plan.json`과 내부 교환 파일은 공개 `expected_outputs`나 프로젝트 파일에 그대로 넣지 않는다. 기존 Markdown/HTML 산출물 검사를 느슨하게 만들지 않는다. 보존되는 manifest의 `entry`, `htmlTemplate`, `sources`, `assets`로 제작 recipe를 다시 식별한다. `htmlTemplate`은 초기 저장 기반만 만들었던 revision에는 없을 수 있으며, 있으면 실제 HTML source 목록과 연결되어야 한다.

## 고정 빌더와 독립 HTML

5단계의 [원본 수정·버전·복원](game-build-editing.md)은 이 제작 port에 기존 source/lock/문서 baseline을 전달한다. source stage에 수정 가능한 사본을 준비하고 일반 문서/HTML 단계의 출력 권한과 보존 원본의 불변성은 유지한다. 공동 v2 실행에는 `gameBuildVersion:1`과 별도로 `gameBuildEditingVersion:1`을 협상한다.

앱 resource의 `builder.mjs`를 동봉 Node로 실행한다. 사용자 설정·npm script·lifecycle·임의 plugin을 읽거나 실행하지 않는다. 빌드 입력과 source는 앱 전용 cache의 실행별 `.work-*` 안에 두고 worker 종료 뒤 삭제한다. 준비 단계의 추출 폴더는 빌드가 끝날 때까지 유지한 뒤 정리한다. 빌드는 60초다. 로컬 빌더는 작업 폴더에 HTML을 쓰고 stdout에 도구 정보만 반환한다. 공동 빌더는 기존 응답과 HTML 한도를 사용한다. 준비와 빌드의 toolset digest가 다르면 실패한다. worker에 정적으로 번들된 파서/CSS 처리 의존성은 실제 bundle 모듈 목록에서 수집한 라이선스·저작자 원문을 THIRD-PARTY-NOTICES.txt에 동봉한다.

Rolldown의 browser 조건으로 선언된 source와 검증한 package graph만 해석한다. source의 절대/URL/file/Node import, graph 밖 package 읽기, 지원하지 않는 파일 형식이나 분할 리소스를 거절한다. 정적 해석 후에도 남은 동적 import는 Acorn으로 검사해 거절한다. 외부 plugin/config를 로드하는 기능은 없다.

현재 Rolldown 버전은 CSS bundle을 직접 지원하지 않아, 고정 앱 plugin이 검증한 CSS를 JS style 삽입 또는 HTML의 inline style로 처리한다. CSS의 외부 url과 `@import`는 거절하며, 여러 CSS 파일은 JS import나 HTML stylesheet link로 선언한다. 선언한 이미지는 CSS 변수/HTML 속성/JS catalog로 연결해 원본 data URI를 HTML에 **한 번만** 보관한다. 같은 이미지를 여러 위치에서 써도 payload를 반복 저장하지 않는다.

module import를 하나의 IIFE로 합치되 HTML의 inline `type="module"`로 넣어 원래 module script의 실행 시점을 유지한다. entry가 head에 있어도 DOM 분석 뒤 실행되고 DOMContentLoaded 전에 초기화한다. script/style 종료 문자열과 비실행 JSON은 HTML을 탈출하지 않도록 이스케이프한다. 고지 원문과 lock/toolset/profile provenance도 비실행 JSON에 포함한다.

초기 `standalone-browser-v1`은 DOM/CSS/Canvas2D/WebGL와 내장 리소스를 대상으로 한다. HTML 자체의 CSP에서 외부 연결·worker·object·form/base를 제한하고 eval/WASM 실행 권한을 추가하지 않는다. 외부 runtime/CDN/프로젝트 경로/node_modules 없이 실행되어야 한다. package 확보나 source 파일 허용이 브라우저 호환성 인증은 아니다. 로컬 최종 HTML에는 고정 크기 제한을 두지 않는다. 공동 최종 HTML은 8MB다.

### 로컬 프로젝트 GLB 연결

로컬 제작에서 선택한 모델 노드의 GLB는 `source-plan.json`의 `assets`에 프로젝트 상대 경로와 별칭으로 선언한다. AI는 파일명·경로·크기·해시를 받고, 게임 코드는 `import assets from 'gamejam:assets'`로 별칭에 해당하는 URL을 읽는다. 새 버전은 이전 manifest의 연결을 다시 사용할 수 있다. 실행 서비스는 선택하거나 이전 버전에서 연결한 GLB만 허용하며, 외부 버퍼나 텍스처가 필요한 GLB와 누락·변경된 원본은 거절한다.

빌더는 `local-assets-browser-v1`로 저장하고 게임 코드 앞에 앱에서 채울 자리를 둔다. 미리보기의 메인 프로세스는 현재 프로젝트와 HTML 경로·build ID를 검사하고, 해당 버전 manifest에 있는 GLB마다 현재 세션에 한해 유효한 임시 URL을 발급한다. 실행 검사는 전용 세션에 같은 연결을 설정한다. 파일 어댑터는 프로젝트 경로·크기·SHA-256·GLB 구조를 확인하고 원본을 스트리밍한다. CSP는 이 프로젝트 에셋 호스트와 GLB 내부 텍스처 디코딩용 blob 연결을 허용한다. 검증 프레임은 초기 fetch·응답 본문 읽기·이미지 디코딩 중 오류도 관찰한다.

## 실행 검사와 저장

`validateHtml`은 작은 격리 shell을 연 뒤 renderer IPC로 sandbox iframe의 srcdoc에 전달한다. 큰 로컬 HTML은 512Ki UTF-16 코드 단위씩 전달해 renderer에서 합친다. readiness는 실행별 channel과 frame의 window identity를 함께 확인한다. 이미지 decode/font 준비·리소스 오류, 기존 JavaScript 예외/Promise 거절/console 오류와 ResizeObserver 분류·8초 timeout을 유지한다. 온라인 검사용 harness의 큰 게임 문자열도 renderer IPC로 전달한다. 실제 player shell은 기존처럼 작은 shell과 bootstrap IPC를 사용한다.

이 검사는 초기 실행·리소스 확인이다. 전체 규칙·의미적 요구 준수·모든 입력/장시간 플레이·비주얼 품질의 자동 판정은 아니다. sandbox/CSP를 OS 수준의 코드 보안 sandbox나 악의적 게임에 대한 완전한 검사로 표현하지 않는다.

소스 receipt는 `appendGameBuild`로 새 immutable revision 후보를 만든다. 문서/소스/lock/고지/HTML 검사 전에는 프로젝트에 반영하지 않는다. document baseline은 AI가 읽은 당시 사본의 ID/hash이고 이후 저장 장식·사용자 편집과 별개다. 결과 경로와 artifact/build ID, source/HTML/의존성/도구 hash를 함께 기록한다.

최종 반영은 기존 `AiRunService.publish`의 저장 큐/외부 변경 확인/lease를 사용한다. 다른 게임의 index 항목을 잃지 않도록 현재 snapshot에 새 revision을 연결한다. local history의 validating → 원자 반영 → completed 순서와 실패 rollback에 index·모든 source/metadata·HTML을 함께 포함한다. 반영 중 관련 없는 사용자 편집은 유지한다.

서버는 일반 outputs에 더해 해당 HTML과 연결된 **새 revision 하나 및 index 변경**만 허용한다. 기존 revision 변경·과거 revision 재사용·다른 게임 identity 변경/탈락·추가 파일·source/metadata/hash 누락은 거절한다. 성공은 기존 서버 durable commit/히스토리를 사용한다. 서버 commit 뒤 클라이언트의 cache 저장·탐색기용 사본 준비는 기존 별도 수명을 유지하며 새 저장 경로로 우회하지 않는다.

## 검증과 후속

`tests/game-build-workflow.test.mjs`, `server-ai-start`와 기존 회귀는 기본 `npm test`에 포함된다. 실제 동봉 도구는 `tests/game-build-runtime.mjs`, 실제 Windows IPC/CLI fixture/HTML 검사/로컬·공동 반영은 `tests/game-build-execution-packaged.mjs`로 확인한다. `GAMEJAM_PUBLIC_BUILD=1`은 후자에서 실제 공개 Three.js 다운로드·bundle을 추가하는 검증 옵션이며 제품 동작의 우회 옵션이 아니다. 계정·유료 AI 호출은 사용하지 않는다.

`GAMEJAM_BUILD_TEST_GLB`에 단일 파일 GLB의 절대 경로를 지정하면 Windows 패키지에서 모델 가져오기, Three.js 빌드, 동일 원본을 쓰는 두 버전, 모델 노드 삭제, 히스토리 복원·재시작, 캔버스의 실제 WebGL 렌더링을 검사한다.

외부 단일 파일은 `tests/game-build-browser.mjs`로 Windows Chrome/Edge에서 확인한다. 실제 수행 결과와 모의 경계는 [4단계 보고서](../audits/2026-11-02-game-build-stage4.md)에 기록한다. source 기반 수정/버전/복원은 [5단계](game-build-editing.md), HTML 내보내기·재가져오기·상태 UI는 [6단계](game-build-transfer.md)에 연결했다. 실제 네 계정과 게임/아트 전체 품질 검증은 7단계다.
