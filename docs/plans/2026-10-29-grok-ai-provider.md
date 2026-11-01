# Grok AI 공급자 추가 조사와 구현 계획

작성: 2026-10-29. 상태: **구현·로컬 검증 완료, 실계정 검증 미수행**. 사용자 표현의 “글록 AI”를 xAI Grok으로 해석했다. 아래 1~5절은 최초 조사·계획이며, 실제 구현 판단과 검증은 6절 및 ADR 0002를 우선한다.

## 1. 추천 방향과 범위

공식 **Grok Build CLI**를 네 번째 로컬 공급자 `grok-cli`로 추가한다. 기존 Codex·Claude·Gemini와 같은 문서 정리, HTML 구현, 정리→구현 연속 실행, 예약, 승인, 결과 검증·히스토리를 사용한다.

AI 실행·인증은 개인/관리자 PC에 남기고, 협업 서버는 기존 권한·예약·lease·공동 결과 확정만 담당한다. 앱 자체의 서버 연결·서비스 로그인·구독은 개인 실행의 전제 조건으로 만들지 않는다. Grok 공급자 인증과 이용 권한은 별도로 필요하다.

우선순위는 **Windows CLI 적합성 확인 → 로컬 연결 → 예약·승인·협업 호환 → 실제 패키지 검증**이다. Windows에서 필요한 도구·설정 제한을 확인하기 전에는 사용 가능으로 노출하지 않는다.

직접 xAI HTTP API 연동, 앱 안 API 키 입력·보관, 자체 도구 실행 루프, 웹/X 검색, 이미지·영상 생성, 서버에서의 AI 실행은 이번 범위에서 제외한다. 직접 API 경로는 CLI 적합성 확인에서 해결할 수 없는 문제가 발견될 때 별도 대안으로 평가한다.

## 2. 공식 자료에서 확인한 사실

| 항목               | 확인 내용과 구현상 의미                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공식 코딩 에이전트 | Grok Build는 대화형 실행, headless, ACP를 제공한다. Windows 설치 안내도 있다. 일반 채팅 API만 있는 공급자는 아니다. [시작 안내](https://docs.x.ai/build/overview)                                                                                                                                                                                                            |
| 설치·인증          | 공식 배포 대안으로 `npm install -g @xai-official/grok`을 안내한다. `grok login`, device-code 로그인, `XAI_API_KEY`를 지원한다. 앱은 CLI의 인증을 재사용하며 키·토큰을 공동 데이터로 보내지 않는다. [배포·인증](https://docs.x.ai/build/enterprise)                                                                                                                           |
| 실행·출력          | `grok -p <PROMPT>`, `--model`, `--cwd`, `--output-format streaming-json`을 안내한다. streaming-json은 NDJSON이며 자동 업데이트를 끄는 옵션도 안내한다. 정확한 이벤트 schema와 일반 headless의 stdin 동작은 실물 확인 대상이다. [Headless](https://docs.x.ai/build/cli/headless-scripting)                                                                                    |
| CLI 옵션           | 모델 목록은 `grok models`, 버전은 `grok version`, 설정 탐색은 `grok inspect --json`으로 확인할 수 있다. `--tools`, `--disallowed-tools`, `--allow`, `--deny`, `--effort`, `--no-plan`, `--no-subagents`, `--no-memory`, `--disable-web-search` 등이 문서화돼 있다. 옵션의 존재와 필요한 격리가 실제로 작동하는지는 별개다. [CLI 참조](https://docs.x.ai/build/cli/reference) |
| 권한               | 도구 허용/거부와 OS 샌드박스는 다른 기능이다. always-approve에서도 deny·PreToolUse hook이 적용된다고 안내한다. 기본 구현은 파일 도구만 명시적으로 허용하고 전체 자동 승인에 의존하지 않는다. [권한](https://docs.x.ai/build/features/permissions)                                                                                                                            |
| 샌드박스           | 기본값은 off이고 공식 설명은 Linux Landlock·macOS Seatbelt를 명시한다. 이 자료만으로 Windows의 같은 보장을 주장할 수 없다. 작업 사본과 사후 산출물 검증도 프로세스의 외부 접근 방지와 구분한다. [샌드박스](https://docs.x.ai/build/features/sandbox)                                                                                                                         |
| 설정 상속          | `GROK_HOME`은 인증뿐 아니라 설정·세션·플러그인·로그 위치도 바꾼다. 프로젝트 `.grok/config.toml`은 MCP·plugins·permission만 기여한다. Cursor·Claude 설정 탐색도 기본 활성화여서 실행별 차단 검토가 필요하다. [설정 참조](https://docs.x.ai/build/settings/reference), [설정 범위](https://docs.x.ai/build/settings)                                                           |

### 모델·비용 판단

직접 연 공식 모델 페이지는 현재 `grok-4.7`을 안내한다. 일부 검색 요약·이전 소개에는 4.6이 남아 있어 검색 요약만으로 모델 목록을 고정하지 않는다. [현재 모델](https://docs.x.ai/developers/models)

API 가격표 기준, 100만 토큰당 짧은 문맥 입력/출력은 `grok-4.7` $2/$6, `grok-build-0.1` $1/$2다. 두 모델 모두 입력 200k 이상에서는 각각 $4/$12, $2/$4이며, 문맥 한도는 500k와 256k다. 이는 API 단가이며 로그인 기반 CLI의 구독 혜택·잔여 한도·이용 가능 모델을 보증하지 않는다. [가격표](https://docs.x.ai/developers/pricing)

첫 버전은 “자동 선택”을 기본으로 한다. 명시 모델 후보는 `grok-4.7`, `grok-build-0.1`이지만 실제 CLI `grok models` 결과와 실행 호환성을 확인한 항목만 제공한다. CLI의 `grok-build` 별칭과 API의 `grok-build-0.1`을 동일 식별자로 단정하지 않는다. 추론 수준은 모델별 허용값까지 검증하기 전에는 기본값만 제공한다.

## 3. 현재 구조와 변경 소유권

기준: [아키텍처 안내](../architecture/README.md), [AI 실행](../architecture/ai-execution.md), [서버 AI 실행](../architecture/server-ai-run.md), [회귀 검사](../architecture/regression-matrix.md) 및 아래 실제 코드.

| 영역           | 현재 구현                                                                                        | 필요한 변경                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 공통 계약      | `src/contracts/ai.ts`의 공급자 union은 세 종류                                                   | `grok-cli` 추가. 기존 provider/model/effort 필드와 `codex:*` IPC 유지          |
| 순수 목록·검증 | `src/core/ai/catalog.ts`가 UI·실행 검증에 공용                                                   | Grok 표시·설치·로그인·검증된 모델 추가. 기존 카탈로그 재사용                   |
| 인자·이벤트    | `src/adapters/node/ai/providers.ts`가 삼항식으로 분기                                            | Grok 전용 adapter 추가, 알 수 없는 공급자가 Gemini로 흘러가지 않도록 명시 분기 |
| CLI 탐색·상태  | `discovery.ts`는 Claude 외 공급자를 Gemini로 취급                                                | Grok 실행 파일·설치 형태·버전·필수 옵션·인증 probe를 독립 처리                 |
| 프로세스       | `src/desktop/ai/node-executor.ts`가 cwd=stage, shell=false, stdin=prompt, UTF-8·취소 처리        | Grok의 입력 방식만 좁게 확장. 프로세스 수명·취소 구현 재사용                   |
| 실행별 설정    | `src/desktop/ai/stage-workspace.ts`는 Gemini 설정만 생성                                         | 검증된 Grok 실행별 설정을 연결. 사용자 설정 덮어쓰기 금지                      |
| 업무 흐름      | `application/ai/run-service.ts`, `run-coordinator.ts`, `queue-service.ts`, `approval-service.ts` | 기존 stage·세션·검증·반영·예약 경로 재사용. 별도 Grok 업무 서비스 불필요       |
| 초안·히스토리  | `src/gamejam-history.ts:readSavedRequest`에 세 공급자 직접 열거                                  | 공용 `isAiProvider`로 통일. Grok 초안이 복원 시 버려지는 문제 방지             |
| UI             | 연결, 요청, 승인, Discord 설정은 대부분 `AI_PROVIDERS`를 순회                                    | 목록 재사용, 연결·정책 안내 검토. UI의 직접 CLI/HTTP 호출 금지                 |
| 개발 mock      | `src/dev-api.ts`, `tests/mocks/process.ts` 등은 세 공급자 가정                                   | 실제 입력·이벤트 구조에 맞는 Grok fixture 추가                                 |
| 협업           | 서버 `ai-coordinator.ts`는 공용 공급자 검증 사용. envelope는 `multiProviderAi: true`             | 새 공급자 검증과 구버전 서버 능력 구분을 함께 처리                             |

현재 non-Codex 프롬프트는 “파일 도구만 사용”을 전제로 하고, 선택 이미지의 `gamecanvas-asset:` 참조를 앱이 data URI로 바꾼다. Grok도 이 전제를 실제로 충족하도록 연결하고 기존 `embedSelectedAssets` 경로를 재사용한다. 프롬프트 문구 자체를 접근 제어로 취급하지 않는다.

## 4. 구현 순서

### A. CLI 적합성 확인 — 기능 노출 전 완료

이 PC의 현재 셸에서는 `grok` 명령을 찾지 못했다. 아래는 아직 검증하지 않은 선행 작업이다.

1. 공식 Windows 배포의 실행 파일/launcher 구조, 버전·help 출력을 확보한다. 비슷한 이름의 비공식 npm 패키지와 구분한다. 검증 버전을 기록하고 실행 중 자동 업데이트를 끈다.
2. headless 입력 전달을 확정한다. 현재 executor처럼 stdin으로 보내도 되는지 검증하고, 지원이 없다면 **고정된 짧은 `-p` 지시 + stage의 작업 명세 읽기**를 우선 검토한다. 사용자 본문 전체를 명령행에 넣어 길이·노출 문제를 만들지 않는다. 고정 지시는 기존 `aiRunPrompt`의 보호 규칙을 유지해야 하며, 필요하면 앱이 만든 실행별 지시 파일을 읽게 한다.
3. 실제 streaming-json의 시작·본문·도구·종료·오류 fixture를 확보한다. 경고, 토큰 한도, 권한 거부, 인증 만료, 정상 exit와 실패 result의 조합을 구분한다. 확인 전 Claude 이벤트 schema를 복사하지 않는다.
4. Read/검색/Edit/Write에 필요한 실제 도구 이름과 허용 방법을 확인한다. 셸·MCP·웹·하위 에이전트·메모리·플러그인·hook이 실행되지 않는 조합을 검증한다. 전역/부모 디렉터리/호환 설정도 포함한다.
5. 인증 상태를 추론 호출 없이 확인할 방법을 정한다. 문서에 없는 `grok login status`를 가정하지 않는다. 공식 상태 명령이 없다면 ACP의 initialize/authenticate(headless)만 사용하는 제한된 probe를 검토하고 prompt는 보내지 않는다. 이때도 토큰 갱신 등 부작용·설정 로딩을 확인한다. 모델 권한·한도는 실행 시 별도 검증한다.
6. `GROK_HOME`을 바꾸면 로그인도 분리된다는 점을 검토한다. 개인 토큰 복사나 전역 설정 변경 없이 필요한 제한과 기존 CLI 인증을 함께 사용할 수 있어야 한다. 프로젝트 config만으로 모든 설정이 재정의된다고 가정하지 않는다.

**통과 조건:** Windows에서 무인 실행·출력 파싱·종료/취소·필요한 도구/설정 제한이 재현되고, probe가 과금 추론이나 대화형 로그인을 시작하지 않는다. 지원하지 않는 버전/설정은 명확한 업데이트·연결 오류로 거절한다. 한계가 남으면 CLI 방식의 제약을 기록하고 대안을 재평가하며, 조용히 unrestricted 실행이나 API 경로로 바꾸지 않는다.

### B. 계약·adapter·로컬 실행

- 계약과 catalog에 `grok-cli`를 등록한다. 미검증 모델·추론 수준은 추가하지 않는다.
- `src/adapters/node/ai/grok.ts`에 검증된 인자·이벤트 정규화를 둔다. 필요한 설정 생성과 인증 probe도 Node adapter가 소유한다. 새 코드는 contracts/core를 직접 import하고 임시 재수출을 새 의존 대상으로 삼지 않는다.
- `providers.ts`·`discovery.ts`의 공급자 분기를 명시적으로 바꾼다. Windows에서는 shell=false를 유지하고, `.cmd`를 임의로 cmd.exe에 넘기지 않는다. native 실행 파일 또는 확인된 launcher를 인자 배열로 실행한다.
- executor가 필요로 하는 인자/stdin/실행별 env 차이만 좁게 표현한다. 일반 플러그인 프레임워크나 별도 실행 큐를 만들지 않는다. 취소·UTF-8·중복 runId·단계 수명은 기존 구현을 유지한다.
- 정상 exit만으로 성공 처리하지 않는다. Grok의 오류 event와 앱의 필수 산출물·입력 보호·HTML 검증을 모두 적용한다. 입력 충돌, 반영 실패 복구, 세션 전환 후 늦은 결과 차단도 그대로 사용한다.
- 설치·로그인 안내는 `Grok · Grok Build`로 표시한다. API 키/토큰을 renderer, 프로젝트 파일, 실행 로그, 예약 JSON, 진단 출력에 넣지 않는다. 상태 확인과 실제 모델 이용 가능성을 구분해 안내한다.

### C. 초안·예약·승인·협업

- 초안·히스토리·재시도·개발 mock의 세 공급자 열거를 정리한다. 기존 데이터와 기본 공급자 의미를 유지한다.
- 예약의 provider/model/effort 고정, 재시작 후 복구, 앱/Discord 승인 실행 gate를 재사용한다. Grok 전용 저장소·승인 경로를 만들지 않는다. Discord 검증은 기존 mock transport를 사용한다.
- **구버전 서버 호환:** 기존 `multiProviderAi: true`는 Claude·Gemini 지원을 나타낼 뿐 Grok 지원의 증거가 아니다. `src/contracts/collaboration.ts`에 선택적 `supportedAiProviders` 목록을 추가하고 서버 `project-envelope.ts`에서 광고하는 방식을 제안한다.
- 새 클라이언트는 명시 목록이 있으면 그 목록을 사용한다. 목록이 없는 서버는 기존 capability에 따라 Codex 또는 기존 세 공급자까지만 허용한다. 로컬 Grok 실행은 이 서버 capability와 독립적이다. 카탈로그 전체를 구버전 서버의 지원 목록으로 해석하지 않는다.
- `collaboration-client.ts`와 `gamejam-validation.ts`를 포함해 일반 시작·예약·승인 시작 경로에 같은 지원 판정을 적용한다. 서버는 여전히 직접 입력을 검증하며 권한·lease 검사를 유지한다. UI에서만 막는 것으로 끝내지 않는다.
- 새 서버에서도 AI 프로세스·사용자 인증·과금은 실행하지 않는다. lease 손실 뒤 로컬 결과 반영으로 대체하지 않는다.

선택적 capability 추가는 공개 협업 계약에 영향을 주므로 채택 시 짧은 ADR로 대안(단일 grok 지원 플래그, 서버 버전 비교)과 fallback 규칙을 기록한다. 현재 AI 실행 문서와 회귀 검사 안내도 구현과 함께 갱신한다. 이번 제안 문서를 채택된 현재 아키텍처로 간주하지 않는다.

### D. 검증과 기능 제공

| 단계             | 검증 범위                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| adapter 단위     | `tests/ai-providers.test.mjs` 확장 및 Grok fixture: 공급자 선택, 인자, 설정 제한, 탐색, 인증 probe 실패/timeout, 모델·effort, 실제 이벤트 변형                                                                           |
| 프로세스         | `tests/ai-executor.test.mjs`: 고정 prompt 또는 stdin 전달, 한글·분할 UTF-8, 공백 경로, 실패 exit/event, AbortSignal·프로세스 트리 취소, 실행별 env의 다른 공급자 비영향                                                  |
| 업무·저장        | 기존 run-service/coordinator/queue/approval 테스트: 단일·연속 실행, 이미지 참조, 문서 bundle, 입력 변조/누락/잘못된 HTML, 원본 충돌, rollback, 프로젝트 A→B→A, 늦은 event·취소·lease 만료                                |
| 호환 데이터·서버 | 초안 저장/복원·재실행, 예약 재개, 새 서버/구버전 서버/로컬 조합, 관리자/팀원/viewer, Grok 거절 시 기존 세 공급자 정상 동작                                                                                               |
| 정적 검사        | TypeScript 변경은 `npm run typecheck`, 계약/core 변경은 각각 strict 검사, 의존성·파일 배치 변경은 architecture 검사. lint와 독립 검사는 병렬 가능. `npm test`가 architecture를 포함하면 같은 소스에서 중복 실행하지 않음 |
| 실제 조립·UI     | `test:ai-queue`, `test:ai-queue:ui`, `test:ai-dismissal`, `test:gamejam-approval`, `test:gamejam-validation`, `test:gamejam-history`에서 Grok mock 경로 확인                                                             |
| Windows package  | 최종 package를 한 번 만들고 같은 결과물에서 Grok mock CLI의 연결·실행·중지·예약·승인·히스토리 확인. 기존 packaged AI queue/approval 절차 재사용                                                                          |
| 실제 공급자      | 로그인된 Grok CLI로 작은 문서 정리와 HTML 구현을 확인해 mock 검증과 구분. 과금·모델 권한·실제 산출물 품질·설정 격리 결과를 별도 기록                                                                                     |

실제 외부 호출이 포함되는 검증은 실행 시 사용자의 계정·비용 승인 범위를 확인한다. 이 계획 요청만으로 계정 로그인이나 과금 호출을 수행하지 않는다. 배포가 요청되면 `UPDATES.md`의 절차를 따르며 검증한 같은 결과물을 재사용한다.

## 5. 완료 기준과 남은 불확실성

완료 기준은 공급자 드롭다운 표시가 아니라, Grok로 생성한 결과가 기존 검증·저장·히스토리 경계를 통과하고 예약·승인·취소·프로젝트 전환에서도 기존 동작을 보존하는 것이다. 미설치·인증 실패·구버전 CLI·구버전 서버·이용 한도 오류를 구별해 안내할 수 있어야 한다.

현재 남은 불확실성은 Windows 설치 산출물과 격리 동작, 전역 설정 차단과 기존 인증의 공존, 비과금 인증 probe, 실제 streaming-json schema, stdin 지원 여부, CLI 모델별 추론 수준·이미지 처리다. 모두 A 단계에서 실제 버전을 기준으로 확인한다. 문서 조사만으로 통과했다고 보지 않는다.

최초 조사 단계에서는 계획 문서만 추가했고 구현·자동 테스트·실제 CLI/package 검증은 수행하지 않았다.

## 6. 구현 기록

- 공식 npm 배포 1.0.70과 Windows 바이너리 `grok 1.0.70 (f50904eaee6c)`를 별도 개발 의존 위치에서 확인했다. 프로젝트 package.json/lockfile에 Grok 의존성을 추가하지 않았다.
- `--prompt-file`·native streaming-json schema·`GROK_AUTH_PATH`를 실제 바이너리와 공식 소스로 확인했다. A 단계에서 Read/Grep 기본 허용과 잘못된 도구 이름의 전체 도구 fallback을 발견해 초기 read/write 연결안을 변경했다.
- 입력은 application이 기존 보호 범위 사본으로 전달하며 Grok에는 `write`만 허용한다. 사용자 hook과 실패 시 통과하는 앱 소유 hook 모두 사용하지 않는다. 이유와 협업 capability 계약은 [ADR 0002](../architecture/decisions/0002-grok-cli-and-provider-capabilities.md)에 채택 상태로 기록했다.
- `grok-cli` 계약·카탈로그, 탐색·격리 설정·prompt 전달·파서·취소 정리, 단계별 입력 캡처, 초안 복원, 서버 지원 목록과 구버전 fallback, 개발 mock·실제 조립 경로를 연결했다. 모델 목록은 자동 선택이고 추론 수준은 기본값이다.
- 실제 계정 로그인·유료 추론·공개 배포는 수행하지 않았다. 타입/회귀/패키지 최종 검증 결과는 아래에 기록했다. 새 아키텍처 예외는 추가하지 않았다.

### 최종 검증 결과

- `npm test`: 1,048개 중 1,047개 통과, 실패 0, 공식 CLI opt-in 검사 1개 기본 생략. architecture 검사 포함.
- `npm run typecheck`, `typecheck:contracts`, `typecheck:core`, `lint` 통과. 기존 `tests/mocks/discord-transport.ts`의 no-this-alias 경고는 남아 있다.
- 공식 Windows CLI를 지정한 `tests/grok-native.test.mjs` 별도 통과. localhost 합성 모델, 긴/구조화 입력 전달, 실제 쓰기 도구 목록, 폴더 내부 생성·외부 읽기/쓰기 차단을 확인했다. 실제 Grok 모델의 답변 품질이나 이미지 시각 이해를 검증한 것은 아니다. 선택 이미지 설명·에셋 참조 전달 및 data URI 삽입은 단위/mock 조립 경로에서 확인했다.
- `test:ai-queue` 통과. `test:integration`은 첫 실행에서 기존 단계 대기의 시간 초과가 있었고 재실행 전체 통과했다. Grok를 포함한 네 공급자의 관리자 승인·공동 결과, Grok 정리→HTML·이미지 에셋·실패·중지 경로를 포함한다.
- `test:ai-queue:ui`, `test:ai-dismissal`, `test:gamejam-validation`, `test:gamejam-history`, `test:gamejam-approval` 통과. 예약 패널 열기·협업 메뉴·삭제 상태 필터 등 오래된 UI 테스트 가정을 현재 화면에 맞게 명시했다. 제품 동작은 이를 위해 바꾸지 않았다.
- Windows `npm run package` 1회 성공. 같은 `out/Game Jam!-win32-x64` 결과물에 `GAMEJAM_AI_PROVIDER=grok-cli`를 지정한 `tests/ai-queue-packaged.mjs` 통과: 실제 mock CLI의 로컬 예약·개별 취소·두 버전 반영, 번들 서버/독립 클라이언트의 공동 예약·잠금·자동 실행, 잘못된 HTML 결과 보존 검사.
- 명시적인 xAI HTTP adapter, 앱의 키 저장소, 별도 결과 저장 경로 또는 아키텍처 예외는 추가하지 않았다. 공개 게시·업데이트 피드 변경도 하지 않았다.
- 2026-10-31 커밋 전 현재 소스에서 `npm test` 재확인: 1,067개 중 1,066개 통과, 실패 0, 공식 CLI opt-in 검사 1개 생략. 전체·contracts·core 타입 검사와 린트도 통과했다. 이때 실제 계정·유료 추론·이미지 시각 이해 검증과 공개 배포는 추가 수행하지 않고 현재 구현을 마무리했다.
