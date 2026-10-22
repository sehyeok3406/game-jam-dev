# R07 프로젝트·멤버 관리 서비스

2026-10-21. HTTP callback에 남은 생성·참여·복구·이름 변경과 초대·역할 변경·연결 종료를 업무 서비스로 분리했다. 주소·token·응답·파일·SQLite JSON 구조와 개인 로컬 사용 정책은 유지한다.

## 소유권

| 모듈                                 | 책임                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/project-state.ts`            | 기존 Member/StoredHistory/Job/Project/Lock의 타입 정의. 서비스가 서버 bootstrap을 import하지 않도록 분리하며 schema를 변경하지 않음                                        |
| `server/services/project-service.ts` | 생성 기본값·이름/자료 검사·기존 프로젝트 수 제한, 참여의 초대 정규화/검색/큐 안 재검증/인원 제한, 소유자 복구와 토큰/복구 키 회전, 이름 변경의 권한·AI·expectedName·재시도 |
| `server/services/member-service.ts`  | 초대 회전/만료·기록, 역할/제거 대상과 생성자/AI 실행자 보호, 연결 종료의 presence/잠금 정리                                                                                |
| `collaboration-server.ts`            | HTTP 생성 키·rate limit·body/응답, 프로젝트 디렉터리와 큐, 현재 actor/lifecycle/capability gate, token 암호학 구현, 저장·이벤트 adapter 조립                               |

프로젝트 서비스는 count/all/get 조회, 큐, 시계·ID·토큰 생성/비교, 인증·active 검사, 저장·history·envelope 등 필요한 port만 받는다. 멤버 서비스는 관리 권한·사본·기록/저장·응답과 presence/잠금 정리 port를 받는다. HTTP 객체나 서버 전체 context를 넘기지 않는다. 기존 state 타입을 별도 파일에 둔 이유는 서비스의 역방향 bootstrap 의존과 런타임 context 전달을 피하기 위해서다.

## 수명과 호환성

- 생성은 기존 순서로 snapshot/이름을 확인하고 관리자/owner·revision=1·문서 revision·hash/만료를 구성한다. 저장 후 인증 presence를 기록하고 자격 정보를 반환한다. 기존 20개 프로젝트의 조회 시점 제한을 유지하며 새 전역 생성 큐를 추가하지 않았다.
- 참여는 발견한 프로젝트의 큐에서 현재 프로젝트를 다시 읽고 active·초대 hash/만료·활성 멤버 20명 제한을 재검사한다. input role/owner를 무시하고 editor로 생성한다. 파일·revision·history를 새로 기록하지 않는다.
- 복구는 큐 안에서 현재 recoveryHash를 확인한다. 원래 owner를 복구하고 token/recoveryKey를 함께 회전한다. 삭제 프로젝트의 복구 응답은 관리 자격 정보를 반환하면서 files/revisions를 비우고 연결 거절 상태를 유지한다. 기존 복구 동작을 자동 참여/restore로 바꾸지 않는다.
- rename·초대·역할 변경은 이미 인증된 현재 actor와 프로젝트 큐 안에서 실행한다. 생성자 권한 회수/진행 중 AI 실행자의 역할 변경을 거절하고 이름 변경은 expectedName과 같은 이름 재시도 처리를 유지한다.
- leave는 presence와 해당 멤버의 현재 잠금만 정리한다. durable 멤버나 token을 삭제하지 않으며 새 role 정책을 넣지 않는다. 역할 변경 때 잠금을 해제하는 기존 persist 전 순서도 유지했다. 저장 실패 시 ephemeral 잠금까지 원복한다고 주장하지 않는다.

## 검증

`tests/server-projects.test.mjs`의 16개 회귀는 HTTP 없이 생성 기본값/원본/commit 대기·실패·한도/검증, 참여 권한 위조/정규화·큐 대기 중 초대 회전/만료/삭제·동시 인원 제한, 복구 키/토큰 회전·중복 복구·삭제 응답·저장 실패, 이름 변경 재시도·역할/AI 보호·leave를 확인한다. 실제 SyncStore/SQLite trigger 중단으로 참여/복구가 실패해도 멤버와 이전 자격 정보가 보존되는지, 재시도 후 저장소를 다시 열어 새 자격 정보를 읽는지도 검증한다.

최종 패키지의 실제 공동 생성/참여/복구/초대/역할/leave·오프라인 충돌 UI, 요청/저장 실패/SSE·AI 예약·멀티플레이 결과는 계획서 31절과 `out/r07-projects-*.log`에 기록한다. AI 연동은 mock CLI다.

## 다음 단위

R07 전체 완료가 아니다. 승인 요청의 목록/읽기·작성·수정·취소·보완은 후속 단위에서 분리했다(`server-approvals.md`, 계획서 32절). 다음은 승인 시작/서버 AI 조정이며 offline apply·히스토리/복원·프로젝트 수명과 나머지 route/bootstrap도 이어서 분리한다. repository/migration·commit 이후 복구 파일 실패 구분은 R08에 남긴다.
