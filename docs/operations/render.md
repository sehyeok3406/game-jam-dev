# 협업 서버 Linux·Render 운영 준비

이 문서는 R10의 배포 준비 절차다. 실제 Render 서비스나 디스크는 생성하지 않았다. 현재 PC의 Windows 검증과 실제 Linux/Render 검증은 구분한다. Linux CI 결과가 없으면 Linux 검증 완료로 표시하지 않는다. R09의 실제 외부 S3 복구도 별도 미완료 조건이다.

## 실행과 설정

Node는 루트 `.node-version`의 **24.19.0**으로 고정한다. 버전을 바꿀 때 Linux/Windows 결과와 번들 증거를 함께 갱신한다. 서버는 `.env`를 자동으로 읽지 않는다. `.env.example`은 환경 변수 설정용 참고 자료다. 서버 생성 키와 S3 비밀 값은 서버 환경에만 넣는다.

```sh
# 서버 전용 Linux 설치: Electron 실행 파일은 필요 없음. 빌드 도구는 필요함.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --include=dev
npm run test:server
npm run collaboration:build
npm run collaboration:verify
node out/collaboration-server/server.mjs
```

`npm start`는 데스크톱 앱 실행 명령이다. 독립 서버는 위의 `.mjs`를 실행한다. 검증 도구는 임시 데이터·임의 포트·합성 세션을 사용하고 서버 번들을 저장소 밖으로 복사해 실행한다. 검증 시 운영 데이터나 외부 백업 계정은 사용하지 않는다. 번들 실행 자체에는 `node_modules`가 필요 없고, 빌드·검증 및 R09 운영 CLI에는 저장소와 개발 의존성이 필요하다.

| 환경 변수                 | 기본값 / 의미                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `GAME_CANVAS_HOST`        | `127.0.0.1`. Render에서는 `0.0.0.0`                                                          |
| `GAME_CANVAS_PORT`        | 우선 사용. 없으면 `PORT`, 둘 다 없으면 `4317`. 1~65535의 정수                                |
| `GAME_CANVAS_DATA`        | `./collaboration-data`. Render에서는 `/var/data/game-jam`                                    |
| `GAME_CANVAS_PUBLIC`      | `0`. 공개/터널 서버는 `1`; 비 loopback host도 공개 서버 생성 키 검사 적용                    |
| `GAME_CANVAS_SERVER_KEY`  | 공개/비 loopback 또는 managed-beta에서 최소 32자의 무작위 키                                 |
| `GAMEJAM_SERVICE_MODE`    | `self-host` 기본. `managed-beta`는 생성 키 필수. `managed`는 F01 인증·권한 구현 전 시작 거부 |
| `GAMEJAM_TRUSTED_PROXIES` | 기본 빈 값. 운영자가 확인한 프록시 IP/CIDR을 쉼표로 구분                                     |
| `GAMEJAM_SHUTDOWN_MS`     | `25000`; 1000~25000 범위. 정상 종료 정리의 상한                                              |

서비스 모드는 서버 설정으로 고정된다. 요청 본문의 `paid`·`selfHost`·`serviceMode`로 권한을 바꾸지 않는다. 베타 프로젝트는 운영자가 생성 키를 사용해 만들고, 사용자는 초대로 참여한다. 이 모드는 회원 가입·결제·서비스 계정 인증 기능을 제공하지 않는다. F01/F02는 별도 기능 작업이다. 기존 개인 로컬 사용과 PC에서 실행하는 AI 흐름은 유지한다.

## Render 설정

루트 `render.yaml`은 Node web service 1개, `/var/data` 영구 디스크 5GB, `managed-beta`, `/ready` health check, `autoDeployTrigger: off`를 지정한다. `GAME_CANVAS_PORT`는 지정하지 않아 플랫폼의 `PORT`를 사용한다. 생성 키는 `sync: false` 입력이며 값은 파일에 넣지 않는다. 백업 S3 계정은 [백업·복원 안내](backup-restore.md)에 따라 별도로 설정한다.

Blueprint를 실제로 생성하면 유료 서비스·디스크가 생성된다. 현재 작업은 설정 파일 준비까지이며 생성·배포·운영 자료 이전을 수행하지 않았다. [Render의 Blueprint 항목](https://render.com/docs/blueprint-spec)을 기준으로 작성했다.

Render build command는 `npm ci --include=dev && npm run collaboration:build && npm run collaboration:verify`다. 같은 build command에서 생성한 `out/collaboration-server/server.mjs`를 검증하고 start command가 그 파일을 그대로 실행한다. 기존 출력의 입력/결과물 해시가 다르면 재빌드한다. 자동 배포는 꺼두고 검증한 소스의 commit을 지정해 수동 배포한다.

영구 디스크는 런타임에만 접근 가능하므로 migration은 서버의 listen 전에 실행하고 예약 백업은 서버 내부 관리 루프에서 실행한다. 디스크 없는 pre-deploy/별도 job에서 운영 SQLite를 변경하지 않는다. 단일 SQLite 인스턴스를 여러 프로세스·cluster·복제 인스턴스에 연결하지 않는다. 파일 잠금은 두 번째 writer의 시작을 거부한다. [영구 디스크 제약](https://render.com/docs/disks).

디스크가 연결된 서비스는 재배포 중 중단된다. 디스크 서비스의 종료 대기 시간은 별도로 늘릴 수 없어 앱 종료 상한은 기본 플랫폼 대기보다 짧은 25초로 설정했다. [배포와 graceful shutdown](https://render.com/docs/deploys#graceful-shutdown). 포트와 Node 설정은 [Web Services](https://render.com/docs/web-services), [Node version](https://render.com/docs/node-version)을 따른다.

## 준비 상태와 종료

- `/health`: 기존 이름·프로토콜·capabilities·앱 버전 계약 유지.
- `/ready`: startup DB migration·자료 복구가 완료되어 listen한 후 `{ "ready": true }`와 200. 백업 snapshot 중 또는 종료 중에는 503. 시작 복구 실패 시 포트 자체를 열지 않는다.
- 종료: 신규 변경/SSE/WS 진입 차단 → 예약 작업 정리 → 수락한 쓰기의 durable 완료 대기 → SSE·WS 종료 → HTTP 응답 정리 → queue/checkpoint flush → 저장소·writer lock 해제.
- 종료 중 새 HTTP 요청은 health/ready를 제외하고 `503`, `SERVER_MAINTENANCE`, `Retry-After: 2`다. 같은 commandId를 재전송한다. 임시 백업 snapshot 해제가 영구 종료 gate를 다시 열지 않는다.
- SIGINT/SIGTERM은 한 번만 정리하고 성공은 exit 0, 정리 실패/상한 초과는 exit 1이다. Windows 검증은 제품 밖의 IPC harness가 SIGTERM 프로세스 이벤트를 발생시켜 같은 종료 로직을 실행한다. 실제 OS SIGTERM 전달 검사는 Linux job에서 수행한다. Windows의 `child.kill()`은 강제 종료 검사에만 사용한다.
- 강제 종료는 writer lock을 OS가 해제한다. SQLite FULL WAL과 durable receipt의 재시작/같은 commandId 재전송을 검증한다. 이것은 물리 디스크 고장·정전 실증을 뜻하지 않는다.

## 프록시와 요청 제한

기본값은 socket peer를 사용하며 `X-Forwarded-For`와 `Forwarded`를 신뢰하지 않는다. 운영자가 직접 통제하며 ingress의 주소 덧붙임/정리 동작을 확인한 프록시 IP/CIDR만 `GAMEJAM_TRUSTED_PROXIES`에 넣는다. 지정된 프록시부터 오른쪽으로 역추적해 처음 만난 비신뢰 주소를 요청의 identity로 삼는다. 형식 오류·과도한 길이·16 hop 초과는 socket peer로 되돌린다.

Render 내부 프록시 CIDR을 임의로 추측하거나 모든 네트워크를 등록하지 않는다. 실제 ingress 경로가 확인되기 전에는 빈 설정을 유지한다. 이 경우 같은 proxy peer의 create/join/recover 및 project ingress 예산이 공유된다. 인증 후 member/project별 제한은 계속 적용된다. 실제 배포 전 합법적인 동시 연결이 공유 예산에 막히지 않는지와 외부 헤더 위조가 제한을 우회하지 않는지 확인한다. 프록시 헤더는 인증·권한·Origin 허용의 근거로 사용하지 않는다. 초기 서버의 Origin 차단을 유지한다.

## 운영 기록

독립 서버 기본 요청 로그는 JSON 한 줄이다. 서버가 생성한 requestId, 정규화한 route, 상태 코드, 소요 시간, 프로세스별 HMAC으로 익명화한 프로젝트 참조만 남긴다. 임의 경로/알 수 없는 action은 일반 이름으로 바꾸고 query·본문·Authorization·생성 키·초대/복구 키를 기록하지 않는다. 응답 `X-Request-Id`로 요청을 구분한다. SSE 로그 소요 시간은 연결 수명이며 일반 요청 p95 샘플에서는 제외한다.

DB commit 이후 runtime/checkpoint/수명 표식 저장이 실패한 경고도 같은 HMAC 참조를 쓴다. JSON `recovery-pending` 이벤트는 고정 안내 문구·checkpoint/lifecycle 단계·익명 프로젝트 참조만 기록한다. 예외 메시지·원본 project ID·폴더 경로를 덧붙이지 않는다. 서버 인스턴스가 바뀌면 참조도 바뀌며, 같은 인스턴스의 요청 로그와 경고는 같은 참조로 연결할 수 있다.

`GAME_CANVAS_DATA/operations-status.json`은 30초마다, 시작/정상 종료 시 기록한다. 외부 공개 endpoint가 아닌 운영자용 파일이다. 기록 실패는 일반 오류 코드만 경고하며 저장된 프로젝트의 성공 응답을 되돌리지 않는다.

| 항목                                        | 의미                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| requests / failures / aborted / failureRate | 프로세스 누적 완료/거절/중단 요청; 4xx도 실패에 포함                |
| requestP95Ms / saveP95Ms                    | 최근 최대 256개 표본의 p95; save는 project persist 경계의 비용      |
| saveFailures                                | persist 실패 누적                                                   |
| rssBytes / eventLoopP95Ms                   | 프로세스 메모리 / event loop 지연 p95                               |
| diskFreeBytes / diskTotalBytes              | data volume의 사용 가능한 공간 / 전체 공간                          |
| backup                                      | 현재 백업 단계·최근 성공 시각·검증 object; 비설정이면 enabled=false |

백업 성공 시각은 R09의 `backup-status.json` 및 실제 외부 object와 함께 확인한다. 재시작 후 다음 백업 전에는 운영 상태의 backup 값이 초기 상태일 수 있으므로 기존 backup-status 파일의 최근 성공 기록도 읽는다. 메모리·디스크 70% 초과 또는 목표 네트워크에서 저장 p95 1초 지속 초과는 분석을 시작할 계획 기준이다. 현재 수용 인원이나 복구 시간 보장은 아니다. R08에서 발견한 본문 캐시 증가 최적화는 별도 후속 작업이다.

## CI와 실제 배포 전 확인

`.github/workflows/ci.yml`은 타입·린트·Windows 기본 테스트를 분리한다. Linux job은 명시한 서버 테스트와 같은 번들의 실행 검사를 수행한다. 서버 전용 Linux 설치에는 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`을 사용한다. 전체 Windows 테스트에는 실제 Electron 기반 검사가 있으므로 Windows job은 Electron을 설치한다.

Windows job은 합성 프로젝트/문서/PNG/이력/조회자 권한과 휴지통·삭제 tombstone·진행 중 AI 1개/대기 예약 1개·durable command receipt가 있는 `.gjbackup`을 실제 Windows에서 생성한다. schema 2 미만의 오래된 fixture는 거절한다. fixture 생성은 빈 출력 폴더를 요구하며 `node tests/create-windows-backup-fixture.mjs --output <새 폴더>`로 별도 결과를 만들 수 있다.

Linux job은 그 artifact를 별도 폴더에 복원한다. 서버 시작 전 DB의 파일·이력·AI/receipt를 원본과 대조하고 휴지통의 새 폴더 identity를 검증한다. 삭제된 프로젝트의 오래된 Windows checkpoint를 추가해도 tombstone 때문에 되살아나지 않아야 한다. 서버 시작 후 진행 중 AI는 한 번만 실패 처리되고 대기 예약의 task/run ID·입력 자료는 유지되어야 한다. 같은 commandId를 두 번 재전송해도 원래 결과/이력 ID가 반환되고 저장·이력이 추가되지 않아야 한다. 휴지통 복원과 권한 검사 후 한 번 더 프로세스를 재시작해 같은 조건을 확인한다. 실제 AI 공급자나 실행기는 호출하지 않는다.

검증 JSON의 `windowsArchiveRestored`는 실행한 OS 이름이고 `windowsFixtureChecks`는 각 사례의 결과다. 로컬 win32 성공은 Linux 성공이 아니다. 테스트용 세션이며 운영 데이터·계정은 포함하지 않는다. 이 교차 OS CI는 외부 S3 저장소 복구 실증을 대체하지 않는다.

```sh
# 동일 번들에서 선택적으로 수행하는 5프로젝트×4클라이언트 부하 fixture
npm run collaboration:verify -- --windows-fixture out/ci/windows-backup --load
```

fixture는 프로젝트마다 문서 50개+PNG 1개, 순차 저장 20개, 동시 layout 변경 20개, 새 클라이언트 재연결 20개를 검사한다. 성공률/명령 p95/저장 p95/RSS/DB·백업 크기/event loop 지연을 `.verification.json`에 기록한다. 짧은 loopback 실험이므로 외부망·장기 메모리 증가·서비스 인원 보장으로 안내하지 않는다.

실제 배포 전에 다음 증거를 확보한다.

1. Linux CI의 명시 서버 테스트·독립 번들 실행·SIGTERM·Windows archive 복원 성공과 SHA-256.
2. 실제 비공개 외부 S3의 백업을 원본 디스크 없이 새 환경에서 복구한 기록.
3. 실제 Render ingress의 헤더·Origin·rate limit·HTTPS·SSE·WS·재배포 중 초안/같은 commandId 재연결 확인.
4. 운영자·편집자·조회자 및 두 프로젝트 격리, 휴지통/복원/완전 삭제, 실행기 PC 종료 시 AI 상태 확인.
5. 외부 계정·도메인·디스크/보관 정책과 원본 freeze→stage→격리 검사→활성화 절차 확정. 주소 전환과 롤백 판단은 [R09 안내](backup-restore.md)를 따른다.

CI 파일 작성이나 로컬 Windows 성공을 Linux/Render 실행 성공으로 표시하지 않는다. 실제 서비스 생성·배포와 운영 자료 이전은 별도의 배포 작업에서 수행한다.
