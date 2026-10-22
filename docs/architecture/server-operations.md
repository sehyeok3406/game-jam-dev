# 서버 운영 경계

`collaboration-server-entry.ts`는 환경 설정을 읽고 같은 `createCollaborationServer`를 시작한다. standalone/Windows 내장 서버는 `scripts/build-server-bundle.mjs`의 동일 함수를 사용한다. 실행에 Electron·renderer·Discord·OS 자격증명 모듈을 포함하지 않는다.

| 책임                                           | 위치                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| 포트/host/서비스 모드/종료 설정                | `server/config.ts`                                               |
| 프록시 주소 신뢰                               | `server/http/peer.ts`; 명시 CIDR 경계에서만 X-Forwarded-For 해석 |
| HTTP 공통 진입/요청 기록/종료 거절             | `server/http/router.ts`                                          |
| 기존 health·준비 상태                          | `server/http/routes/health.ts`                                   |
| durable 요청 수락/일시 snapshot/영구 종료 gate | `server/operations/maintenance.ts`                               |
| 타이머·진행 요청·이벤트·저장소 종료 순서       | `server/lifetime.ts`                                             |
| 익명 요청 기록·bounded p95 표본·운영 상태 파일 | `server/operations/telemetry.ts`                                 |
| 공통 번들·입력/결과물 manifest·캐시            | `scripts/build-server-bundle.mjs`                                |
| Node/라이선스/PowerShell 파일별 해시 검증      | `scripts/build-self-host-runtime.mjs`                            |
| AST runtime import 검사·module 경계·실행 검증  | `scripts/verify-collaboration-bundle.mjs`                        |

번들 manifest는 실제 Vite module graph의 파일, package metadata, package/lockfile, 빌드 도구/스크립트, Node 버전·플랫폼·아키텍처와 출력 SHA-256/크기를 연결한다. 입력이나 출력의 변경/손상/누락이 발견되면 다시 빌드한다. 빌드 중 입력이 바뀌면 성공 manifest를 쓰지 않는다. 같은 프로세스의 중복 빌드 요청은 한 promise로 합친다. Forge preStart/generateAssets는 같은 검증 결과를 재사용한다. 캐시 강제 우회 옵션은 추가하지 않는다. `NODE-LICENSE.txt`는 같은 Node 바이너리/버전과 이전 검증 해시가 맞거나 원본 라이선스와 일치할 때만 재사용한다.

서버 검증은 manifest의 모듈 경계와 AST의 정적/동적 import, require를 검사하고 Node builtin 외 런타임 의존성이 남으면 거절한다. 결과물을 저장소 밖에서 실행해 의존성 누락을 함께 확인한다. 운영 CLI/검증 도구는 번들 실행과 달리 저장소 의존성이 필요하다.

수락한 업무가 끝나기 전에 저장소를 닫지 않는다. gate의 stop은 snapshot finally에서도 풀리지 않으며 HTTP 신규 진입과 WS access는 종료 상태를 확인한다. 종료 deadline은 기다림의 상한이며 pending 작업을 취소했다고 가정하지 않는다. standalone 진입점은 deadline 초과 시 프로세스를 실패로 종료하고 OS의 SQLite lock 해제를 이용한다.

`tests/server-operations.test.mjs`는 포트/모드/프록시 위조, 수락한 durable 쓰기와 종료 중 503/ready, 재시작 receipt, 종료 timeout, 플랫폼별 대소문자·링크 검사를 맡는다. `tests/server-bundle-smoke.mjs`는 동일 결과물의 실제 프로세스·역할·한글/PNG·SSE/WS·정상/강제 재시작·별도 폴더 복원을 검사한다. 실제 SIGTERM과 Linux 파일 시스템의 의미는 Linux job 성공 전에는 미검증이다. 운영 절차와 외부 확인 조건은 [Render 안내](../operations/render.md)에 있다.

R10 이미지 fixture로 확인한 백업 회귀도 보완했다. 체크포인트의 asset은 data URI를 decode한 실제 바이트로 비교하며, state에 등록됐지만 캡처에서 빠진 파일을 거절한다. `tests/collaboration-backup.test.mjs`의 binary checkpoint 검사가 정상 PNG 복원, 내용 손상, 누락 거절을 검증한다.

완료 재검토에서 확인한 저장 경고도 telemetry 경계로 옮겼다. `recoveryError`는 요청 관찰과 같은 프로세스별 HMAC 함수를 사용하며 고정 단계/문구만 남긴다. `tests/server-error-logs.test.mjs`는 같은 ID의 요청/경고 참조 일치, 다른 서버 인스턴스 간 참조 변경, 원본 ID/토큰/임의 단계 문자열의 제외를 검사한다. `tests/recovery-warnings.mjs`는 실제 runtime 파일·명시 checkpoint·수명 marker 실패를 만들고 DB 성공은 유지되는지 확인한다. 같은 시나리오를 독립/패키지 번들에서도 실행한다.

`tests/create-windows-backup-fixture.mjs`의 schema 2 archive에는 휴지통 identity, 삭제 tombstone과 별도의 옛 checkpoint, 실행 중 AI/대기 예약, 정확한 command receipt가 들어간다. `tests/transferred-backup.mjs`는 서버 시작 전의 snapshot 보존/identity rebinding과 시작 후의 의도된 AI 만료 처리를 나눠 검사한다. 파일·기존 이력·대기 예약·receipt는 보존하고, 실행 중 작업만 한 번 실패 처리한 뒤 추가 재시작과 재전송에서도 중복 변경이 없어야 한다. 오래된 fixture로 새 검증을 통과시킬 수 없다. Linux 실행 결과는 실제 Linux job에서 별도로 확인해야 한다.
