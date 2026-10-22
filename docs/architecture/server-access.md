# R07 프로젝트 큐와 접근 정책

2026-10-21. HTTP/SSE 분리에 이어 프로젝트별 직렬 실행과 인증/편집 정책을 추출했다. 현재 HTTP 업무 callback의 실행 위치·대상 프로젝트 조회·revision/lock/receipt 검증 순서는 유지한다.

## 소유권

| 모듈                               | 책임                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `server/services/project-queue.ts` | 프로젝트별 FIFO, 작업별 반환/실패, 실패 후 후속 실행, 완료된 tail 정리, 서버 종료 시 받아 둔 tail 대기              |
| `server/services/access-policy.ts` | 현재 멤버 인증, 관리자/뷰어/legacy AI 잠금, 변경 파일의 revision·객체 ID·속성 세대·편집 잠금·기존 AI 작업 문서 제한 |
| `server/services/errors.ts`        | HTTP 객체를 참조하지 않는 기존 ApiError 클래스                                                                      |
| `server/http/errors.ts`            | 동일 클래스 re-export와 기존 wire 오류 응답 변환                                                                    |
| `collaboration-server.ts`          | 최신 프로젝트 조회, 토큰 digest/상수 시간 비교, presence 저장, 만료된 편집 잠금 정리, 큐/정책 조립과 기존 업무 처리 |

큐에는 프로젝트 자료를 캡처하지 않는다. 호출자는 큐 안에서 현재 프로젝트와 멤버를 읽는다. 같은 프로젝트는 차례로 실행되고 다른 프로젝트는 기다리지 않는다. 실패한 작업은 원래 오류를 호출자에게 돌려주되 다음 작업을 막지 않는다. 완료 tail을 제거할 때 같은 프로젝트의 새 tail인지 확인해 후속 작업을 큐에서 분리하지 않는다. 종료의 drain은 기존처럼 종료 경계에서 받아 둔 tail을 기다린다. checkpoint export와 lease heartbeat의 기존 별도 경계는 유지한다.

접근 정책은 stateless이며 token 비교, 시계, presence 기록, 현재 잠금 조회만 주입받는다. 서버 전체 context나 repository를 넘기지 않는다. 인증 성공 시 현재 서버 멤버 객체를 반환하고 주입한 시각으로 presence를 기록한다. body의 actor/role을 정책 입력으로 인증하지 않는다. 제거된 멤버·교체된 토큰을 재사용할 수 없다.

파일 검사는 기존 정책을 그대로 따른다. 일반 변경은 파일 revision을 확인한다. 지원하는 속성별 명령은 structure·객체 ID 및 content/workflow 세대를 확인한다. metadata-only 변경은 기존 조건에서 다른 멤버의 content 잠금과 양립하며 본문/구조 변경은 허용하지 않는다. drawing/game-ui의 세부 객체 검증은 기존 reducer에 남긴다. AI scoped lock과 별도 보호·save lockToken·요청 sequence·receipt는 기존 업무 callback/reducer의 검사를 유지한다.

## 검증

- `tests/server-access.test.mjs`의 10개 회귀는 같은 프로젝트 FIFO/다른 프로젝트 독립 실행, 동기/비동기 실패 뒤 재시도, 이전 완료와 후속 tail 경합, drain, 멤버·토큰·presence, 역할/AI 잠금, revision/객체/속성 세대·metadata 예외, 큐 대기 뒤 최신 프로젝트의 권한 회수/revision/잠금 재확인을 HTTP 없이 검증한다.
- 확장한 `tests/server-events-packaged.mjs`는 실제 최종 내장 Node/서버에서 두 프로젝트 동시 명령, 같은 요청 동시 재전송의 단일 history/revision/result, 다른 actor의 receipt 재사용 거절, 잘못된 명령을 같은 ID로 수정한 재시도, payload의 admin/memberId 위조에도 서버 역할 검사 유지를 확인한다. 기존 SSE·재접속·권한 회수 검사도 유지한다.
- 전체 자동 검사와 Windows 패키지 공동 연결/오프라인 충돌·AI 예약·멀티플레이 결과는 계획서 29절과 `out/r07-policy-*.log`에 기록한다. AI는 mock CLI다.

## 남은 R07

후속 명령 서비스 단위에서 receipt·sequence·reducer·저장·반영 결과를 분리하고 HTTP 없이 실제 SQLite 중단/재시도·재전송·권한 재검증을 확인했다(`server-command.md`, 계획서 30절). 프로젝트·멤버 관리도 분리했다(`server-projects.md`, 31절). 다음은 승인 요청 관리이며 AI/히스토리/수명 서비스와 나머지 route/bootstrap 분리가 뒤따른다. R08~R10과 F01~F04는 이번 단위에 포함하지 않는다.
