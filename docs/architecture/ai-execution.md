# 개인 AI 실행의 경계

개인 앱은 로그인/구독/서버 연결 없이 기존처럼 로컬 CLI를 실행한다. 협업 서버는 요청·승인·예약·lease·결과 저장을 담당하며 사용자의 CLI 인증이나 프로세스를 대신 소유하지 않는다.

| 책임                             | 구현                            | 주입하거나 보유하는 자원                            |
| -------------------------------- | ------------------------------- | --------------------------------------------------- |
| 공급자/모델/추론 수준 목록       | core/ai/catalog                 | 공통 계약만 참조                                    |
| CLI 인자·설정·출력 파서·탐색     | adapters/node/ai                | 기존 제한 인자와 읽기 전용 probe                    |
| 실행·취소·UTF-8 스트림           | desktop/ai/node-executor        | 실행별 child process와 AbortSignal                  |
| 격리 작업 공간                   | desktop/ai/stage-workspace      | 시작 프로젝트의 history/workspace/input             |
| 단계 입력·산출물 검증·반영       | application/ai/run-service      | stage, 프로젝트 저장소, HTML 검사, clock            |
| durable 예약·중복/충돌·전환      | application/ai/queue-service    | 큐 저장소, 프로젝트 capture, ID/clock               |
| 공동 claim                       | claimSharedAiRun                | 기존 서버 클라이언트의 claim/begin adapter          |
| 앱/Discord 승인 실행 gate        | application/ai/approval-service | 권한 검사, flush, serial, reserve/execute           |
| 실행 상태·단계 전환·종료         | application/ai/run-coordinator  | 시작 session·lease에 고정된 실행, 단일 완료 Promise |
| 이벤트 identity·bounded timeline | application/ai/run-events       | 시작 actor/provider/session, 200개 로그와 상태 전환 |
| JSON/로그 framing                | adapters/node/ai/run-output     | 공급자별 parser, 단계별 buffer와 결과               |
| task·히스토리·진단 기록          | desktop/ai/run-records          | 시작 root/run/task, 기존 JSON·SHA-256 형식          |
| desktop 연결 수명                | desktop/bootstrap               | updates, web viewer/sync, self-host                 |

로컬 결과는 stage 검증 → 원본 입력 충돌 검사 → validating 히스토리 → 기존 원자 파일 반영 → completed 히스토리 순서다. 마지막 히스토리 기록이 실패하면 해당 반영에서 변경한 파일 전체를 이전 상태로 복구한다. 공동 결과는 기존 서버 lease를 통해서만 반영한다. lease가 사라지면 로컬 반영으로 대체하지 않는다.

2단계 gamejam은 문서 정리 결과를 검증한 후 같은 run/lease로 HTML 단계에 전달한다. 두 단계의 결과는 마지막 검증까지 원본 프로젝트에 반영하지 않는다. 기존 단일 실행 제한, 사용자 편집 지시, 출력 경로, 입력 보호, 새 버전/ID 규칙과 codex:\* IPC·JSON 형식을 유지한다.

실행 coordinator가 상태 전이·단계 실행·최종 기록과 한 번의 자원 해제를 소유한다. 로그 callback에는 실행 단계 식별자를 붙여 이전 단계/완료 후 callback을 버린다. 실행 중 session이 바뀌면 결과 반영을 막고, 진단/실패/중지 기록은 시작 root에 남긴다. lease는 반영 직전에도 비교하며 새 lease의 작업을 대신 종료하지 않는다. 진단·히스토리·task 기록 실패는 각각 보고하면서 실행 슬롯 해제를 시도한다.

main은 CLI 연결 확인과 준비 작업, root/session/client를 캡처하는 adapter 조립 및 UI IPC를 맡는다. 실제 공급자 인증, 과금 호출과 운영 서버 배포는 이 구조 검증에 포함하지 않는다.
