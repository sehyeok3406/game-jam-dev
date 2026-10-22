# R07 첫 기능 단위: HTTP 경계와 이벤트 연결 수명

2026-10-21. 서버 전체를 한 번에 분리하지 않고 HTTP 전송과 SSE 연결 관리부터 추출했다. 외부 `createCollaborationServer(options)` 호출과 반환의 `server/port/close`, 기존 파일·SQLite·인증·명령 형식을 유지한다.

## 책임

| 모듈                                   | 책임                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `server/http/router.ts`                | Origin 거절, URL 해석, 명시적으로 요청을 처리하는 route 순회, 기존 업무 callback 연결과 오류 응답                   |
| `server/http/request.ts`               | 기존 22,000,000바이트 제한, 전체 버퍼 결합 후 UTF-8 해석, JSON 객체 검사, 기존 대소문자를 구분하는 Bearer 추출      |
| `server/http/response.ts`, `errors.ts` | JSON 보안/캐시 헤더, 기존 ApiError 상태와 failure/code/lifecycle 응답                                               |
| `server/http/routes/health.ts`         | 기존 health 이름·protocol·version·capability 응답                                                                   |
| `server/http/routes/events.ts`         | GET events 경로, 서버에서 인증한 actor, active 프로젝트 확인과 사용자별 한도 확인 후 연결                           |
| `server/services/project-events.ts`    | 프로젝트별 연결, 80개 한도, 초기 이벤트·lobby epoch/revision, heartbeat·권한 회수·backpressure·purge·서버 종료 정리 |
| `collaboration-server.ts`              | 현재 프로젝트를 읽는 최소 event source와 인증/한도 port 조립, 기존 나머지 HTTP/업무/저장소 처리                     |

SSE 관리자는 프로젝트 사본이나 저장소를 소유하지 않는다. 현재 revision/lifecycle 조회와 현재 멤버 유효성 조회만 주입받는다. 저장 성공 뒤 기존 `announce` 호출 위치를 유지하고, 느린 연결은 기존처럼 종료한다. 이름 없는 revision 이벤트, `play-lobby`, 초기 `data: {}`, 10초 heartbeat와 `X-Accel-Buffering: no`를 유지한다. 서버 종료는 연결과 heartbeat를 명시적으로 정리한다.

SSE를 재전송 로그로 바꾸지 않는다. 끊긴 사이의 변경은 기존 state/revision/delta 조회로 복구한다. actor는 Authorization 헤더의 인증 결과로 결정하며 body/query의 memberId/role을 사용하지 않는다. Origin 제한을 유지하고 X-Forwarded-For 신뢰나 rate limit 정책을 추가하지 않았다.

## 검증

- `tests/server-http.test.mjs`: 분할 UTF-8·빈 객체·정확한 바이트 한도·잘못된 JSON, router 순서/Origin/health·오류, actor/한도 순서, 프로젝트별 이벤트·최신 revision, heartbeat 권한 회수, 연결 한도·backpressure·purge/close, 실제 HTTP 소켓의 응답을 검증한다.
- `tests/server-events-packaged.mjs`: 최종 패키지의 Node/서버를 임시 데이터·임의 포트로 실행한다. 두 프로젝트 이벤트 격리, commit revision, 연결을 끊은 사이의 변경을 기존 클라이언트로 조회, 재연결, 실제 10초 heartbeat의 권한 회수 종료와 재접속/저장 거절을 확인한다.
- 기존 collaboration/property/offline/approval/queue/multiplayer 자동 검사와 실제 Windows 공동 연결·AI 예약·멀티플레이 검증을 함께 사용한다. 각 최종 실행 결과는 계획서 28절과 `out/r07-http-*.log`에 기록한다.

## 다음 경계

R07 전체 완료가 아니다. 후속 단위에서 프로젝트별 직렬 큐와 인증/역할/편집 정책(`server-access.md`, 계획서 29절), queued command(`server-command.md`, 30절), 프로젝트·멤버 관리(`server-projects.md`, 31절)를 HTTP 없이 호출 가능한 경계로 분리했다. 다음은 승인 요청 관리이며 AI·히스토리·프로젝트 수명 서비스와 나머지 route 조립을 순차적으로 분리한다. 큐 안의 재검증·receipt·저장 후 이벤트 순서를 유지한다. R08 저장소/스키마, R09 백업/복원, R10 Render 준비는 아직 시작하지 않는다.
