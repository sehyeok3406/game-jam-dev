# 서버 AI 실행 수명과 결과 반영 경계

2026-10-21. 실행 계획 34절의 R07 기능 단위다. [시작·예약/claim](server-ai-start.md) 다음의 heartbeat·progress·중지·완료·예약 취소·만료와 최종 상태 동기화를 분리했다. R07 전체와 R08 저장소 분리가 완료된 것은 아니다.

## 책임과 호출 순서

- `src/collaboration-server.ts`는 기존 프로젝트 FIFO 큐 안에서 현재 프로젝트/인증 사용자와 lifecycle·capability를 확인한다. 기존 위치에서 `aiRun.expire`를 호출하고 시작/claim은 기존 AI coordinator로, 나머지 실행 작업은 `aiRun.update`, 예약 취소는 `aiRun.cancelQueued`로 전달한다. 서비스는 큐를 다시 획득하지 않는다.
- `src/server/services/ai-run-service.ts`는 임대 소유자/토큰·실행 ID·역할, 진행 상태와 만료를 검사하고 변경 사본·task 상태·히스토리·최종 이벤트를 조립한다. 권한·사본·persist/envelope·taskState/recordChanges와 시계/hash만 주입받는다. HTTP 객체, 서버 전체 context, CLI 인증·프로세스를 소유하지 않는다.
- `src/server/services/ai-result.ts`의 `planAiResult`는 입력 baseline·허용 결과 목록·문서/출처/HTML/분석·배치를 검증하고 완료 task 메타데이터와 결과 snapshot을 돌려준다. 입력 Project/Job을 변경하거나 저장·알림을 실행하지 않는다. 기존 검증 함수를 그대로 사용해 HTML 조각 허용과 파일 형식도 유지한다.
- `src/server/services/ai-state.ts`의 `synchronizeAiState`는 persist 후보의 job/lastRun을 예약 상태에 연결하고, 종료된 예약의 baseline을 비우며 승인 완료/실패/중지를 기록한다. 활성 작업이나 다른 taskPath의 승인을 종료하지 않는다. 동일 최종 상태를 반복 동기화해도 승인 revision/change를 중복 증가시키지 않는다.
- 기존 persist adapter는 상태 동기화 → SQLite save → lifecycle marker/현재 map → runtime/checkpoint → SSE 알림 순서를 유지한다. 데이터 형식·HTTP action/payload·lease/claim/예약 규약·역할 정책·재시작 시 임대 만료를 바꾸지 않았다.

## 보존한 의미와 보완한 오류 경계

heartbeat는 소유자와 현재 lease를 확인한 뒤 메모리의 만료만 30초 연장한다. DB revision/히스토리/알림을 만들지 않는 기존 동작이다. 현재 요청에서 만료 처리를 먼저 거치며 새 타이머나 외부 worker를 추가하지 않았다.

progress는 starting/running/validating만 받는다. 기존에는 현재 `job.event`를 먼저 수정하고 저장해, SQLite 실패에도 메모리에 진행 상태가 남을 수 있었다. 이번에는 job/예약/승인을 포함한 후보 사본을 저장한다. 저장 전 대기·실패 시 현재 프로젝트와 성공 알림을 유지하는 것은 주입 port와 실제 SQLite abort로 확인했다.

완료는 성공/실패/취소 모두 입력 baseline을 확인한다. scoped job은 보호 범위만 확인하고 legacy job은 전체 snapshot hash를 사용한다. 성공 결과는 정확한 허용 파일 목록과 기존 validators를 통과해야 하며 실패/취소 결과물은 반영하지 않는다. 종료 task·히스토리·lastRun·예약·승인을 후보에 함께 준비한 뒤 저장한다. 오류 코드 allowlist·메시지 길이 제한·기존 timestamp 형식을 유지한다.

예약 실행 중지는 runId가 맞아야 하며 관리자 또는 실행자만 가능하다. 기존 legacy 직접 실행의 선택적 runId와 관리자 중지 시 lease 불필요 규칙을 보존했다. 예약 개별 취소는 관리자·queued 상태만 허용하고 이미 cancelled인 재전송은 새 히스토리를 만들지 않는다. 승인 변경 이력 추가 여부도 기존 규칙을 유지한다.

**아직 보장하지 않는 범위:** SQLite commit 뒤 lifecycle/runtime/checkpoint 파일 작업이 실패할 때는 DB/현재 상태와 응답 오류를 구분하는 기존 한계가 남는다. 모든 persist 오류를 원자적으로 되돌린다고 주장하지 않는다. 저장소·복구 파일의 commit 이후 오류 분리는 R08이며 이번에 함께 수정하지 않았다.

## 검증 연결

`tests/server-ai-run.test.mjs` 20개는 임대/역할·heartbeat 무저장·진행 상태·순수 결과 준비·정확한 허용 결과/HTML·scoped/legacy baseline·실패/취소 보존·예약 중지/replay·정확한 만료 경계·승인 동기화 반복·대기 중 lease 교체·저장 실패와 재시도를 HTTP/CLI 없이 확인한다. 테스트의 recordChanges/envelope는 주입 port이며 실제 조립 경로는 기존 서버 회귀 및 UI/native package로 별도 검증한다.

실제 SyncStore/SQLite의 `RAISE(ABORT)` trigger로 progress와 finish 저장을 중단해 현재/DB lease·파일·blob·히스토리·승인 보존, 성공 알림 미발행, 재시도와 저장소 재개방을 확인한다. 물리 디스크 장애·전원 차단이나 commit 이후 복구 파일 장애 검증은 아니다.

전체 자동 테스트 795개, 타입/strict contracts/strict core·린트, 승인/예약 UI, 최종 Windows package 1회 및 동일 package 승인·예약·공동 연결·SSE·multiplayer 검증 결과는 계획서 34절과 `out/r07-ai-run-verification.json`에 기록한다. 패키지 AI는 임시 mock CLI이며 실제 AI 계정·외부 서비스 검증과 구분한다.

## 후속 단위와 남은 R07

오프라인 변경 반영은 계획서 35절 및 [서버 오프라인 반영](server-offline-sync.md) 단위로 구현·검증했다. 다음 작은 단위는 히스토리 조회·undo/redo·복원 서비스 분리다. 프로젝트 수명·휴지통과 나머지 route/bootstrap도 R07에 남아 있다. R08~R10과 F01~F04, 실제 Render/유료 자원 생성·운영 배포·운영 데이터 이전은 이번 범위에 포함하지 않았다.
