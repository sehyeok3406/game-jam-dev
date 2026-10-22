# 협업 서버 조립·HTTP 전송 경계

2026-10-22, 계획서 39절. R07 요청 4번과 최종 완료 검사다.

## 조립과 프로젝트 요청

`collaboration-server.ts`는 기존 createCollaborationServer/activeEvent와 계약 type export를 유지하는 호환 진입점이다. `server/bootstrap.ts`는 실행 인스턴스를 만들고 기능별 서비스·HTTP/WS route·수명 port를 연결한다. 외부 options와 반환값 server/port/close를 유지한다.

`server/context.ts`가 인스턴스별 프로젝트·잠금·presence·ProjectQueue를 소유한다. 서비스마다 필요한 좁은 port만 제공하며 전체 context를 전달하지 않는다. `services/project-request.ts`가 큐 안에서 현재 프로젝트와 인증된 참여자를 다시 조회하고, 수명·버전·AI 만료·기능 지원 검사를 기존 순서로 적용한다. body의 memberId/role 등은 actor의 근거가 아니다. `project-actions.ts`는 추출된 기능별 서비스를 선택한다.

`project-capabilities.ts`는 기존 capability/version gate와 예외 목록을 유지한다. `project-history-writer.ts`는 변경 이력·revision·속성·작성자 후보를 생성하며 시계/ID를 주입받는다. workflow 검증이 후보 변경보다 먼저 실행되고 기존 이력 300개 제한을 유지한다. `project-operations.ts`에는 기존 clone/digest/계획 승인 등 공통 연산을 둔다.

## HTTP·클라이언트

기존 health/events 외에 projects/members/commands/history/approvals/ai/multiplayer route가 있다. 일반 프로젝트 POST의 ingress 한도→현재 인증→참여자 한도→body 읽기→큐 안 재인증→응답 조립 순서를 `http/routes/project-actions.ts`가 공유한다. 알 수 없는 작업은 같은 경로로 인증한 뒤 기존 404를 반환한다. 프로젝트 생성·join/recover는 기존 key 검사를 JSON 읽기보다 먼저 수행한다.

multiplayer의 play HTTP 경로는 별도 진단/오류 응답을 유지하며 기존 메모리 방과 WS 연결을 사용한다. Origin 차단, 경로·상태 코드·token·SSE 이름, redirect 거부·본문 제한과 기존 rate limit을 바꾸지 않는다. 클라이언트 IP는 socket 기준이며 임의 X-Forwarded-For를 신뢰하지 않는다. 운영 프록시 정책 보완은 R10에서 별도 검증한다.

`adapters/http/collaboration-transport.ts`는 fetch·timeout signal을 주입받는다. CollaborationClient의 공개 호출/세션·재시도·캐시 흐름을 유지한다. POST/auth/key, 12초 timeout, 429 우선 처리, JSON 오류·5xx·도메인 failure/lifecycle, history-read의 string/null 응답 계약을 보존한다.

## 수명과 다음 경계

`server/lifetime.ts`가 timer·HTTP timeout·listen과 종료 자원의 수명을 소유한다. 종료는 timer 중지→멀티플레이/SSE→진단 flush→HTTP 종료→받아들인 큐 drain→진행 checkpoint→dirty export→store close 순서다. 새 readiness/draining 프로토콜은 추가하지 않았다.

bootstrap에는 기존 SQLite 시작 복원·persist·checkpoint/export·lifecycle marker 연결이 남는다. 이는 R08 저장소 경계이며 이번 요청에서 저장 형식·commit 이후 오류 의미를 바꾸지 않는다. DB commit과 파일 export/marker를 하나의 트랜잭션으로 보장하지 않는다. R09 백업·복원과 R10 Render/Linux 배포 준비도 남아 있다.

## 검증과 한계

신규 테스트는 `server-assembly.test.mjs` 7개, `server-action-routes.test.mjs` 4개, `collaboration-transport.test.mjs` 5개다. 상태 경계 9개와 합쳐 25개다. 실제 임시 HTTP 서버와 주입 port로 route 분류·인증/body 검사 순서·proxy 무시·scalar/delta·멀티플레이 진단, 큐 대기 중 권한 회수/현재 actor, 기능 검사 순서와 실제 HTTP 종료/drain/checkpoint 순서를 확인한다. transport는 fake fetch로 오류 계약을 검사한다.

전체 자동 테스트 864개, 타입/strict contracts/strict core·린트가 통과했다. 최종 소스 1회 package 완료 후 같은 결과물로 session/events/approval/ai-queue/multiplayer/trash 6개 suite를 순서대로 실행했다. 입력 지문과 준비/내장 runtime 해시를 비교했다. 기존 클라이언트 공개 API를 바꾸지 않고 최종 내장 서버에 연결했다.

approval/ai-queue는 실제 앱과 mock CLI 프로세스의 검증이며 실제 공급자 계정/요금 검증이 아니다. trash UI suite의 팀 backend는 소스 서버이며 session suite가 별도로 최종 내장 서버의 휴지통/재시작/복구/tombstone을 확인한다. SQLite trigger와 재시작은 물리 디스크/전원 장애 시험이 아니다. 실제 AI·외부 Discord·다른 PC/외부망·Linux/Render/S3·운영 자료 이전은 확인하지 않았다. 배포는 실행하지 않았다.
