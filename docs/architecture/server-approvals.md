# R07 승인 요청 관리 서비스

2026-10-21. 서버의 요청 목록/읽기·작성·수정·취소·보완을 `server/services/approval-service.ts`로 분리했다. 기존 desktop 승인 실행 서비스와 구분되며 `requests-start`·실행 예약/claim·AI 실행 결과 처리는 아직 원래 서버 경계에 남아 있다.

## 소유권과 순서

서비스는 프로젝트 큐 안에서 현재 프로젝트와 인증한 actor를 받아 실행한다. 큐 재획득·HTTP 객체·서버 전체 context 없이 관리자 검사, 사본 생성, 저장, 시계, 지문 hash, 입력 검토 계획의 6개 port를 사용한다. 공통 ingress 인증과 큐 안의 재인증·lifecycle/capability gate는 조립부의 기존 위치를 유지한다.

목록/읽기는 viewer도 기존처럼 사용할 수 있다. 수정 시각 내림차순과 requestsVersion을 반환하고 읽기에는 현재 요청·reviewToken/outputs 또는 reviewError를 제공한다. 검토 실패를 저장 작업으로 바꾸지 않으며 실행이 시작된 요청은 기존 outputs를 사용한다.

변경은 다음 순서를 따른다.

1. viewer 변경을 거절하고 보완 요청의 관리자 권한을 확인한다.
2. commandId와 action/id/revision/request/message/copiedFrom의 지문으로 기존 receipt를 확인한다. actor나 내용이 다르면 거절한다. 같은 작업은 기존 requestId의 현재 요청을 반환한다.
3. 생성은 자료를 parse/검토하고 인증 actor의 작성자 정보·시각·초기 상태를 기록한다. 수정/취소는 작성자만, 보완은 관리자만 가능하며 pending/feedback 상태와 현재 revision을 확인한다.
4. 사본에 요청·변경 이력·requestsVersion·receipt를 함께 기록하고 persist 완료 뒤 응답한다. 일반 문서 files/revision/history는 변경하지 않는다.

현재 코드의 요청 1,000개, 승인 변경 receipt 2,000개 한도를 유지한다. 일반 편집 명령의 receipt 500개와 별도 한도다. receipt가 제거되어도 생성 ID 충돌과 기존 요청 revision/status 검사는 유지한다. request 계약 밖의 token/provider/임의 필드는 공유 요청에 저장하지 않으며 copiedFrom은 실제 기존 요청만 연결한다.

## 검증

- `tests/server-approvals.test.mjs`의 12개 회귀는 작성자/관리자/viewer·stale revision·실행 상태·검토 오류·요청 정제/이력 사본, actor/내용 지문 충돌·현재 항목 재사용, 두 보관 한도·receipt 제거 뒤 충돌/revision 보호, commit 대기/실패·큐 경쟁/권한 회수와 실제 SQLite 중단을 HTTP 없이 검증한다.
- SyncStore/SQLite trigger로 요청/requestsVersion/receipt의 원자적 롤백을 확인한다. 같은 ID 재시도 후 저장소를 다시 열어 중복 저장 없이 요청을 읽는다. 입력 검토 계획은 서비스 테스트에서 주입한 port이며 실제 planApproval과 UI 경로는 기존 전체 서버 회귀와 아래 UI/package로 별도 확인한다.
- `npm run test:gamejam-approval`은 로그인 없는 요청·공동 수정·보완·stale 검토·입력 변경·관리자 시작·실행 입력 고정을 검사한다.
- 실제 최종 패키지의 `tests/gamejam-approval-packaged.mjs`는 독립 관리자/팀원 IPC, 요청 수정/보완·stale review·실제 승인 UI·mock CLI·검증한 HTML 게시·권한·서버 재시작 보존을 확인한다.
- 같은 패키지의 공동 연결/SSE/SQLite 실패·AI 예약·멀티플레이 회귀와 최종 기록은 계획서 32절, `out/r07-approvals-*.log`를 참조한다.

## 다음 경계

후속 단위에서 `requests-start`의 승인 시작과 일반 시작·예약/claim 조정을 분리했다(`server-ai-start.md`, 계획서 33절). 다음은 실행 중 AI 수명과 결과 반영이다. offline apply·히스토리/복원·프로젝트 수명·나머지 route/bootstrap도 R07에 남아 있다. DB commit 이후 복구 파일 내보내기 실패 구분과 repository/migration은 R08 범위다. 실제 AI 계정·외부 Discord·Render 운영 검증은 수행하지 않는다.
