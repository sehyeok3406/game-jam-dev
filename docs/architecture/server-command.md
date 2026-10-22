# R07 명령 처리 서비스

2026-10-21. HTTP callback의 `command` 분기를 `server/services/command-service.ts`의 `createCommandService`로 추출했다. 기존 `application/editing/command-service.ts`는 공유 reducer 진입점이며, 이번 서비스는 서버의 요청 인정·저장 흐름을 담당한다.

## 경계와 순서

서비스는 호출자가 프로젝트 큐 안에서 최신 프로젝트와 인증한 actor를 넘긴다는 전제를 가진다. 기존 ingress 인증, 큐 안의 프로젝트 재조회/재인증, lifecycle·공통 capability gate·AI 만료 처리는 원래 실행 위치에 남겼다. 큐를 서비스 안에서 다시 획득하지 않는다.

서비스는 다음 순서를 소유한다.

1. 작업 생성의 관리자 권한과 요청 ID 형식을 확인한다.
2. 기존 receipt가 있으면 같은 actor인지 확인하고 원래 result/historyId와 현재 envelope를 반환한다. reducer·저장·알림을 다시 실행하지 않는다. legacy receipt도 읽는다.
3. 편집 권한, 문서 저장의 현재 lockToken, 캔버스 capability와 속성별 순번 형식을 검사한다.
4. 기존 reducer로 후보를 계산하고 AI 보호·revision·객체/속성 세대·편집 잠금과 sequence를 검사한다.
5. 프로젝트 사본에 변경·히스토리·순번·receipt를 함께 기록하고 기존 500개 receipt 한도를 적용한다.
6. persist가 완료된 뒤 결과를 반환한다. 알림은 기존 persist adapter가 durable 저장 후 발행한다.

명령 서비스에는 권한/잠금 조회, reducer, AI 보호, revision 검사, 사본 생성, 히스토리 기록, persist와 envelope의 필요한 port만 주입한다. 서버 전체 context·HTTP request/response·SQLite·전역 저장소를 전달하지 않는다. reducer와 히스토리 port가 기존 시계/ID 공급 경계를 유지한다.

저장 전 실패는 원본의 파일·순번·히스토리·receipt를 변경하지 않는다. receipt가 제거된 뒤 같은 session/속성의 오래된 순번은 계속 거절한다. 변경 파일이 없는 기록의 historyId=null, 현재 역할이 바뀐 actor의 기존 receipt 인정 순서와 tasks:create 관리자 재검사도 기존 동작을 유지한다.

## 검증

- `tests/server-command.test.mjs`의 10개 검사는 HTTP 없이 commit 대기/실패·원본 보존, 같은 ID 재시도·재전송, 동시 중복/다른 actor 충돌, legacy/null history receipt, capability·순번·현재 lockToken·content 세대, 오래된 순번/receipt 한도, AI 보호·관리자와 큐 대기 뒤 최신 인증을 확인한다.
- 실제 `SyncStore`와 별도 SQLite 연결의 `RAISE(ABORT)` trigger로 blob 삽입 뒤 project commit을 중단한다. blob·project·history·receipt의 롤백, 알림 없음, trigger 제거 후 같은 ID 재시도와 저장소 재개방 후 receipt 재사용을 확인한다. 테스트 전용 제품 API는 추가하지 않았다.
- 확장한 `tests/server-events-packaged.mjs`는 최종 패키지의 실제 내장 Node/서버에도 같은 SQLite abort를 적용한다. DB 값·blob 수·히스토리·SSE revision이 유지되고, 같은 ID 재시도/재전송으로 기록이 한 번 추가되는지 확인한다. 기존 동시 프로젝트·역할 위조·SSE 재연결 회귀도 유지한다.
- 최종 전체 검사/실제 Windows package 결과는 계획서 30절과 `out/r07-command-*.log`에 기록한다.

## 남은 경계

명령 뒤 프로젝트·멤버 관리(`server-projects.md`, 계획서 31절)와 승인 요청 관리(`server-approvals.md`, 32절)도 분리했다. 다음은 승인 시작/서버 AI 조정이며 offline apply·history/restore·프로젝트 수명과 나머지 route/bootstrap 분리도 R07 후속으로 남아 있다.

DB commit 뒤 runtime/checkpoint/lifecycle 복구 파일 내보내기 실패의 구분, repository/migration과 데이터 수명 조정은 R08 범위이며 이번 persist adapter를 바꾸지 않았다. 이번 검증은 실제 SQLite 트랜잭션 중단이며 물리 디스크 장애·외부망·Render 운영 검증을 뜻하지 않는다.
