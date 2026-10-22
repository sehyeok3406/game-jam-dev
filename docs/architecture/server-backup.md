# 서버 백업·복원 경계

2026-10-22. R09 구현과 Windows 로컬/패키지 검증을 정리한다. 외부 S3·Linux 복원 완료를 뜻하지 않는다. 운영 명령과 남은 실증은 [백업·복원 운영 문서](../operations/backup-restore.md)를 따른다.

| 파일/경계                                                     | 책임                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `application/ports/backup-target.ts`                          | 검증된 immutable object의 put/get/list/remove 계약과 object key                                 |
| `adapters/backup/{local-target,s3-target}.ts`                 | 로컬 검사 저장소 및 서명된 S3 요청, 크기/SHA-256 검증. S3 SHA 미제공 시 전체 GET                |
| `server/operations/maintenance.ts`                            | 새 요청을 503으로 거절하고 이미 받은 쓰기를 정리한 뒤 한 세대를 캡처하는 gate                   |
| `server/operations/writer-lock.ts`                            | 프로세스가 종료돼도 OS가 해제하는 SQLite writer lease. 서버/중지 상태 CLI/복원/이전 간 배타성   |
| `server/operations/backup.ts`                                 | DB/복구 자료 캡처, archive 검증/원자적 완료, gate 밖 업로드/보관 정리, 실패 상태/최근 성공 시각 |
| `server/operations/{backup-files,backup-database,archive}.ts` | 허용 경로·링크/중복/크기 검사, manifest/DB/blob/복구 파일 일치, 스트리밍 컨테이너               |
| `server/operations/restore.ts`                                | 빈 staging, 원본 증거 보존, 검증 후 lifecycle identity 재등록, 목적지 재검증, 미완료 시작 차단  |
| `server/operations/migrate-host.ts`                           | 공유 파일 시스템의 source 동결→staged 검사→source retired→destination active/취소               |
| `server/operations/transfer-host.ts`                          | 공유 경로 없는 호스트의 최종 백업 인계, source 동결 확인, 대상 staging/검증/활성화              |
| `server/operations/backup-config.ts`                          | 명시적인 S3 환경 설정과 기본 24시간/외부 7개/로컬 2개 예약 정책                                 |

`bootstrap.ts`가 writer lease와 maintenance gate를 소유한다. 공개 생성/join/recover 및 프로젝트 요청 전체를 gate의 accepted 작업으로 추적한다. state 요청도 고아 AI 실행 만료를 저장할 수 있으므로 같은 경계에 포함한다. SSE/health와 메모리 multiplayer 방은 DB 세대의 writer로 취급하지 않는다. 기존 checkpoint timer는 snapshot 중 새 파일 작업을 시작하지 않는다.

`SqliteProjectRepository.backup()`은 현재 연결의 `node:sqlite.backup()`을 제공한다. 중지 상태 CLI는 읽기 전용 연결로 같은 API를 사용한다. schema 0의 원본은 백업 중 migration하지 않으며 복원된 서버를 시작할 때 R08의 migration 경계를 따른다.

`CollaborationClient`는 유지 gate의 503 등 재시도 가능한 heartbeat 오류에서 현재 lease를 보존한다. 영구 권한/실행 오류일 때만 해당 경로에서 lease를 비운다. snapshot 뒤 같은 lease의 heartbeat 재개를 회귀 검사로 확인했고, 서버의 기존 만료 정책은 변경하지 않았다.

백업은 DB 저장에 성공한 자료를 기준으로 한다. head가 없는 첫 export 실패, 이전 revision의 checkpoint, 아직 파일에 반영되지 않은 수명 표식 때문에 DB commit을 누락하지 않는다. 반대로 DB보다 앞선/다른 프로젝트의 checkpoint나 등록되지 않은 파일은 성공으로 넘기지 않는다. tombstone이 있는 프로젝트의 남은 export를 새 백업에 수집하지 않는다.

복원은 원본 archive와 파일 해시 검증을 먼저 끝낸다. 목적지 폴더의 dev/ino/birthtime을 새로 등록한 뒤 그 변환 증거와 최종 해시를 별도로 남긴다. source의 identity와 destination의 identity를 같은 값으로 취급하지 않는다. 미완료 `.restore-in-progress.json` 및 preparing/frozen/staged/retired/cancelled 이전 표식은 일반 서버 시작을 차단한다. staged 검사는 해당 이전 ID와 loopback 조건을 모두 만족해야 한다.

원격 인계에서는 다른 PC의 원본 상태를 로컬 파일로 확인할 수 없다. 따라서 먼저 원본을 동결하고 원본 지문을 별도 인계 기록으로 보존한다. 대상 활성화에는 운영자의 원본 동결·세션 검증 확인이 필요하며, 도구는 원본 표식을 해제하지 않는다. 자동 검사에서는 인공 기존 세션으로 실제 조회/수정/히스토리를 검증한다. 실제 운영 이전이나 주소 변경은 수행하지 않았다.

검사는 `tests/{collaboration-backup,backup-s3}.test.mjs`, `tests/server-assembly.test.mjs` 및 `tests/backup-packaged.mjs`에 있다. 후자는 최종 내장 Node/server의 예약 루프와 격리 TLS S3 프로토콜 fixture, CLI 다운로드/복원, 실제 역할·receipt·AI 고아/예약·휴지통·tombstone·재시작을 연결한다. 기존 package 7개 suite도 유지한다. 실제 외부 스토리지나 Linux에서 실행한 것으로 해석하지 않는다.
