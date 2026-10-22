# R04 편집 서비스·IPC 완료 조건 점검

2026-10-21의 마지막 단위는 26개 명령 대응과 specialized local 경로의 누락 점검이다. 실행 결과는 실행 계획서 22절에 확정한다. R05 화면 조립이나 R07~R10 서버·저장소·복원·배포 준비를 완료했다는 뜻이 아니다.

| 계획 조건                                          | 구현과 검증 근거                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 문서 저장을 UI → IPC → application → 저장소로 연결 | DocumentEditingService, one-document filesystem repository, 기존 DocumentSaveQueue/초안/IME UI. document-service, document-save-queue, production 프로젝트 세션, integration의 실제 자동 저장/충돌 초안 검사                                            |
| 공통 계산과 native 차이를 조사·추출                | core/editing, LocalCommandService, CommandEnvironment와 SharedEditingService. shared-editing의 26개 대표 성공/거절·commit 실패 60개. native copy ID, timestamp task 파일명, section 최소 크기/rename 멤버 찾기, 로컬 game UI quota를 별도 서비스에 보존 |
| 명령을 기능별로 이행                               | documents/creation/section/canvas/import/preview/settings/history 서비스, filesystem command/history publisher. 상세 26개 대응은 editing-commands.md. 프로젝트 홈·연결·사본도 각 업무 서비스와 desktop adapter로 분리                                   |
| 최적화 보존                                        | LocalMutationService의 단일 Markdown partial capture, 기존 PropertyQueue의 병합/flush, SharedWorkspaceReader의 delta·변경 없는 HTML 제외. document-service/local-mutation/shared-editing과 integration 검사                                             |
| IPC 역할 제한                                      | desktop/ipc는 인자 전달·서비스 호출·직렬화 연결을 맡고 main은 sender/session/오류/기존 queue와 서비스 조립을 연결한다. CLI·구독 판정을 편집 handler에 추가하지 않았다. native shell/clipboard·PNG dialog는 desktop 경계에 둔다                          |
| 특수 sender와 비밀 값 보존                         | multiplayer/window-manager의 별도 preload/창 ID·mainFrame 검사, features/self-host/register의 전용 sender와 secret 처리, desktop/ipc/discord-approval의 sender·암호화 store. main에서는 기존 등록 모듈을 조립. PC 협업 기능 유지                        |
| 삭제·가져오기·결과 이동/Undo 유지                  | filesystem publishers와 SharedProjectMirror의 기존 원자적 apply·외부 수정 검사·이동 rollback·native trash 정책 보존. project-files/import/shared-editing, production integration, 실제 clipboard/game UI/mirror/R04 package 검사                        |

마지막 점검에서 경로 일치가 ID 불일치를 무시하던 섹션 삭제/문서 복제 조건을 수정했다. 레이아웃의 선택 objectId도 확인하고, 섹션 경로·유한 좌표·삭제 boolean은 부작용 전에 검증한다. ID가 없는 기존 파일은 읽기 DTO의 경로 ID를 그대로 사용한다. 섹션 배치/멤버십 정리는 기존 사용자 본문·추가 frontmatter·status를 보존한다. 파일/프로토콜 형식 이관은 없다.

UserEditRecorder는 기존 completed user history를 저장한 뒤 시작 프로젝트의 journal에 기록한다. AI 작업 요청과 task-only 접기는 history는 남기되 Undo에 넣지 않는 기존 정책이다. rename/delete-many/color/layout 네 manual command는 외부 wrapper와 중복 기록하지 않는다. 파일 반영 뒤 history 저장이 실패할 때 이미 반영한 파일까지 자동 rollback하는 새 트랜잭션을 도입하지 않았다.

개인 섹션의 여러 멤버 OS 휴지통 처리는 기존 순차 정책을 유지한다. 멤버 배치에서 일부 파일 이동이 실패하면 오류를 기록하고 나머지를 처리하던 기존 정책도 유지한다. 이 경로를 새 전역 원자적 작업으로 바꿨다고 주장하지 않는다. 공통 reducer batch/delete-many와 파일 import/result publisher의 원자적 작업은 해당 검사로 별도 증명한다.

검증의 경계: 공통 계산 26개 매트릭스가 specialized native 경로 전체를 대신하지 않으며, 모든 명령/하위 action을 실제 패키지에서 개별 실행한 것도 아니다. 주요 native 삭제·복원·결과/asset 이동·clipboard·manual history·초안·재시작은 기존 및 신규 패키지 검사로 보완한다. 실제 AI 계정/Discord/Render/S3와 다른 OS·외부망 검증은 이번 결과에 포함하지 않는다.
