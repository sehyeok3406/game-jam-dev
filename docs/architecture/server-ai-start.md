# R07 승인 시작·서버 AI 시작 조정

2026-10-21. `requests-start`·`ai-start`·`ai-claim`의 공유 시작 흐름을 `server/services/ai-coordinator.ts`로 추출하고 승인 요청 재전송/검토 준비를 `approval-execution.ts`로 나눴다. 서버는 AI 실행 권한과 공유 상태를 조정하며 실제 CLI 프로세스는 기존 PC 실행기에 남긴다.

## 경계

| 모듈                      | 책임                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval-execution.ts`   | 현재 요청/commandId, 예약/실행 재전송의 revision·reviewToken·provider/model/reasoning 일치, 현재 요청 상태와 입력 검토, 원래 queuedTask 또는 같은 실행자의 lease 재사용 |
| `ai-coordinator.ts`       | 관리자·제공자/모델/추론 검증, FIFO claim/기존 임대, task/capability/편집 잠금·입력/출력 사전 검사, 예약/실행 후보·동결 요청·job/lease·히스토리의 저장과 응답            |
| `collaboration-server.ts` | 공통 ingress/큐 내부 인증·lifecycle·capability·AI 만료, 실제 planApproval, 저장/이벤트·현재 편집 잠금·토큰·시계·ID와 서비스 조립                                        |

서비스는 이미 인증된 현재 프로젝트 actor와 기존 프로젝트 큐 안에서 호출한다. 큐를 다시 획득하지 않고 서버 전체 context·HTTP 객체·CLI 계정을 받지 않는다. 저장·envelope·사본·관리자 검사·입력 검토·잠금 조회·task 상태·히스토리와 시계/ID/secret/hash를 필요한 port로 주입한다. 기존 `createQueuedTask` 등 모델 함수는 기존 검증·시계·보호 범위를 그대로 사용한다.

## 보존한 처리 규칙

- 승인 시작은 현재 requestRevision·status와 새 검토 token을 확인한다. 예약/실행된 같은 명령은 원래 설정을 바꿀 수 없으며 task를 재생성하거나 중복 저장하지 않는다. 실행 중 lease 재사용은 원래 실행자만 가능하다. 입력 객체의 taskPath/claim 실행 설정을 준비하는 기존 동작을 유지한다.
- claim은 현재 FIFO 대상과 claimId를 확인한다. 같은 actor/claim은 기존 lease/runId를 읽고 다른 actor/claim에는 lease=null을 반환한다. 예약 뒤 입력이 바뀌면 실패 상태를 저장하고 실행 임대를 주지 않는다. claim된 예약의 provider/model/reasoning을 사용한다.
- task 명세·canvas/multiplayer/document bundle/format/HTML/workflow capability, 현재 편집 잠금과 파일 보호, 기존 출력 중복과 예약 충돌 검사를 유지한다. legacy 직접 실행이 예약을 우회하지 못하며 기존 active 작업과의 충돌 검사도 유지한다.
- 승인 요청은 executionRequest를 사본으로 동결하고 승인자·원래 revision·검토 token·실행 설정·결과/작업 경로를 기록한다. 작업 명세·히스토리·예약 또는 job/lease와 함께 기존 persist 경계로 저장하고 성공 뒤 응답한다. 실제 저장 후 알림과 queue/run 상태 최종화는 기존 adapter가 맡는다.

## 검증

`tests/server-ai-start.test.mjs`의 13개 회귀는 HTTP/CLI 없이 관리자·실행 설정/문서 revision, 승인 토큰·현재 요청, 같은 실행자 재전송·설정 변경 거절·동시 승인, 예약/FIFO claim·임대 격리·stale baseline, capability/편집 잠금/기존 결과·legacy 우회 거절, commit 대기/실패·현재 actor 재검증을 확인한다. 실제 reducer/task/scope 모델을 사용하며 승인 입력 검토와 저장 알림은 주입한 port다.

실제 SyncStore/SQLite trigger 중단으로 동결 승인·task 파일·히스토리·예약이 원자적으로 롤백되는지, 같은 명령 재시도 후 저장소를 다시 열어 같은 queuedTask를 반환하는지 확인한다. 물리 디스크/전원 장애 검증은 아니다.

실제 planApproval·persist/queue 상태 조립은 기존 전체 서버 회귀와 승인/예약 UI, 최종 패키지의 독립 관리자/팀원·내장 서버·mock CLI·재시작 검증으로 별도 확인한다. 최종 결과는 계획서 33절과 `out/r07-ai-start-*.log`에 기록한다.

## 후속 실행 수명과 남은 R07

실행 중 heartbeat·progress·취소·완료 결과 반영, 예약 개별 취소·만료와 승인 최종 상태 동기화는 계획서 34절 및 [서버 AI 실행 수명](server-ai-run.md) 단위로 구현·검증했다. R07 전체는 진행 중이며 다음 단위는 offline apply다. 히스토리/복원·프로젝트 수명·나머지 route/bootstrap도 남아 있다. R08~R10과 F01~F04는 이번 범위에 포함하지 않는다.
