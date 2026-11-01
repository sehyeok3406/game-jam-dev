# AI 패스트 모드 조사 및 적용 계획

작성: 2026-10-29 (한국 시간). 상태: **조사·설계 제안, 기능 미구현**.

대상은 현재 소스의 `codex-cli`, `claude-cli`, `gemini-cli`, `grok-cli`다. 사용자 표현의 “글록”은 기존 연동인 Grok Build로 해석했다. 공식 문서와 현재 코드를 대조했으며, 유료 추론·실계정 속도 비교는 수행하지 않았다. 아래 적용 방법은 구현 제안이며 검증 완료를 뜻하지 않는다.

## 1. 판단과 추천

**Codex와 Claude Code부터 실행별 패스트 옵션을 제공하는 것을 추천한다.** Gemini에도 유료 Priority 추론은 있지만 인증 경로별 전달 검증이 필요하다. Grok에도 실제 Fast 변형이 있으나 현재 CLI/계정에서 모델 선택 방법을 확정하지 못했다.

| 공급자      | 공식 고속 기능                            | 우리 앱 적용 판단                                                                                               | 추천 순서  |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Codex       | 같은 모델의 Fast 모드                     | 실행별 config로 연결 가능. 모델·CLI·계정 조건 확인 필요                                                         | 1차        |
| Claude Code | 지원 Opus의 Fast 모드                     | `--print --restricted`를 유지하고 실행별 `--settings`로 연결 가능                                               | 1차        |
| Gemini CLI  | API의 Priority 추론 / Flash 모델 선택     | API 키 방식은 설정 전달 후보가 있음. Google 로그인 방식의 Priority 지원은 확인되지 않음. Flash 선택은 이미 가능 | 조건부 2차 |
| Grok Build  | Grok 4.7 Fast / API의 Priority Processing | Fast 변형의 실제 CLI 모델 ID·선택 방식·유료 권한을 검증한 뒤 노출. API Priority와 구분                          | 조건부 2차 |

“같은 모델을 빠르게 처리”, “빠른 다른 모델 선택”, “추론 수준 감소”는 서로 다른 설정이다. 패스트 모드를 선택했다고 모델이나 추론 수준을 자동으로 바꾸지 않는다. 생성 속도의 개선 비율을 도구 실행·파일 검증을 포함한 전체 작업 시간의 개선 비율로 약속하지 않는다.

## 2. 공급자별 근거와 연결 방법

### Codex

공식 문서는 `/fast`와 `service_tier = "fast"`, `[features].fast_mode = true`를 안내한다. 지원 모델에는 GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Astra, GPT-6 Sol/Luna 등이 포함된다. 포함 구독 한도는 표준 대비 2.5배, 구매 크레딧·Enterprise 종량 사용은 2배로 소비한다. API 키 인증은 별도 API 가격을 따른다. Ultrafast도 존재하지만 자격·비용이 달라 이번 1차 범위에서는 제외한다. [공식 Speed](https://learn.chatgpt.com/docs/agent-configuration/speed)

현재 `src/adapters/node/ai/codex.ts`는 `exec`, 모델·추론 설정, `--ignore-user-config`를 전달한다. 따라서 외부 Codex 앱에서 Fast를 켜도 우리 앱에 자동 적용된다고 볼 수 없다.

제안: `codexArguments`에 실행 옵션을 받아 Fast 요청 때 `--config service_tier="fast"`와 `--config features.fast_mode=true`를 전달한다. 공식 config에서 `fast`는 요청의 `priority`로 매핑된다. 일반 실행의 tier도 검증된 CLI 규칙으로 명시해 외부 유료 기본값의 영향을 막는다. 실제 `exec`에서 설정이 수용되고 요청에 전달되는지는 native 검증 대상으로 둔다. [공식 Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)

### Claude Code

Fast는 같은 Opus를 고속으로 실행한다. 현재 공식 지원은 Opus 5.5 및 연구 미리보기인 Opus 5/4.8이며 Sonnet·Haiku는 미지원이다. 구독 사용자는 포함 한도 대신 별도 usage credits가 필요하고 조직 정책으로 차단될 수 있다. 비대화형은 `claude -p --settings '{"fastMode":true}'` 방식이 공식 지원된다(v2.1.205 이상). 한도·크레딧 부족 시 CLI 자체가 일반 속도로 전환할 수 있다. [공식 Fast mode](https://code.claude.com/docs/en/fast-mode)

현재 `claude.ts`는 `--print --restricted`와 파일 도구 제한을 사용한다. `--restricted`는 사용자·프로젝트 설정을 읽지 않지만 `--settings`는 허용한다(v2.1.248 이상). 따라서 제한을 풀지 않고 `--settings {"fastMode":true}`를 argv의 별도 요소로 추가할 수 있다. 일반 모드는 `fastMode:false`를 명시하되 관리 정책이 우선한다. [공식 CLI reference](https://code.claude.com/docs/en/cli-reference)

처음에는 현재 카탈로그의 명시 모델 `claude-opus-5-5`만 허용한다. 자동 선택·`opus` 같은 이동 별칭, Fable·Sonnet·Haiku에 대해 Fast가 가능하다고 추정하지 않는다. 모델 전환을 유발할 수 있는 조합은 실행 전에 거절한다. 기존 `claudeEvent`는 모든 `system` 이벤트를 시작 메시지로 바꾸므로, notification의 일반 속도 전환 안내를 보존하도록 변경한다.

### Gemini

Gemini API에는 `service_tier: "priority"`인 Priority 추론이 실제로 있다. 표준 대비 75~100% 높은 단가이며 한도 초과 시 일반 처리로 내려갈 수 있다. GenerateContent 문서는 Tier 2/3 조건을 명시한다. 따라서 “Gemini에는 고속 서비스가 없다”는 결론은 틀리지만, 이를 일반 Google 로그인 CLI에도 쓸 수 있다는 근거는 확인하지 못했다. [Priority 추론](https://ai.google.dev/gemini-api/docs/priority-inference), [GenerateContent 조건·JS 설정](https://ai.google.dev/gemini-api/docs/generate-content/priority-inference)

현재 앱은 `geminiRunSettings`가 단계별 `.gemini/settings.json`에 추론 설정을 기록한다. CLI의 `generateContentConfig`는 Google SDK 설정으로 연결되고 최신 공식 소스에는 `customOverrides`도 있다. API 키 인증을 사용하는 지원 CLI에서 기존 override와 병합해 `generateContentConfig.serviceTier = "priority"`를 전달하는 것이 후보 경로다. 버전별 설정 schema와 최종 요청을 확인하기 전에는 정식 지원으로 표시하지 않는다. [CLI 모델 설정](https://geminicli.com/docs/cli/generation-settings/), [공식 설정 구현](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/modelConfigService.ts), [SDK 타입](https://github.com/googleapis/js-genai/blob/main/src/types.ts)

Google 로그인용 Code Assist 변환 소스에는 조사 시점에 `serviceTier` 전달이 나타나지 않았다. API 키 경로와 동일하게 취급하면 설정만 넣고 효과가 없는 문제가 생길 수 있다. 인증 종류를 비밀값 없이 구분하고, API 키 경로만 먼저 검증한다. [공식 Code Assist 변환 구현](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/converter.ts)

별도 대안인 Flash·Flash-Lite 선택은 `--model`로 가능하며 우리 카탈로그에도 이미 있다. 이는 모델을 바꾸는 기능이므로 모델 선택란에 “빠른 응답용” 안내를 보완하는 정도가 적절하다. 추론량 감소 역시 기존 추론 설정에 남긴다. [공식 모델 선택](https://geminicli.com/docs/cli/model/)

### Grok Build

공식 문서의 Grok 4.7 Fast는 같은 모델을 빠른 인프라로 제공하는 변형이다. Grok Build·Cursor 전용이며 공개 xAI API에는 없다. 일반 문맥은 표준 토큰 단가의 2배, 긴 문맥은 1.5배이고 Grok Build 무료 등급에 포함되지 않는다. [모델 안내](https://docs.x.ai/developers/grok-4-7), [공식 가격](https://docs.x.ai/developers/pricing)

별도로 공개 API에는 `service_tier:"priority"`인 Priority Processing이 있다. 이는 요청의 처리 우선순위를 높이는 기능이며 Grok 4.7 Fast와 같은 제공 경로로 간주하지 않는다. 현재 앱에는 직접 API 실행 경로가 없다. [공식 Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing)

현 adapter는 실행별 임시 `GROK_HOME`, 기본 `grok-build`, 파일 입력 사본과 write-only 도구를 사용한다. `--model` 전달은 이미 가능하지만 UI에는 자동 선택만 있다. 공식 CLI 문서는 `grok models`와 `--model`을 안내하며, 조사한 문서·1.0.70 도움말에서는 범용 `--fast`를 확인하지 못했다. [CLI reference](https://docs.x.ai/build/cli/reference), [Headless](https://docs.x.ai/build/cli/headless-scripting)

제안: 기존 격리 환경에서 인증된 모델 목록을 조회해 Fast 모델의 실제 ID와 일반 모델의 대응 관계를 먼저 확인한다. 모델 선택으로 활성화된다면 검증한 ID를 기존 `--model`로 전달한다. 별도 옵션이 필요하다면 공식 근거와 native 검증을 확보한다. `grok-4.7-fast`처럼 추정한 ID는 추가하지 않는다. 현재 기본 `grok-build`에서 4.7 Fast로 바뀌는 경우는 모델 변경도 동반하므로, 사용자가 4.7 계열을 명시 선택하는 흐름이 필요하다.

## 3. 현재 PC에서 확인한 범위

- 앱의 Codex 탐색이 사용하는 설치 후보에서 `codex-cli 0.165.0-alpha.1.2`를 확인했다. 터미널 PATH의 npm Codex는 `0.147.0`으로 달랐다. 따라서 PATH 버전만 보고 앱의 호환성을 판단하면 안 된다.
- Claude·Gemini는 PATH 및 현 코드가 사용하는 기본 후보에서 실행 파일을 확보하지 못했다. 소스의 연동 구현과 이 PC의 실제 설치·로그인은 구분한다.
- Grok은 공식 `1.0.70 (f50904eaee6c)`의 도움말을 확인했다. 기존 `prepareGrokProcess`로 격리 후 `grok models`를 실행했으나 인증 부재 안내와 기본 fallback 목록만 반환했다. Fast 모델의 부재·계정 미지원으로 단정할 수 없다. 종료 코드 0만으로 모델 조회 성공을 판단해서도 안 된다.
- AI 생성 호출, 계정 변경, 크레딧 구매, CLI 업데이트는 수행하지 않았다.

## 4. 공통 구현 설계 제안

### 옵션·표시

실행 설정에 선택적 `speedMode: 'standard' | 'fast'`를 추가하고 누락값은 일반 모드로 정규화한다. 모델·추론 수준과 독립된 값으로 유지한다. 지원이 확인된 공급자/명시 모델/CLI 조합에만 Fast를 노출하며 자동 선택의 미확인 조합은 활성화하지 않는다.

공급자 변경으로 미지원 조합이 되면 일반 모드로 바꾸고 그 이유를 표시한다. 실행 전 검토 화면에 모델·추론·속도와 사용량/추가 과금 안내를 함께 보여준다. Claude는 별도 usage credits 사용임을 분명히 한다. 공급자마다 다른 단가를 하나의 공통 배수로 표시하지 않는다.

요청 모드와 실제 확인된 모드를 구분한다. 예를 들어 “Fast 요청”, “일반 속도로 전환”, “실제 처리 모드 확인 불가”를 표시한다. 옵션을 전달했다는 이유만으로 Fast 적용 완료라고 기록하지 않는다. 기존 CLI stream에 실제 tier가 없으면 확인 불가로 남긴다.

### 책임과 수정 범위

| 계층          | 필요한 변경                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `contracts`   | `ai.ts`의 입력·결과·이벤트·연결 능력, 예약·저장 요청·승인 계약에 속도 전달. 기존 채널 유지              |
| `core`        | `ai/catalog.ts`에 공급자·모델별 허용 조합과 순수 검증 추가. CLI 기능과 계정 권한을 구분                 |
| `application` | 준비된 실행에 모드 고정, 예약 중복 판정·재시도·2단계 실행에서 보존, 세션·취소·실패 처리 재사용          |
| `adapters`    | 각 CLI 인자/임시 설정 변환, 알림·실제 처리 정보 해석. 사용자 설정 파일 수정 금지                        |
| `desktop`     | 기존 executor와 stage 조립에 옵션 전달, 설치된 실행 파일의 버전/능력 확인. UI에 프로세스 로직 추가 금지 |
| `server`      | 시작·예약·승인·claim에서 동일 검증과 설정 고정, lease·공동 결과 경로 유지. AI 인증·실행은 PC 소유       |
| `ui`          | 주입된 runtime으로 옵션 입력·검토·상태 표시, 초안·기록·재실행의 속도 보존                               |

특히 `GamejamSavedRequest`, 예약 레코드, task frontmatter(예: `ai_speed_mode`), 실행 이벤트·진단·완료 기록까지 전달해야 한다. 기존 저장 서비스와 파서를 확장하고 별도 설정 저장소를 만들지 않는다. 옛 요청·히스토리는 누락값을 일반 모드로 읽는다.

### 협업·승인·실패

- 기존 `aiReasoningVersion`과 같은 방식으로 협업 프로토콜의 속도 설정 지원 버전을 제안한다. `supportedAiProviders`만으로 새 옵션까지 지원한다고 추정하지 않는다. 구버전 서버에는 Fast 요청을 막고 이유를 표시한다. 일반 실행은 기존 호환 경로를 유지한다.
- 서버의 속도 계약 지원, 실행 PC의 CLI 기능, 공급자 계정의 유료 권한을 각각 판단한다. 계정 권한 미확인을 연결 성공으로 대체하지 않는다.
- 속도값을 예약 불변 설정과 command ID 재전송 비교에 포함한다. 같은 예약·승인 명령을 다른 속도로 재사용하면 거절한다. 실행 예약 당시의 선택을 관리자 PC의 기본값으로 바꾸지 않는다.
- 비용에 영향을 주는 선택은 승인 전 검토 정보에 포함한다. 실행 설정을 바꿨다면 기존 검토 토큰/승인 검증 경로로 다시 확인되게 한다.
- CLI가 자체적으로 일반 처리로 전환한 알림은 보존한다. 앱이 실패한 생성 작업 전체를 자동 재실행해 중복 생성·과금하는 fallback은 추가하지 않는다. 시작 전 미지원·정책 거절은 분명한 오류로 반환한다.
- 프로젝트 전환 뒤 늦은 알림/결과 차단, lease 상실 시 반영 금지, 취소 후 프로세스·임시 설정 정리는 기존 coordinator 경로를 유지한다.

## 5. 적용 순서와 완료 기준

1. **기능 적합성 확인:** 앱이 실제 선택한 CLI 바이너리로 설정 수용·요청 전달을 검증한다. Codex의 `exec` override, Claude의 restricted+settings와 정책 거절을 먼저 확인한다. Gemini/Grok은 인증 경로·모델 선택에 대한 조건을 확정한다.
2. **1차 구현:** 공통 속도 계약·검증·초안/예약/승인/히스토리 전달을 한 번 확장하고 Codex·명시 Opus 5.5를 연결한다. 기본값은 일반, 사용자가 요청별 Fast를 선택한다.
3. **2차 조건부 확장:** Gemini API 키 경로의 `serviceTier` 전달 및 실제 tier 관찰, Grok의 인증된 Fast 모델 ID·파일 생성 호환성이 확인된 경우만 지원을 연다. Gemini Flash 안내는 기존 모델 선택에 보완한다.
4. **검증 및 문서 반영:** `docs/architecture/ai-execution.md`와 관련 회귀 지도를 갱신한다. 협업 공개 계약/책임에 관한 결정은 채택 시 ADR로 남긴다. 이 문서는 아직 채택 ADR이 아니다.

필수 자동 검증은 `npm run typecheck`, `typecheck:contracts`, `typecheck:core`, `test:architecture`, 린트와 관련 회귀다. provider 인자/설정, 저장 구버전 호환, 승인·예약 재전송, 2단계 보존, 일반 전환 알림, 세션 교체·취소를 기존 AI/서버/히스토리 테스트에 추가한다. 독립 검사는 병렬로 수행하고 같은 출력 폴더를 쓰는 UI·패키지 검사는 순서를 지킨다.

통합·UI는 기존 `test:ai-queue`, `test:ai-queue:ui`, `test:gamejam-validation`, `test:gamejam-history`, `test:gamejam-approval`, `test:integration`에서 변경 경로를 검증한다. 실제 패키지에서도 선택한 속도가 mock CLI까지 도달하고 예약·승인·완료 기록에 남는지 확인한다. native CLI와 합성 응답 검증, 실제 유료 계정 검증은 결과에 따로 표시한다.

실계정 검증에서는 같은 입력·모델·추론으로 일반/Fast의 처리 모드·첫 응답·완료 시간·사용량을 소수 표본으로 비교한다. 한 번의 빠른 결과를 고정 성능 보장으로 일반화하지 않는다. 계정 제약 때문에 확인하지 못한 공급자는 조건부 상태로 남긴다.

## 6. 이번 조사 결과와 남은 제약

이번 변경은 이 조사 문서 추가뿐이다. 앱 코드·계정·배포 설정은 변경하지 않았다. 소스와 공식 문서 대조, 설치 후보의 버전·도움말, Grok의 격리된 읽기 전용 모델 조회를 수행했다. 구현 테스트·빌드·패키지 검증은 이번에 수행하지 않았다. 기존 작업 트리 변경과 이전 검증 기록을 이번 작업의 검증 결과로 계산하지 않았다.

새 아키텍처 예외는 없다. 미확정 사항은 Codex/Claude의 실제 과금 계정 검증, Gemini의 설치 버전·인증별 tier 전달, Grok의 인증된 모델 목록과 Fast 선택 경로다. 이 확인 없이 네 공급자 모두에 동일한 Fast 스위치를 공개하는 것은 추천하지 않는다.
