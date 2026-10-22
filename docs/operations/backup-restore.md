# 협업 서버 백업·복원·호스트 이전 (R09)

2026-10-22. 구현과 Windows 로컬/패키지 검증을 제공한다. **실제 외부 S3 계정과 Windows→Linux 복원 실증은 대기 중**이다. 사용자가 현재 저장소가 없으므로 구현 후 외부 검증 항목을 남기도록 지정했다. 같은 디스크의 검사 저장소나 로컬 TLS S3 fixture를 외부 복구 성공으로 계산하지 않는다.

## 자료의 기준과 백업 형식

SQLite가 기준이다. 실행 중 DB는 Node의 `sqlite.backup()`으로 일관된 사본을 만든다. `sync.sqlite`만 일반 복사하지 않는다. 관련 API는 [Node 24.19.0 SQLite 문서](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options)를 기준으로 구현했다.

`.gjbackup`은 버전이 있는 스트리밍 컨테이너다. magic/manifest 길이/UTF-8 manifest 뒤에 등록된 파일 바이트를 순서대로 기록한다. tar/zip의 링크나 임의 경로 추출 의미를 사용하지 않는다. manifest에는 backupId, 생성 시각, 앱/schema/protocol 버전, 프로젝트 ID/revision/수명, tombstone, 디렉터리, 상대 파일 경로·크기·SHA-256이 들어간다. 전체 object 이름에도 SHA-256이 들어간다.

포함 자료는 DB 사본, 프로젝트별 공개된 head가 가리키는 체크포인트와 runtime, `.project-lifecycle`, `.project-trash`다. 이력·receipt·서버 멤버/token hash는 DB에 보존된다. 개인 PC의 OS 암호화 세션, CLI/봇의 개인 로그인, 호스트 설정/환경 변수, writer 잠금, 진단 로그는 수집하지 않는다. 등록되지 않은 체크포인트 파일은 업로드 전에 거절한다. 미완료 runtime/head 임시 파일과 공개되지 않은 체크포인트, purge한 프로젝트의 오래된 export, purge 후 빈 휴지통 상위 폴더는 백업 원본에 넣지 않는다. DB만 있고 첫 체크포인트가 실패한 프로젝트도 백업/복원할 수 있다.

초기 구현 한도는 압축하지 않은 백업 payload 4GiB, 파일+폴더 100,000개, manifest 16MiB다. S3는 단일 PUT을 사용한다. 초과하면 명확하게 중단하며 잘라서 성공 처리하지 않는다. 더 큰 자료와 multipart/압축은 별도 변경으로 검증해야 한다. 여유 디스크를 보수적으로 확인한 뒤 임시 사본·archive·검증용 추출을 진행한다.

완료 전에는 `.snapshot-*` 임시 폴더에만 기록한다. archive의 파일 해시·DB integrity/blob 참조·프로젝트/revision/수명/tombstone을 확인한 뒤 완료 이름으로 rename한다. 임시/중단 파일은 사용 가능한 백업 목록에 나오지 않는다. 실패한 임시 폴더는 소유한 경로임을 확인해 정리하고 원본을 지우지 않는다.

## 동시 실행과 운영 중 예약 백업

서버/CLI/복원은 같은 데이터 폴더의 `.writer.sqlite` 트랜잭션을 writer lease로 사용한다. 다른 writer는 즉시 중단한다. 프로세스가 죽으면 운영체제가 SQLite 잠금을 해제하므로 PID 파일을 강제로 지우는 우회는 필요 없다. 이전 버전 서버는 이 lease를 알지 못하므로 도구 사용 전에 서버가 중지됐는지 운영자가 확인해야 한다.

서버 안의 `BackupService`가 유지 gate를 닫고 이미 받은 요청·프로젝트 큐·체크포인트/수명 기록 작업을 기다린 뒤 한 세대의 DB와 파일을 캡처한다. 기본 정리 대기 한도는 15초다. 새 프로젝트/참여/복구/프로젝트 요청은 HTTP 503, `SERVER_MAINTENANCE`, `Retry-After: 2`로 응답한다. 기존 클라이언트가 같은 commandId와 초안을 보존하고 재접속 시 재생하는 것을 검사했다. gate는 실패/시간 초과에서도 해제한다.

파일 캡처가 끝나면 쓰기를 재개한다. archive 검증과 업로드는 별도로 실행하므로 업로드 중 편집을 계속할 수 있다. 한 service의 겹친 백업 요청은 같은 작업에 합쳐지고, spool에도 writer lease를 걸어 서로 다른 service가 같은 보관 폴더를 동시에 정리하지 못하게 한다. 종료 시 예약 timer를 멈추고 진행 중 백업을 기다린다. 진단/체크포인트 정리가 실패해도 나머지 종료 처리와 DB/writer lease 해제를 시도하고 첫 오류를 호출자에게 돌려준다.

백업 중 재시도 가능한 heartbeat 오류는 클라이언트의 AI lease를 지우지 않는다. snapshot이 끝난 뒤 같은 lease로 heartbeat를 재시도하는 것을 검사했다. 서버의 기존 lease 만료 시간과 고아 실행 복구 정책은 유지하므로 무제한 중단 없는 AI 실행을 보장하는 기능으로 해석하지 않는다.

설정이 없으면 예약 백업은 꺼져 있다. 아래 환경 변수는 서버 프로세스에만 설정한다. 비밀 값을 명령줄·소스·Git에 넣지 않는다.

| 환경 변수                             | 의미/기본값                                                              |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `GAMEJAM_BACKUP_S3_ENDPOINT`          | HTTPS S3 호환 endpoint. URL의 계정/비밀번호/query는 거절                 |
| `GAMEJAM_BACKUP_S3_BUCKET`            | 운영자가 마련한 비공개 bucket                                            |
| `GAMEJAM_BACKUP_S3_REGION`            | 저장소 region                                                            |
| `GAMEJAM_BACKUP_S3_ACCESS_KEY_ID`     | 해당 백업 prefix에 제한한 access key                                     |
| `GAMEJAM_BACKUP_S3_SECRET_ACCESS_KEY` | secret key                                                               |
| `GAMEJAM_BACKUP_S3_SESSION_TOKEN`     | 필요한 경우 session token                                                |
| `GAMEJAM_BACKUP_S3_PREFIX`            | 전용 prefix, 기본 `gamejam-backups`                                      |
| `GAMEJAM_BACKUP_SPOOL`                | 로컬 완료 archive/status 보관 폴더. 기본 데이터 폴더 옆 `<이름>-backups` |
| `GAMEJAM_BACKUP_INTERVAL_HOURS`       | 기본 24. 최초 백업도 첫 간격 뒤 실행                                     |
| `GAMEJAM_BACKUP_RETAIN`               | 외부 저장소 완료 object 보관 개수, 기본 7                                |
| `GAMEJAM_BACKUP_LOCAL_RETAIN`         | 로컬 완료 archive 보관 개수, 기본 2                                      |

필수 S3 항목 일부만 설정하면 시작을 중단한다. source/spool/local 검사 target은 서로 분리해야 한다. 사용자 bucket이나 유료 자원은 도구가 자동 생성하지 않는다. 외부 저장소의 접근 정책·TLS·자격 증명·실제 보관 위치는 운영 환경에서 검증해야 한다. 로컬 target은 자동 외부 백업을 대신하지 않는다.

AWS SDK v3 S3 client로 서명하고 immutable key/조건부 PUT·SHA-256을 사용한다. 업로드 뒤 저장소의 SHA-256과 크기를 대조한다. S3 호환 서비스가 SHA-256을 반환하지 않으면 전체 GET으로 내용을 검증한다. ETag나 직접 넣은 metadata만으로 성공 처리하지 않는다. [S3 object integrity 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html).

업로드 검증 뒤 전용 prefix의 오래된 완료 object를 정리한다. 새 object는 시스템 시각이 바뀌어도 삭제하지 않는다. 업로드 실패 시에도 로컬 archive는 기본 최근 2개로 제한하고 최신 검증 archive를 보존한다. `backup-status.json`에는 phase, 최근 시도/성공 시각, backup ID/key/해시/크기, 오류 단계 코드가 남는다. 실패는 서버 경고에도 표시한다. 이전 성공 시각을 새 성공으로 바꾸지 않는다.

매일 1회+외부 7개는 비공개 베타의 제안 기본값이다. 유료 서비스의 시간 단위 백업·일간/주간 장기 보관, 데이터 유실/복원 1시간 목표는 실제 외부 실증 전까지 보장이 아니다.

## CLI 사용

운영 도구에는 Node 24.19.0 이상과 이 저장소 checkout/설치한 의존성이 필요하다. 패키지 검사는 앱에 포함된 Node로도 같은 저장소의 CLI를 실행했다. CLI 소스 자체를 설치 앱에 독립 실행 파일로 배포한 것은 아니다. 다음 명령의 경로는 운영자가 선택한 별도 경로로 바꾼다.

중지된 서버의 수동 백업:

```powershell
node scripts/backup-collaboration.mjs --data C:/server/data --spool D:/backup-spool
```

이 명령은 위 S3 환경 변수를 사용한다. 로컬 기능 검사만 할 때는 별도 target을 지정한다.

```powershell
node scripts/backup-collaboration.mjs --data C:/test/data --spool C:/test/spool --target-dir C:/test/storage
```

로컬 archive 검증과 복원:

```powershell
node scripts/verify-collaboration-backup.mjs --archive D:/backup-spool/선택한.gjbackup
node scripts/restore-collaboration.mjs --archive D:/backup-spool/선택한.gjbackup --destination C:/server/restored-staging
```

S3에서 선택한 object를 내려받아 검증/복원할 수도 있다. key는 성공 기록이나 저장소 목록의 정확한 object 이름이다.

```powershell
node scripts/verify-collaboration-backup.mjs --key 선택한-object.gjbackup
node scripts/restore-collaboration.mjs --key 선택한-object.gjbackup --destination C:/server/restored-staging
```

`--archive`와 `--key`는 동시에 사용하지 않는다. `--target-dir`는 S3 대신 로컬 검사 저장소에서 내려받는 선택지다. 비밀 값은 출력하거나 인자로 받지 않는다.

## 복원 보장과 중단 처리

대상은 존재하지 않거나 비어 있는 별도 폴더여야 한다. live 데이터 위에 덮어쓰지 않는다. writer lease를 얻은 뒤 `.restore-in-progress.json`과 임시 staging을 만들며, 서버는 그 표식이 남은 폴더를 열지 않는다. 검증 실패 시 자료/표식을 남기므로 원인을 확인하고 새 빈 대상으로 다시 복원한다. 실패한 복원을 이유로 원본이나 staging을 자동 삭제하지 않는다.

추출 전후 경로를 제한하고 symlink/junction/hardlink, 중복·대소문자/NFC 충돌, 탈출/절대 경로, Windows 예약 이름·stream 경로를 거절한다. manifest 크기/개수/전체 byte 한도도 검사한다. 파일 해시와 SQLite `integrity_check`, 본문 blob, 프로젝트 ID/revision, 수명/tombstone, head/state/등록 파일을 확인한다. source archive 자체가 검사 도중 바뀌어도 중단한다.

원본 archive의 inode/dev/birthtime은 다른 폴더/OS에서 사용할 수 없다. 먼저 원본 archive와 파일 해시 검사를 끝내고, 검증된 staging 폴더에 한해서 lifecycle identity를 새 값으로 바꾼다. `.restore-report.json`에 원본 archive 해시/파일 목록/프로젝트 상태, identity 변환 전후 값, 목적지 변환 뒤 해시/상태를 각각 남긴다. identity 변경을 이유로 원본 해시 검사를 생략하지 않는다.

저장된 `trashing/restoring/purging`은 서버의 기존 유지 작업에서 재개한다. purge tombstone은 계속 남아 오래된 checkpoint로 프로젝트가 재생성되지 않는다. 복원된 실행 중 AI lease는 기존 고아 실행 복구 경로에서 실패 처리하고 같은 run을 자동 재실행하지 않는다. queued 예약과 run ID는 유지한다. 검사는 가짜 작업/세션만 사용하며 개인 AI 계정을 실행하지 않는다.

## 같은 파일 시스템에서의 이전

서버를 중지한 다음 준비한다. source는 최종 백업을 만든 뒤 동결되고, destination은 staged 상태라 일반 시작이 거절된다.

```powershell
node scripts/migrate-collaboration.mjs --action prepare --source C:/server/data --destination D:/server/staged --spool D:/spool
node scripts/migrate-collaboration.mjs --action check --source C:/server/data --destination D:/server/staged --id 이전-ID
```

`check`는 loopback에서 격리 서버의 시작/복구/protocol을 확인한다. 실제 테스트 세션의 읽기/수정/히스토리/권한/재연결은 운영자가 따로 확인해야 한다. 자동 검사에서는 기존 인공 세션으로 실제 읽기/수정/히스토리까지 실행한다. 확인 후에만 활성화한다.

```powershell
node scripts/migrate-collaboration.mjs --action activate --source C:/server/data --destination D:/server/staged --id 이전-ID --verified-sessions
```

소스를 retired로 기록한 뒤 대상을 active로 바꾼다. 중간 실패는 두 쪽을 차단한 상태로 남겨 재시도할 수 있다. 활성화 전 취소는 `--action cancel`로 대상 staged를 cancelled로 차단한 뒤 소스만 다시 연다. 이미 active인 대상을 이 명령으로 취소하지 않는다. 검증 후 프로젝트 revision/수명이 바뀌면 활성화를 거절한다.

## Windows→Linux 등 공유 경로가 없는 호스트 이전

원본 Windows에서 최종 세대를 동결하고 인계 기록을 만든다.

```powershell
node scripts/migrate-collaboration.mjs --action freeze --source C:/server/data --spool D:/spool
```

출력된 `handoff-<이전-ID>.json`은 원본 동결 사실과 backup ID/전체 SHA-256/프로젝트 revision을 담고 있다. 비밀 키나 원본 절대 경로를 담지 않는다. 운영자가 이 파일을 별도로 보존·전달한다. 원본 서버는 동결 표식 때문에 일반 시작이 계속 거절된다.

Linux에 Node/checkout/의존성과 비공개 S3 설정을 준비한 뒤 인계 기록과 일치하는 백업으로 staging을 만든다. 다음 명령은 구현된 휴대 가능한 절차이며, 현재 PC에서 실제 Linux로 실행했다는 뜻은 아니다.

```bash
node scripts/migrate-collaboration.mjs --action stage --handoff ./handoff-ID.json --key OBJECT.gjbackup --destination /var/data/game-jam-staged
node scripts/migrate-collaboration.mjs --action check-transfer --destination /var/data/game-jam-staged --id ID
```

archive가 인계 기록의 hash/크기/backup ID/revision과 다르면 거절한다. 로컬 archive를 전달했다면 `--key` 대신 `--archive`를 사용한다. 격리 서버 확인 후 실제 테스트 세션의 읽기/수정/히스토리/권한/재연결과 외부 주소를 운영자가 확인한다.

```bash
node scripts/migrate-collaboration.mjs --action activate-transfer --destination /var/data/game-jam-staged --id ID --source-frozen --verified-sessions
```

이 단계는 공유 파일 시스템이 없으므로 원본 상태를 네트워크로 추측하지 않는다. 운영자가 원본이 계속 동결돼 있음을 명시적으로 확인해야 한다. 원본 동결을 해제하지 않고 대상만 active로 바꾼 다음 사용자에게 새 주소를 적용한다. 주소 변경은 데이터 복사가 아니며, 두 쪽을 동시에 정본으로 켜지 않는다. 잘못된 표식을 강제 무시하는 서버 옵션은 제공하지 않는다. `migrationCheckId`는 일치하는 staged 세대의 loopback 검사에만 사용하고 공개 연결에는 사용할 수 없다.

## 검증 상태

- Windows 로컬 자동 검사: 실제 HTTP 요청·503/같은 ID 보존·업로드 중 쓰기·writer 충돌/강제 종료·구형 DB·손상/탈출 archive·수명 중단 단계·AI 고아 복구·tombstone·보관 한도·CLI·인계 흐름을 검증한다.
- S3 어댑터: 격리 HTTP 프로토콜 fixture로 SDK 서명·조건부 PUT·checksum/크기·SHA 미제공 시 GET·업로드 거절/손상을 검증한다.
- 최종 패키지: 내장 Node/server를 격리 TLS S3 fixture와 연결해 예약 업로드와 다운로드 복원을 검증한다. 테스트용 CA는 해당 자식 프로세스에만 제공하고 Windows 신뢰 저장소나 운영 TLS 설정을 바꾸지 않는다.
- **남음:** 실제 비공개 외부 저장소에 업로드한 세대를 원본 서버/디스크 없이 복구, 실제 Windows archive의 Linux 복원·권한/재연결·종료/재배포, 운영 보관 정책/복구 목표 실증. 이 결과가 없으므로 R09 전체 완료 조건을 충족했다고 보고하지 않는다.

물리 디스크 장애·전원 차단, 실제 외부 계정·S3·Linux/Render, 운영 데이터 이전은 별도 실증 항목이다. R10의 readiness/draining·프록시 rate limit·Linux 배포 준비와도 구분한다. 실제 검사 수와 package 해시는 실행 계획 41절에 기록한다.
