# 게임 제작 원본·준비·독립 HTML 구현 계약

2026-11-03. [ADR 0006](decisions/0006-game-builds-and-standalone-html.md)에 따른 1차 구현 계약이다. **1~3단계 저장·지침·준비를 4단계 source/workflow v2/독립 HTML 빌드에 연결했다.** 새 gamejam HTML 요청은 [제작 실행](game-build-execution.md)을 사용한다. 5단계의 [원본 수정·버전·복원](game-build-editing.md)과 6단계의 [HTML 입출력·상태 UI](game-build-transfer.md)를 구현했다. [7단계](../audits/2026-11-03-game-build-stage7.md)는 합의한 Codex 실제 제작·공통 기능 검증을 완료했고 다른 AI 3종의 실제 계정 검증은 보류했다. 현재 AI 실행은 [AI 실행](ai-execution.md), 지침 구현은 [요청 지침](task-instructions.md), 현재 준비 서비스는 [의존성 준비](dependency-preparation.md)를 따른다. 단계별 실제 검증 범위는 각 보고서와 [1차 계획](../plans/2026-11-01-game-build-phase1.md)을 따른다.

## 현재 구현한 저장 기능

- 공개 타입은 `contracts/game-build.ts`의 `GameBuildIndexV1`, `GameBuildManifestV1`, `GameBuildDependenciesV1`, `GameBuildNoticesV1`, `GameBuildLimits`, `ProjectStoragePolicy`다. 실제 형식의 기준은 이 타입과 `core/projects/game-build.ts` 검증이다.
- `readGameBuild`는 완전한 snapshot을 검사한 뒤 원본·lock·고지를 읽는다. `appendGameBuild`는 새 revision·현재 HTML·결과 연결 목록을 하나의 후보 snapshot으로 만든다. 저장 자체는 기존 repository/applyChanges/히스토리를 사용한다. 4단계 v2 workflow가 이 writer로 source·lock·고지·HTML 후보를 만들고 기존 반영 경로를 사용한다.
- `.game-builds/index.json`의 `{version:1, artifacts:[{artifactId,buildId,path}]}`가 저장 형식 marker와 현재 결과 연결을 소유한다. `path`는 현재 HTML 위치다. immutable manifest의 `output.pathAtCreation`은 제작 당시 위치이므로 이동 때 재작성하지 않는다. 현재 revision의 HTML hash/크기는 검증하고 과거 revision의 출력 hash는 제작 당시 사실로 남긴다.
- 파일·폴더 대소문자 불일치, 파일/폴더 경로 충돌, Windows 장치 이름·외부 junction, 누락/추가 source, hash 불일치, 지원하지 않는 저장 버전을 거절한다. 일반 쓰기는 완료 revision을 덮어쓰지 않는다. 전체 히스토리/Undo는 기존 신뢰된 복원 경로를 사용한다.
- `captureProject`는 중단된 쓰기를 복구할 수 있도록 불완전한 추적 파일도 읽는다. capture 자체를 검증 완료로 간주하지 않는다. 완성 후보의 reader/writer·서버·apply에서 정합성을 검사한다. 자체 atomic writer의 UUID `.tmp`만 capture에서 제외하며, build namespace의 cache나 기타 파일은 거절한다.
- 저장 지원은 `gameBuildStorageVersion:1`과 실제 `gameBuildStorageLimits`로 health/state에 광고한다. 4단계 생성 지원은 별도의 `gameBuildVersion:1`과 workflow v2로 구분한다. 현재 snapshot의 marker는 state의 `fileGameBuildStorageVersion`에도 표시한다. 새 형식이 없는 기존 프로젝트는 그대로 열린다.
- 6단계의 선택적 `documents[].designSha256`은 본문·의미 있는 metadata의 안정 비교 값이다. 기존 `sha256`은 당시 전체 입력 파일의 사실로 유지한다. 좌표·크기·색·캔버스·갱신 시각 등 표시용 변경을 요구 변경으로 표시하지 않는다. 예전 hash만으로 비교할 수 없으면 unknown이며 과거 revision을 재작성하지 않는다. 복사 시 ID/path를 다시 연결한 문서의 designSha256은 제거한다.
- 로컬 에셋 연결은 각 revision의 `assets`에 별칭·형식·프로젝트 상대 경로·원본 SHA-256·바이트 수를 기록한다. 여러 버전이 기존 원본 하나를 참조한다. BLEND는 `.gamejam/local/game-models`의 변환된 GLB 경로·해시도 고정한다. 공동 저장 검증은 로컬 참조를 거절한다.

## 범위와 책임

- Windows 앱과 Windows Chrome·Edge가 1차 검증 환경이다. Codex/Claude/Gemini/Grok은 같은 preparation 계약을 사용한다.
- 사용자 문서는 기존 docs 구성에 통합한다. 소스 보존은 1차 필수이며 사용자용 코드 편집기는 후속이다.
- 단일 HTML을 기본 import/export로 유지한다. 외부 참조 HTML의 자료 자동 수집, 이미지 검색·생성, 자동 화면 평가·수정, 모바일, ZIP, 결제/quota 합산은 제외한다.
- contracts는 버전·DTO, core는 검증·경로·정합성 계산, application은 순서·실패·확정, adapters는 registry/문서/파일/빌드 프로세스, desktop은 도구 조립·Electron 검사·export, server는 권한·협상·결과 검증·저장을 소유한다. UI는 runtime을 사용한다.

## 데이터와 식별

### 정식 프로젝트 데이터

| 종류            | 필수 내용                                                                                                          | 보호·수정 원칙                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 원본 자료       | 선택 문서/이미지/HTML 경로·ID·SHA-256                                                                              | 원본 아이디어와 참고 자료는 읽기 전용                                   |
| 시스템 문서     | 규칙·아트·화면·연출·선택 이유·사용자 요구/AI 제안/미정 구분                                                        | 사용자 편집 가능. AI가 갱신할 문서는 명시적 target·baseline 지정        |
| 제작 소스       | entry·htmlTemplate와 상대 source 목록, 내용/크기/hash                                                              | result별 revision에 속함. 허용 상대 경로·확장자·개수·총량 검사          |
| 에셋 참조       | 선택 asset ID/path/hash, 역할, 필요 시 frame 정보                                                                  | 원본을 덮어쓰지 않으며 snapshot 안의 추적 자산을 참조                   |
| dependency lock | exact version, registry source/resolved/integrity, transitive graph, license                                       | 임의 수정 때 최신 버전으로 재해석하지 않음                              |
| build manifest  | artifact/build ID, entry, 파일 hash, 문서 baseline, instructions/tool/profile 버전, lock hash, 최종 HTML 경로/hash | 구현에 사용한 사실과 검사 범위를 기록                                   |
| 최종 HTML       | 내장 코드·에셋·고지와 inert provenance                                                                             | 외부 경로·cache 없이 실행. 최종 hash는 manifest에 두어 자기 참조를 피함 |

`artifactId`는 결과의 이동에도 유지되는 식별자다. 기존 결과 catalog/출처 ID 정책과 결합하되 HTML 경로 hash만을 새 원본의 identity로 사용하지 않는다. `buildId`는 완료된 제작 revision의 고유 ID다. 새 버전과 기존 결과 업데이트 모두 새로운 build revision을 만들고 현재 결과가 그 revision을 가리킨다. 완료 revision은 사용자 수정으로 덮어쓰지 않는다.

### 논리 경로와 실제 경로

새 source 저장 namespace는 `.game-builds/<buildId>/`로 정한다. 구체적인 snapshot key는 다음과 같다.

```text
.game-builds/index.json
.game-builds/<buildId>/manifest.json
.game-builds/<buildId>/dependencies.lock.json
.game-builds/<buildId>/notices.json
.game-builds/<buildId>/source/<relative-source>
docs/<사용자가 선택한 문서명>.md
assets/images/<기존 추적 에셋>
output/<기존 분류>/<기능>/vNNN/index.html
```

- layout v2 물리 위치는 filesystem adapter가 `.game-builds`를 `.gamejam/project/builds`로 변환한다. layout v1은 `.game-builds`를 사용하고 자동 layout 전환은 하지 않는다. stage/history는 기존대로 논리 경로를 materialize한다.
- `.game-builds`는 완성 원본이며 삭제 가능한 cache가 아니다. capture/materialize·watcher·mirror·서버 경로 allowlist·크기 검사·copy·move·delete·history·backup에 포함해야 한다.
- source는 UTF-8의 `.js`, `.css`, `.json`, `.html`이며 entry는 `.js`다. snapshot의 전체 논리 경로는 240자 이내다. node_modules·숨김 파일·절대 경로·`..`·외부 symlink·대소문자 충돌·장치 이름을 거절한다. 파일 허용은 컴파일/실행 지원의 인증이 아니다.
- asset은 기존 `assets/images/`의 추적 파일에 연결한다. manifest의 `assets[].key`는 build 안에서 고정된 별칭이고 `path`는 프로젝트 파일 위치다. 복사 시 path와 식별자를 새로 연결하므로 source의 별칭은 유지한다. source에 PC 절대 경로를 넣지 않는다. hash는 기존 encoded snapshot 문자열의 UTF-8 SHA-256이다. 문서 baseline의 path/ID/hash는 당시 사실이므로 이후 사용자 편집·삭제가 가능하다.
- lock은 exact version·HTTPS resolved·sha512 integrity·package key별 직접/간접 연결·license를 보관한다. notices는 모든 lock package의 license와 고지 본문을 포함한다. 저장 계층은 내부 정합성을 검사하며 실제 registry 조회/다운로드 무결성 확인은 3단계 준비 adapter가 소유한다.
- 이동은 같은 artifact/build를 유지하며 HTML 경로 참조를 기존 결과 이동과 함께 바꾼다. 프로젝트 간 복사는 새 artifact/build ID를 발급하고 참조를 remap한다. 선택 source와 필요한 추적 asset을 함께 복사하며 로컬 cache·인증·임시 경로를 복사하지 않는다.
- 참조 없는 revision의 자동 GC는 1차에서 하지 않는다. 삭제/휴지통/복원은 기존 결과 수명과 연결하고, history가 참조하는 원본을 cache 정리로 제거하지 않는다.

### 로컬 cache와 도구

다운로드 tarball, node_modules, build workspace는 프로젝트 밖의 앱 전용 cache와 실행별 temp에 둔다. 현재 `.gamejam/local` 전체를 cache로 취급하지 않는다. 3단계에서 app resource의 별도 `game-build-runtime` 디렉터리와 파일별 hash manifest를 구현했다. 배포본은 매번 무결성을 확인하며 추출 node_modules는 재사용하지 않는다.

도구 manifest에는 Node/npm/Rolldown/native binding의 정확한 버전·OS·arch·실행 파일 SHA-256·라이선스가 필요하다. cache identity는 toolset digest, lock digest, OS/arch, build 설정·implementation digest로 정하고 재사용 전 파일 무결성을 검사한다. cache miss는 다시 준비하며 고장난 cache를 강제로 재사용하는 옵션은 만들지 않는다.

## 생성 DTO와 wire 계약

위 저장 타입과 2단계의 EffectiveInstructionsV2 외에 `PreparedDependenciesV1`은 3단계, `GameBuildSourceV1`은 4단계의 실제 DTO다. 별도 `GameBuildPlanV1`과 `GameBuildLimitsV1` 이름은 현재 공개 API로 구현하지 않았다. manifest와 한도의 현재 이름·필드는 위 실제 저장 타입을 따른다.

| 계약                     | 내용                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `GameBuildPlanV1`        | 사용자 문서 output/update 대상, 비주얼 의도, entry/source 계획, library 후보 또는 조사 요청, 에셋 역할                          |
| `PreparedDependenciesV1` | 현재 구현: 확정 lock·고지·자료 출처/해시·module specifier·OS/arch·도구 digest·선택 이유·경고. 브라우저 profile 통과는 후속 검사 |
| `GameBuildSourceV1`      | 고정 build namespace의 정확한 entry/소스 목록·asset 참조                                                                        |
| `GameBuildManifestV1`    | 입력·문서·source·lock·HTML·도구·검사 provenance                                                                                 |
| `GameBuildLimitsV1`      | 파일/소스 묶음/전송 등의 기술 한도. 서비스 구독 DTO와 분리                                                                      |

현재 새 gamejam HTML 작업은 `gamejam_workflow_version: 2`/`game_build_version:1`, 생성 capability는 `gameBuildVersion:1`을 사용한다. 현재 구현한 `gameBuildStorageVersion:1`은 저장 지원만 뜻하며 index의 version 1과 대응한다. workflow·생성·저장 지원을 서로 대신 사용하지 않는다.

- `/health`와 인증 state에 같은 capability를 광고한다. 구현이 완성되기 전 광고하지 않는다.
- 새 클라이언트는 요청 작성/서버 예약/실행 전 capability를 검사한다. local 실행에는 서버 capability를 요구하지 않는다.
- 서버는 v2 create/approval/reserve/claim/begin/finish에 build version을 검사한다. unsupported 버전은 쓰기 전에 거절한다.
- build 데이터가 들어간 프로젝트는 state·join·생성 재시도·mutation 요청의 저장 version을 검사한다. lifecycle 우회도 막는다. 현재 원본이 없는 프로젝트에 history/Redo로 원본을 다시 넣는 경우도 후보 snapshot의 version을 검사한다. 알 수 없는 파일을 버린 snapshot을 성공으로 돌려주지 않으며 `GAME_BUILD_STORAGE_UNSUPPORTED`(409)와 업데이트 안내를 제공한다.
- v1 명세와 기존 `gamejamWorkflow` boolean은 유지한다. boolean만으로 v2 지원을 추정하지 않는다. new task를 old format으로 몰래 줄여 실행하지 않는다.
- 새 marker·capability가 없어도 기존 프로젝트와 독립 HTML은 현재 경로로 열린다. 사전 전체 데이터 migration은 요구하지 않는다.

## 단계 교환과 CLI 호출

```text
요청 저장·effective 지침 고정
→ 설계/조사 요청 작성(AI)
→ registry/공식 자료/lock 준비(앱)
→ 필요 시 후보 확인(AI ↔ 앱, bounded)
→ 소스 작성(AI)
→ standalone bundle·에셋 포함(앱)
→ 정적·리소스·실행·한도 검사(앱)
→ 기존 local/shared 확정 경로
```

- 문서 정리를 선택한 경우 사용자 문서 산출과 기술 계획을 가능한 한 같은 AI 단계에 묶는다. 구현만 선택한 경우에도 최소 설계/준비 계획은 확보한다. 문서만 정리하는 기존 작업은 불필요한 build를 실행하지 않는다.
- 파일 도구만 있는 공급자는 예약된 내부 exchange 파일에 준비 요청을 쓴다. 앱이 JSON schema·범위·횟수를 검증해 도구를 실행하고 다음 CLI 입력에 사본을 전달한다. CLI가 네트워크 도구를 가지고 있다고 가정하지 않는다.
- 새 artifact capture는 공개 사용자 output, 내부 exchange, 최종 source bundle을 별도로 구분한다. 현재 Markdown/HTML `expectedArtifacts` 검사를 전역적으로 느슨하게 만들지 않는다.
- plan에 없는 새 외부 의존성이 소스에 등장하면 자동 설치하지 않는다. bounded 준비 단계로 돌아가거나 구체적 오류로 종료한다. 조용히 다른 엔진/도형으로 대체하지 않는다.
- 기본 준비 교환 한도는 최대 3회, 전체 준비 시간은 180초를 초기 설계값으로 둔다. 사용자 지시 재질문 없이 작은 누락은 단계 입력으로 해결하되 무한 loop를 허용하지 않는다. 실제 비용·시간은 통합 검증에서 재평가한다.
- 모든 AI/도구 단계는 같은 run/session/lease에 속한다. AbortSignal·process tree·다운로드를 취소하고, 오래된 callback과 다른 프로젝트의 결과를 버린다. 기존 상태 enum의 의미를 유지하며 상세 phase를 progress로 표현한다.

## 지침·문서·수정

**현재 2단계 구현:** template 1판 보관본과 현재 2판, request의 instructionOrigins, task의 EffectiveInstructionsV2·TaskDesignContextV1을 사용한다. taskInstructionsVersion:2는 지침/맥락 지원이다. 새 gamejam HTML 요청은 별도 생성 capability의 workflow v2를 사용하고 과거 workflow v1은 유지한다. 원본 선택 자료와 원래 지시를 정리 문서와 함께 HTML 단계에 전달하고, 사용자 편집 시스템 문서를 제작 기준으로 사용한다. 새 기본 문서 구성은 개요·핵심 플레이·비주얼 설계·모호한 점이며 기존 사용자 구성은 자동 교체하지 않는다. 5단계의 explicit update target과 source/lock 기반 수정은 [원본 수정](game-build-editing.md)을 따른다.

새 요청의 기본 지침과 사용자 지시를 분리해 저장한다. 최신 지침 적용은 **새 요청을 만들 때**만 한다. 기존 task·예약·실행·과거 기록은 재작성하지 않는다. 예전 default와 정확히 대응하는 내용만 갱신하며 edited/구분 불가 내용은 보존하고 충돌을 표시한다. 최신 기본 지침 적용과 기존 게임의 exact dependency lock 유지는 독립이다.

문서 출력 구성·ID·섹션·출처를 보존한다. 원본 아이디어는 read-only다. 게임과 함께 갱신할 기존 시스템 문서는 explicit update target·baseline으로 선언한다. 현재의 단순 `outputs ∩ inputs` 금지에 예외를 무작정 추가하지 않고, read-only 입력과 승인된 update target을 v2 계약에서 구분한다.

사용자가 저장한 변경 문서는 run 시작 baseline이다. AI 실행 실패 때 그 사용자 변경까지 되돌리지 않는다. AI가 stage에서 만든 문서 수정·소스·HTML만 최종 검증 후 반영한다. 문서만 작성하는 작업은 별도 정상 완료할 수 있다. '기준 이후 문서 변경'은 hash/revision 차이의 사실이며, 실제 미구현/완료를 자동 추정하지 않는다.

수정 요청은 현재 소스·문서·lock·기존 HTML을 입력으로 사용한다. 설계 변화가 없으면 문서를 다시 쓰지 않는다. 결과 update도 새 build revision을 만들어 기존 before/after history와 연결한다. source가 없는 imported HTML은 source provenance가 없는 legacy 입력으로 처리하고 필요 시 새 source bundle을 생성한다.

## 준비·번들·profile

- 공개 npm package metadata에서 exact version을 결정하고 registry integrity와 lock을 확인한다. npm lifecycle script는 기본 실행하지 않으며 user/global config와 credentials를 도구 사본에 복사하지 않는다. registry package 외 출처나 필수 install hook은 현재 adapter에서 명시적 미지원으로 보고한다.
- Rolldown browser platform, 단일 entry, IIFE, code splitting off를 초기 profile로 사용한다. executable import가 남거나 파일이 추가 emit되면 자동 성공 처리하지 않는다. 정적 string으로 확정한 dynamic import는 실제 inlining 결과를 검사한다. inline bundle 소스에 arbitrary plugin/eval 실행 권한을 주지 않는다.
- product resolver는 선언된 source workspace와 검증된 dependency root만 읽는다. source의 절대/file/외부 URL import, root 밖 참조, Node builtin 요구를 구체적 오류로 분류한다. tool 환경에는 필요한 OS/runtime 변수만 전달하고 AI 인증·사용자 package 설정을 전달하지 않는다. 0단계의 고정 fixture 실행을 임의 입력의 보안 검증으로 간주하지 않는다.
- 전체 archive/node_modules를 AI context나 server snapshot에 넣지 않는다. model에는 필요한 API 자료와 module/asset 계약만 전달한다. source에는 정상 module import를 작성하고 builder가 의존성을 포함한다.
- library comments 유지에 더해 전체 필요한 고지를 최종 HTML의 inert JSON/텍스트에 포함한다. notices는 정확한 의존성 provenance와 연결한다.
- 초기 공통 profile: DOM/CSS/Canvas2D/WebGL, 내장 JS/CSS, data URI 자산. 이미지를 통해 생성한 blob URL은 실제 profile 검증 결과에 따라 허용한다. 모든 blob이 차단된다고 판단하지 않는다.
- Pixi의 `pixi.js/unsafe-eval` 모듈은 이름과 달리 eval을 피하는 대체 구현을 설치한다. 0단계에서 8.22.0의 해당 source와 실행을 검증했다. 현재 준비 경로의 간접 고지 누락 제약은 별도 준비 보고서를 따른다. 라이브러리별 준비 자료에서 이런 요구를 전달하되 CSP를 포괄적으로 완화하지 않는다.
- blob worker와 WASM compilation은 현재 player CSP에서 실패했다. WebGPU는 srcdoc opaque origin에서 제공되지 않았다. 해당 기능이 필수면 현재 공통 profile 지원 불가를 보고한다. 향후 별도 검증·profile 변경 없이 지원한다고 광고하지 않는다.

## 실행 검사·출력

4단계에서 validator의 대형 data URL navigation을 작은 격리 shell + renderer IPC/sandbox iframe srcdoc 전달로 교체했다. 원래 error/rejection/ResizeObserver 분류와 timeout을 보존하고 ready 메시지의 frame source/channel identity를 검사한다. 오류는 해당 격리 window의 브라우저 console 이벤트로 수집하며 이미지 decode/font 준비·리소스 실패를 추가로 확인한다. 온라인 검사 harness도 큰 game source를 renderer IPC로 전달한다.

preview는 sandbox, player는 CSP와 SDK, 외부 file 브라우저는 별도 실행 환경이다. 세 경로를 공통이라고 가정하지 않는다. 첫 단계의 실행 검사는 전체 플레이/아트 품질 보장이 아니며 1차 자동 스크린샷 평가·수정은 구현하지 않는다.

export는 저장된 **최종 원본 HTML**을 복사한다. iframe keyboard bridge, 앱 debug code, 로컬 path, task·인증·임시 정보를 추가하지 않는다. external browser용 온라인 SDK server 연결은 1차에서 제공하지 않는다. 기존 SDK가 필요한 게임은 앱 실행 조건을 알린다.

import는 inert parser로 형식·크기·외부 참조를 검사한다. embedded build metadata는 비신뢰 참고 정보다. metadata의 command·local path·URL을 자동 실행하거나 기존 프로젝트 source와 ID만으로 결합하지 않는다. 새 result identity를 부여한다. dependency 추출 정보만으로 임의 패키지를 자동 설치하지 않는다.

## 저장·한도·확정

새 build 파일의 허용 범위를 기존 capture/동기화/원자 apply/히스토리/복구에 연결한다. build별 파일 목록과 hash, read-only baseline, update target, session, lease를 검사하고 정확한 결과 목록을 서버가 재검증한다. 임시 exchange·cache·node_modules는 서버 finish payload가 아니다.

### 기술 한도와 quota

| 항목                            | stage1의 초기 구현 목표값      | 근거·주의                                                         |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| 최종 HTML                       | 공동 8,000,000 bytes           | 로컬 HTML에는 고정 크기 제한을 두지 않는다                        |
| source 한 파일                  | 2,000,000 bytes                | 모델 출력·정적 분석 비용 제한. 현재 문서 한도와 별개 필드         |
| source 묶음                     | 16,000,000 bytes / 64개 source | 허용 출력 계약·누적 비용 제한. 패키지 전체 저장에 사용하지 않음   |
| 기존 이미지 원본                | 5,000,000 bytes 유지           | 가져오기 형식과 encoding 검사 재사용                              |
| 한 snapshot/명령의 기술 payload | 64,000,000 bytes               | synthetic JSON roundtrip 측정. 전체 동시 HTTP/DB 부하 보장은 아님 |
| HTTP body                       | 72,000,000 bytes               | envelope 포함 여유. 기존 endpoint도 크기 수신 전에 상한 검사      |

이 값은 **저장 v1의 구현값**이다. 파일은 총 500개, lock/notices/manifest/index 각각 2MB다. 원본 marker가 없는 legacy snapshot은 20MB, HTTP는 storage header가 없으면 기존 22MB를 유지한다. 새 앱은 `X-Game-Build-Storage-Version:1`을 전송하며 해당 HTTP 상한은 72MB다. 로컬 검증에서 관리 대상 HTML은 snapshot 바이트 합계에서 제외한다. 파일 형식·해시·기록 연결 검사와 나머지 바이트·파일 수 한도는 유지한다.

HTTP는 Content-Length를 읽기 전에 검사하고 chunked body도 누적 검사한다. 서버별 최대 4개 POST·총 96MB의 body 예약을 유지하며 초과는 `REQUEST_CAPACITY`(503, Retry-After)로 거절한다. JSON 파싱·프로젝트 큐·commit·응답 전송이 끝날 때까지, 연결이 먼저 끊겨도 업무가 끝날 때까지 예약을 보유한다. 이 값은 전체 프로세스 RSS 상한이 아니다. 실제 60,857,902바이트·32 revision의 HTTP→SQLite→백업 복원을 검증했고 측정 RSS와 부하 한계는 1단계 보고서에 기록한다.

로컬 총 저장은 남은 디스크와 원자 저장 실패로 처리하고 서비스 quota를 부과하지 않는다. 자체 서버는 `storagePolicy.maxProjectBytes`/`GAMEJAM_MAX_PROJECT_BYTES`로 프로젝트별 정책을 선택하며 기본은 별도 quota 없음이다. 실제 commit 전에 snapshot UTF-8 누적 바이트를 검사한다. 한도 초과 기존 프로젝트도 읽기·동일 크기/감소 쓰기는 가능하고 증가 쓰기는 `PROJECT_STORAGE_LIMIT`(413)로 거절한다. health/state의 `projectStoragePolicy`로 설정을 알린다. 이는 디스크 전체 점유량·히스토리 보존량·사용자별 과금 한도가 아니다.

현재 전체 snapshot 통신은 기술 payload보다 큰 프로젝트 전송을 해결하지 못한다. GB 단위 서비스 전에 delta/blob 분할 전송이 별도 필요하다. 사용자별 구매/합산/배분은 후속이다.

## 단계1 선행 조건과 검증 연결

0단계 결과로 계약·위치를 확정했고 1단계에서 저장 DTO·reader/writer·서버 검증·capability·copy/history/recovery를 구현했다. 아래 검증 기준은 후속 변경에도 적용한다.

- TypeScript 변경: typecheck, contracts/core 변경 시 strict 검사.
- 소스 경계·runtime·검사 변경: test:architecture. 새 예외 없이 구현.
- snapshot/AI/동기화/결과 수명: 영역별 회귀와 실제 package 검증.
- 도구/profile 변경: stage0 fixture 또는 후속 실제 integration에서 동작 검증. 현재 결함을 영구 요구사항으로 고정하지 않는다.
- 모든 AI의 실제 생성·문서 roundtrip·다중 PC·복구·입출력은 단계7까지 별도 검증한다.
