# Grok CLI 입력 전달과 협업 공급자 능력 협상

날짜: 2026-10-29. 상태: 채택.

## 문제와 근거

Grok을 기존 개인/관리자 PC의 CLI 실행 경로에 추가한다. 서버의 AI 인증·과금·프로세스 책임을 늘리지 않는다.

공식 Windows Grok 1.0.70 (f50904eaee6c)로 확인한 결과, `dontAsk`에서도 Read/Grep는 기본 허용된다. `--tools`에 잘못된 도구 이름을 넣으면 전체 도구 목록으로 되돌아가기도 한다. 쓰기 도구의 실제 이름은 `write`다. 공식 PreToolUse hook도 timeout·프로세스 실패 시 통과하므로 외부 읽기 제한의 근거로 채택하지 않는다. Windows OS 샌드박스를 제공한다고 주장하지 않는다.

협업 서버의 기존 `multiProviderAi`는 기존 세 공급자 지원만 나타낸다. 이 boolean만으로 새 Grok 실행을 허용하면 구버전 서버에 지원하지 않는 공급자를 보낼 수 있다.

## 결정

- application의 기존 `taskFileLock`·`aiLockedSnapshot`으로 각 단계의 현재 작업 명세·보호 입력·기존 출력만 모아 private `PreparedAiRun.inputFiles`로 전달한다. 단계가 바뀔 때 다시 캡처하고 세션도 다시 검사한다. UI나 adapter가 입력 범위를 새로 계산하지 않는다.
- Grok adapter는 보호 지시와 이 사본을 임시 JSON prompt 파일로 전달한다. 이미지 data URI는 ACP image content block으로 전달하고 HTML의 선택 이미지 참조는 기존 embedding 경로로 처리한다.
- Grok에는 `write`만 노출하고 Read/Grep/Bash/MCP/Web를 명시적으로 거절한다. `dontAsk`와 작업 폴더에 한정된 Write allow 규칙으로 무인 실행한다. 기존 stage 검증·원본 충돌·lease·원자 반영·히스토리 경로는 유지한다.
- 실행별 임시 `GROK_HOME`을 쓰고 `GROK_AUTH_PATH`는 CLI의 기존 인증 파일을 가리킨다. 토큰을 읽어 복사하거나 프로젝트·서버에 저장하지 않는다. 외부 설정 환경 변수를 제거하고 호환 설정 탐색·자동 업데이트·메모리·하위 에이전트를 끈다.
- `grok inspect --json`에서 외부 hook·plugin·MCP·LSP·skill·프로젝트 지시·권한·설정 계층이 발견되거나 검사 schema가 불명확하면 거절한다. 상태 검사는 인증 파일/API 키의 존재만 확인하며 유효성·모델 권한·잔여 한도를 실제 실행 이전에 확인했다고 안내하지 않는다.
- 협업 state에 선택적 `supportedAiProviders`를 추가한다. 목록이 있으면 그것을 사용하고, 없으면 `multiProviderAi`에 따라 Codex 또는 기존 세 공급자만 허용한다. 일반 시작·예약·승인 예약은 같은 판정을 사용한다. 서버의 직접 입력 검증·역할·lease 검사는 그대로 유지한다.

## 대안과 영향

직접 xAI API와 자체 agent loop는 새로운 인증 보관·도구 실행 책임이 필요해 제외했다. 단순 read/write CLI 연결과 앱 소유 hook은 위의 관찰 결과로 제외했다. 별도 Grok 지원 boolean이나 서버 버전 비교 대신 공급자 ID 목록을 택해 명시적인 호환 정보를 제공한다.

Grok은 필요한 파일 내용을 한 번에 받으므로 큰 입력의 context·비용 한도는 실제 모델에 좌우된다. 첫 버전 모델 목록은 자동 선택이고 추론 수준은 기본값만 허용한다. 이미지 content block을 CLI에 전달하지만 실제 모델의 시각 해석은 실계정 검증 대상이며, 로컬 검증은 이미지 설명·에셋 참조 전달과 기존 삽입 경로를 확인한다. 사용자 Grok의 커스텀 모델 설정·외부 인증 명령·플러그인은 상속하지 않는다. 실행 중 앱 강제 종료 시 임시 파일이 OS temp에 남을 수 있고, 정상 종료·취소·준비 실패에서는 정리한다. OS 강제 격리나 공급자 서비스 장애까지 보장하지 않는다.

## 검증과 재검토

공급자·입력 범위·두 단계 갱신·세션 전환·초안·구버전 서버·실제 프로세스 전달/취소 회귀를 추가한다. `tests/grok-native.test.mjs`는 `GROK_TEST_EXECUTABLE`로 공식 바이너리를 지정할 때만 실행하며, localhost의 합성 모델 응답으로 실제 도구 목록·파일 생성·외부 읽기/쓰기 차단을 확인한다. 실제 계정·유료 API 검증과 구분한다.

향후 공식 Windows 샌드박스나 fail-closed 파일 읽기 정책이 확보되면 입력 사본 전달 정책을 재검토한다. CLI 버전·출력·설정 schema가 바뀌면 native 검증을 다시 수행한다. 새 아키텍처 예외는 추가하지 않는다.

근거: [공식 CLI](https://docs.x.ai/build/cli/reference), [공식 Headless](https://docs.x.ai/build/cli/headless-scripting), [공식 Hooks](https://docs.x.ai/build/features/hooks), [공식 소스](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8).
