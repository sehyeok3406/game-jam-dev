# 편집 명령 연결과 검증 범위

공개 reducer 계약은 `contracts/commands.ts`의 26개 명령이다. 새 공동 편집 경로는 기존 등록된 IPC → `desktop/ipc/collaboration` → session별 `SharedEditingService` → 인증된 `CollaborationClient.command` → 기존 서버/reducer 순서다. 서버 권한·revision·잠금·receipt 및 오프라인 영속 저장의 소유권은 바꾸지 않았다.

`SharedWorkspaceReader`가 상세/목록 DTO, 개인별 접기 상태와 증분 canvas projection을 소유한다. `SharedEditingService`가 명령 전후 session 검사, mirror/trash 연결, 성공한 history receipt의 Undo 기록과 결과 DTO 변환을 소유한다. 서비스 port에는 root 경로나 인증 token을 전달하지 않는다.

| 명령                        | 기존 개인 로컬 경로                                          | 대표 검증/보존 차이                                                               |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `kanban:move-card`          | LocalCanvasService → LocalCommandService                     | expectedView/상태 변경                                                            |
| `kanban:save-view`          | LocalCanvasService → LocalCommandService                     | expected 설정 충돌                                                                |
| `files:set-status-property` | LocalCanvasService → LocalCommandService                     | expectedEnabled 충돌                                                              |
| `documents:set-workflow`    | LocalCanvasService → LocalCommandService                     | expectedStatus 충돌                                                               |
| `document-statuses:save`    | LocalCanvasService → LocalCommandService                     | expected 설정 충돌                                                                |
| `drawings:apply`            | LocalCanvasService.applyDrawing                              | 중복 그림 ID; IPC는 최신 그림 목록 반환                                           |
| `game-ui:apply`             | LocalCanvasService.applyGameUi                               | 프레임 입력 검증; 개인 프로젝트에 서버 전체 quota를 추가하지 않음                 |
| `canvas:batch`              | LocalCommandService + filesystem publisher                   | 두 번째 자식 오류 시 전체 무반영                                                  |
| `canvases:change`           | LocalCanvasService → LocalCommandService                     | expected 목록 충돌                                                                |
| `results:move`              | LocalCommandService + filesystem publisher                   | 없는 원본; native 폴더/보조 파일 이동과 rollback은 별도 검사                      |
| `results:organize`          | LocalCommandService + filesystem publisher                   | 깨진 catalog; 기존 복구 자료 유지                                                 |
| `documents:set-color`       | LocalCommandService + filesystem publisher                   | 지원하지 않는 색상                                                                |
| `files:import-batch`        | FileImportService; native files:import/clipboard의 내부 명령 | 경로 탈출; 기본 import-UUID 파일명 유지                                           |
| `documents:delete-many`     | LocalCommandService + filesystem publisher                   | 뒤쪽 대상 오류 시 앞쪽 대상 보존                                                  |
| `documents:create-idea`     | LocalCreationService → LocalCommandService                   | 잘못된 크기                                                                       |
| `documents:save`            | DocumentEditingService + one-document repository             | 경로 탈출; 원본 ID/본문 충돌은 document-service 검사                              |
| `documents:delete`          | LocalCommandService + filesystem publisher                   | 다른 문서 ID                                                                      |
| `documents:duplicate`       | LocalCreationService                                         | 없는 원본/교체된 ID 거절; 개인 복사 ID는 기존 source-id-copy-suffix 형식 유지     |
| `sections:create`           | LocalCreationService → LocalCommandService                   | 중복 멤버                                                                         |
| `sections:rename`           | LocalCommandService + filesystem publisher                   | 빈 이름                                                                           |
| `sections:delete`           | LocalSectionService                                          | 다른 섹션 ID; 여러 멤버 휴지통 처리는 기존 순차 정책                              |
| `sections:move-document`    | LocalCommandService + filesystem publisher                   | 없는 대상 섹션                                                                    |
| `documents:update-layout`   | DocumentEditingService + one-document repository             | 잘못된 좌표/교체된 ID; partial capture 유지                                       |
| `sections:update-layout`    | LocalSectionService                                          | 잘못된 좌표/교체된 ID; 외부 rename 멤버는 ID 재탐색, 섹션 본문/추가 metadata 보존 |
| `layouts:update`            | LocalCommandService + filesystem publisher                   | 뒤쪽 배치 종류 오류; IPC 배열을 {updates}로 변환                                  |
| `tasks:create`              | LocalCreationService                                         | 없는 입력; 개인 timestamp 파일명 유지, 공유 Undo 기록 제외                        |

공통 계산/공동 IPC 매트릭스는 `tests/shared-editing.test.mjs`와 `shared-editing-fixtures.mjs`에 있다. 26개 명령의 대표 성공/거절, 전체 명령의 commit 실패와 무인정, 권한/지연 session 거부, 개인 접기 격리, 변경 없는 HTML 미전송, Undo 실패 보존, 목록/상세 revision 계약을 검사한다. 시각과 생성 ID는 선택한 경로의 CommandEnvironment로 고정한다. 상태·칸반·HTML 관리 문서·가져오기 helper에 빠져 있던 clock/id 전달을 연결했고 기본값은 기존 Date.now/UUID다.

이 매트릭스의 로컬 쪽은 **LocalCommandService의 공통 계산과 부분 반영**을 검증한다. 위 표의 specialized native 서비스 전체를 이 매트릭스로 대신 검증했다고 주장하지 않는다. 특히 개인 복사 ID/작업 파일명, metadata-only 쓰기, 게임 UI 로컬 quota 차이, native 휴지통/보조 파일 이동은 기존 전용 단위 검사와 production IPC·package 검사로 보완한다. files:import-batch는 native 파일 선택/클립보드의 내부 명령이며 새 IPC 채널을 등록하지 않았다.

공동 documents:save는 reducer의 void를 fresh CanvasDocument로 바꾸고, content/workflow/structure revision과 assetVersion·개인 접기를 붙인다. documents:list의 기존 DTO에는 workflowRevision을 새로 추가하지 않는다. 그림 명령의 reducer void도 기존 IPC처럼 최신 목록으로 바꾼다. 이 차이를 계약에서 보존한다.

프로젝트 홈/휴지통은 `ProjectHomeService`, 공동 연결은 `CollaborationService`/`DesktopCollaborationSessions`, 사본/결과 파일은 `SharedProjectMirror`와 filesystem adapter로 이행했다. `LocalMutationService`가 기존 partial capture·workflow 초기화·한 번만 기록할 범위를 소유하고, `UserEditRecorder`가 기존 history 형식과 AI 작업 요청/작업 문서 접기의 Undo 제외를 소유한다. 네 개 manual command는 `RecordedCommandPublisher`가 성공한 파일 반영 뒤 한 번만 기록한다. 기록 실패를 성공한 Undo나 변경 알림으로 인정하지 않는다. native 파일 읽기/열기는 시작 root/session에 고정된 `DesktopProjectPaths`와 `desktop/ipc/project-files.ts`에 있다.

추가 specialized 검사는 `tests/{document-service,creation-service,section-service,user-edit-recorder,project-paths}.test.mjs`에 있다. 실제 패키지의 ID 거절·사용자 섹션 본문/metadata 보존·native 휴지통·히스토리/Undo/Redo·완전 재시작은 `tests/r04-editing-packaged.mjs`로 확인한다. 도형/게임 UI/캔버스의 모든 하위 액션이나 모든 명령을 실제 서버/PC 패키지로 개별 증명했다고 주장하지 않는다. R04 완료 조건과 검증 범위는 [r04-completion.md](r04-completion.md)를 참조한다.
