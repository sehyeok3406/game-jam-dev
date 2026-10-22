# 협업 저장소와 복구 파일 경계 (R08)

2026-10-22. 서버의 데이터 기준은 SQLite의 committed 프로젝트다. 파일 체크포인트는 복구 자료이며 HTTP 성공 여부나 명령 재실행의 기준이 아니다.

| 경계                                                    | 책임                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `application/ports/collaboration-project-repository.ts` | `loadAll/load/commit/tombstone/tombstones/purge/close`의 비동기 계약. 프로젝트 큐는 호출자가 소유한다.                             |
| `adapters/sqlite/project-repository.ts`                 | 기존 프로젝트 JSON·본문 hash와 FULL WAL 트랜잭션. 파일·이력·receipt를 한 번에 저장한다. 읽기 전용 게시/멤버 projection도 제공한다. |
| `adapters/sqlite/migrations.ts`                         | 스키마 0→1 migration 및 미지원 버전 차단.                                                                                          |
| `server/persistence/project-persistence.ts`             | DB commit 후 현재 프로젝트 공개, 복구 기록의 재시도·프로젝트별 export 순서·종료 flush.                                             |
| `server/persistence/checkpoint-store.ts`                | runtime/head/checkpoint 기록과 기존 폴더 복구. 다른 프로젝트 ID나 비활성 자료의 복구를 거절한다.                                   |
| `server/persistence/lifecycle-store.ts`                 | 삭제 수명 표식, 실패 기록의 재시도, 같은 프로젝트 표식의 순서 보존.                                                                |
| `sync-store.ts`                                         | 기존 도구/검사의 동기 `SyncStore`·`readSyncFiles` 호환 진입점. 서버는 repository port를 사용한다.                                  |

## 데이터와 스키마

기존 `blobs`, `projects`, `project_tombstones`와 프로젝트 JSON을 유지한다. schema version 0의 인공 구형 DB를 열 때 `schema_migrations`와 `PRAGMA user_version=1`을 한 트랜잭션으로 기록하며, 기존 프로젝트 JSON·본문을 다시 쓰지 않는다. migration 실패는 새 테이블/버전까지 rollback한다. 예상보다 새로운 스키마는 journal 설정이나 테이블 생성 전에 중단하며 연결을 닫는다. 읽기 전용 projection은 schema 0도 그대로 읽고 migration을 수행하지 않는다.

SQLite adapter의 비동기 메서드 안에서 DB 트랜잭션은 동기적으로 끝난다. 외부 네트워크나 파일 export를 기다리지 않는다. 저장 실패는 본문 hash 캐시도 비워, rollback된 blob을 후속 저장에서 누락하지 않는다. 로드할 때 현재/이력의 본문 누락과 SHA-256 불일치를 오류로 처리한다.

purge는 tombstone과 프로젝트 삭제·참조 없는 blob 정리를 한 번에 commit한다. 이후 WAL 정리는 별도 유지 작업이다. tombstone 확인은 쓰기 트랜잭션 안에서 수행하므로 완전 삭제된 ID를 다시 저장할 수 없다. 다른 프로젝트/이력에서 참조하는 blob은 유지한다. bootstrap은 tombstone의 읽기 사본으로 기존 동기 404/410 응답 계약을 유지하며, purge commit 뒤에만 그 사본을 갱신한다.

## 저장 성공과 복구 기록 실패

DB commit이 실패하면 candidate를 현재 프로젝트로 바꾸거나 성공 이벤트를 보내지 않는다. lifecycle도 단계마다 복제한 candidate를 저장하므로 실패한 trash/restore의 상태가 현재 객체로 새지 않는다. 파일 이동 뒤 최종 저장이 실패하면 이미 저장한 중간 수명 단계에서 재시작/유지 작업으로 재개한다. async purge는 tombstone commit을 기다린 뒤 표식/메모리 제거를 진행한다.

DB commit 뒤에는 현재 프로젝트를 확정한다. 수명 표식이나 runtime/첫 체크포인트 기록이 실패해도 확정된 명령을 실패로 돌려주지 않는다. 같은 요청 ID의 receipt는 원래 결과를 돌려주고, 서버 재시작은 DB의 확정 자료를 읽는다. 복구 기록의 실패는 프로젝트 ID·단계만 포함한 경고와 재시도 대상으로 남기며, 기존 30초 유지 주기와 종료 flush에서 다시 기록한다. raw 오류에 포함될 수 있는 문서·비밀 값은 경고에 출력하지 않는다.

runtime과 checkpoint 작업은 프로젝트별 동일 queue에서 실행해 timer export와 새 commit이 임시 runtime 파일을 동시에 쓰지 않는다. 수명 표식도 순서를 보존하며, 오래된 재시도가 최신 표식을 덮지 않는다. 활성 DB 자료는 시작 시 복구 export 대상으로 등록해 이전 프로세스의 실패 작업을 복구한다. 종료 flush가 실패해도 DB 연결은 finally에서 닫고, 종료 호출자는 오류를 받는다.

`readPublication`은 활성 프로젝트의 이름/revision/현재 파일만 반환한다. 비공개 이력·참여 세션·초대/복구 정보·AI 설정을 게시 projection에 포함하지 않는다. `readProjectMembers`는 self-host의 로컬 세션 소유권 확인에 필요한 token hash/removed만 읽는다. 웹 게시 및 self-host는 SQL을 직접 조회하지 않고 이 읽기 전용 경계를 사용한다. DB가 있는 경우 누락된 행을 오래된 파일로 대체하지 않는다.

## 한도와 오래된 요청

`contracts/server-limits.ts`에 이력 300개, receipt 500개, 파일 500개, 프로젝트 20개, 참여자 20명과 기존 본문/요청 바이트 한도를 모았다. 제품 한도와 프로토콜 버전은 유지한다.

property-sync 명령은 기존 `sequences` map에 참여자/세션 전체 요청의 high-water mark도 저장한다. 객체별 순번만으로는 receipt가 제거된 생성/no-op 요청의 재전송을 막을 수 없기 때문이다. 보관된 receipt는 순번 검사보다 먼저 원래 결과로 재생한다. 제거된 receipt의 과거 순번은 생성 전에 거절하며, 실패한 트랜잭션은 순번을 소비하지 않는다. 기존 클라이언트는 revision 검사와 기존 기능 gate를 유지한다. offline 변경도 기존 파일 revision으로 오래된 덮어쓰기를 거절한다. receipt 보관 기한 밖의 모든 과거 클라이언트 요청을 무제한 중복 제거한다고 주장하지 않는다.

## 검사와 측정

- `tests/sqlite-project-repository.test.mjs`: schema 0/1/미지원 버전, migration rollback, 읽기 전용 projection, DB/blob/history/receipt rollback, 두 연결/프로젝트 큐, blob 누락/손상, purge/tombstone, export 실패/재시도/순서.
- `tests/server-command.test.mjs`: 실제 501회 commit 후 생성 receipt 제거와 재시작 후 과거 순번 거절. 기존 scoped revision/권한 검사 유지.
- `tests/server-lifecycle.test.mjs`: 초기 commit 실패의 객체 보존, 최종 active 저장 실패 후 restoring 재개, 비동기 purge 완료 순서.
- `tests/repository-packaged.mjs`: 최종 패키지 내장 Node/server로 구형 DB 열기/갱신, 실제 post-commit 파일 오류와 같은 ID 재생, 강제 프로세스 종료 뒤 복구, 휴지통/복원/purge, 구형 checkpoint 재등장 차단, 미지원 스키마의 무변경 실패. `--source`로 소스 서버도 실행할 수 있다.
- `scripts/measure-collaboration-storage.mjs`: 임시 인공 자료만 사용해 전체 로드·실제 서버 시작·저장 시간·RSS/heap·DB 크기·본문 캐시를 측정한다. `node --expose-gc scripts/measure-collaboration-storage.mjs`로 재현하며 기본 출력은 `out/r08-storage-measurement.json`이다. warm filesystem cache와 같은 프로세스에서의 측정이며 운영 성능 보장이 아니다.

측정에서 이력은 300개로 유지해도 추가 저장마다 hash 캐시의 본문이 남는 현상을 확인했다. **후속 최적화는 bounded cache와 참조 없는 blob 정리 정책을 먼저 설계하고, lazy loading/이력 조회 분리는 별도 성능 변경으로 검증한다.** 이번 R08에서 저장 모델이나 캐시 정책을 함께 바꾸지 않는다. 백업·외부 저장소·Windows→Linux 이전은 R09, readiness/draining·프록시 rate limit·Linux/Render 실행은 R10이다.

최종 검사 수·실제 패키지 기록·측정값은 실행 계획 40절을 참조한다. 인공 SQLite 오류와 프로세스 종료 검사는 물리 디스크 장애나 전원 차단 검증을 뜻하지 않는다.
