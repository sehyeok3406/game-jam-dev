# 편집 명령 연결과 검증 범위

## 로컬 편집의 복구 초안 · 2026-11-22

Markdown 편집기, 진행 중인 펜·도형, 캔버스 텍스트는 첫 미저장 변경에서 30초를 센다. 편집기는 메모리에 최신 입력을 유지하고 주기가 되면 아직 확정되지 않은 최신 상태를 기존 `EditorDraftStore`에 보낸다. 이후 변경이 생긴 구간에만 확인하며 마지막 보관본과 같은 내용은 다시 쓰지 않는다. 쓰기 도중 들어온 입력은 다음 확인에 포함한다.

확정에 실패한 작업과 명시적인 복구 보관에는 즉시 쓰기 경로를 사용한다. 그림이 확정되거나 활성 제스처를 취소하면 이미 기록된 명령만 초안에서 제거한다. 사용자가 초안을 버리면 저장소에서 해당 초안을 제거한 뒤 복구 표시를 닫는다. 세션 전환에서 이전 타이머를 취소한다. 저장소는 초안별 직렬 쓰기와 원자적 파일 교체를 유지하며, 교체에 실패하면 앞서 성공한 초안을 읽을 수 있다.

완료된 작업의 초안은 Markdown의 기존 문서 저장 큐와 그림의 기존 초안 저장소에 30초 주기로 보관한다. 작성 중인 이름과 진행 중인 제스처에는 편집기 초안을 사용한다. 강제 종료 시 마지막 초안 또는 원본 저장 이후의 입력은 유실될 수 있다.

## 로컬 원본 일괄 저장

로컬 프로젝트 세션은 Markdown과 그림 편집이 멈춘 뒤 2분에 최신 변경을 모아 기존 원자 쓰기와 히스토리 경로로 확정한다. `Ctrl+S`, 프로젝트 전환, 정상 종료, AI 시작 및 원본을 필요로 하는 구조 명령은 즉시 저장을 요청한다. 캔버스 탭을 바꾸거나 문서 편집기에서 나갈 때는 변경을 메모리에 남기는 작업까지 처리한다. 이름 확정은 파일명과 참조를 갱신하는 구조 명령이므로 기존 명시적 저장을 사용한다. [ADR 0014](decisions/0014-local-edit-autosave.md)

원본 교체 전 최신 초안과 히스토리 전후 파일을 남긴다. 작업이 중단되면 `.gamejam/local/edit-batch.json`으로 해당 히스토리를 찾는다. 재열기에서 모든 원본이 반영됐으면 버전을 확정하고, 일부만 반영됐으면 앱이 작성한 바이트가 남아 있는 파일만 복원한다. 외부에서 바뀐 바이트와 대기 초안은 그대로 보존한다.

## 문단 위치 링크 · 2026-11-03

[ADR 0007](decisions/0007-shared-location-links.md)의 `locationAnchor`는 문단 링크를 처음 만들 때 기존 본문 저장/그림 편집으로 추가한다. Markdown 주석과 캔버스 텍스트 JSON으로 왕복 저장하며 별도 저장 큐나 히스토리를 만들지 않는다. 같은 문서 내 복제에서는 원본 ID를 보존하고 사본의 ID를 새로 발급한다. 외부 편집으로 앵커가 사라졌거나 중복되면 유사 문장을 추측하지 않는다. 기존 앵커 추가·삭제·복원은 문서/그림의 Undo와 저장 실패·복구 경계를 그대로 따른다.

## 로컬 Undo/Redo의 최근 기록

`UserEditRecorder`는 디스크 기록이 성공한 뒤 시작 프로젝트 세션의 filesystem repository에 바뀐 파일의 전후 내용만 캐시한다. 최대 20개와 전후 문자열·경로 기준 8 MiB 한도를 적용하고 가장 오래된 항목부터 비운다. 한도를 넘는 단일 변경, 오래된 변경, 프로젝트를 다시 열기 전의 변경은 기록 ID에 해당하는 메타데이터와 파일을 직접 읽는다. Undo/Redo는 최신 작업부터 적용하며 기존 최대 100개 작업 스택과 디스크의 버전 기록을 사용한다.

배치 대상인 그림의 Undo/Redo는 최근 20개 메모리 작업 항목에 바뀐 객체만 보관하고 다음 저장 내용을 함께 갱신한다. 저장 전후 모두 한 획이나 지우기 한 번을 한 작업으로 적용한다. 기존 디스크 작업의 Undo/Redo는 실제 파일 반영과 기록 저장이 끝난 뒤 스택을 갱신한다. 히스토리 화면의 파일 조회와 버전 복원은 해당 ID의 메타데이터를 읽는다.

## Markdown·HTML 이름 확정과 일괄 통일 (2026-11-01)

`renameDocument`/`documents:rename`, `renamePreview`/`preview:rename`, `inspectFileNames`, `unifyFileNames`/`files:unify-names`는 공통 이름 규칙과 application planner를 사용한다. 개인 프로젝트는 기존 Electron mutation/session/history와 `DocumentNameService`, 공동 프로젝트는 기존 SharedEditingService → client → 서버 reducer/명령 큐를 사용한다. ID·원래 내용/해시·영향 파일·세션을 확인하며 일괄 적용은 미리보기 snapshot 해시도 검사한다. 이름 입력 중에는 본문만 기존 큐로 저장하고 명시적 확정에서 파일명·표시 이름·참조를 함께 바꾼다.

공동 개명은 `documentNamesVersion:1`을 지원하는 서버에서 온라인·동기화 유휴·AI 실행/예약 없음·영향 잠금/권한 검증 후 확정한다. 과거 이름의 미전송 본문은 ID와 로컬 base를 검증해 최신 경로·이름·파싱된 링크로 재연결한다. filename 이력을 포함하는 명시적 개명과 일반 본문/HTML 과거 기록을 구분해 Undo/복원한다. 파일 adapter는 다중 변경 journal을 사용하며 외부 변경은 보존한다. 상세 정책은 [ADR 0005](decisions/0005-document-file-names.md)를 따른다.

## 캔버스 외부 입력과 빈 텍스트 정리 (2026-10-29)

외부 파일 드롭은 기존 `files:import`를 사용한다. 일반 파일은 이름·`Uint8Array` DTO로 읽고, 미디어와 큰 로컬 HTML은 preload가 브라우저 `File`의 디스크 경로를 전달한다. 드롭 입력에는 시작 saveScope/clipboardContextId를 전달하고 IPC 진입과 mutation 큐 안에서 다시 검증한다. desktop의 `readImportSources`가 선택창·드롭·클립보드 파일의 확장자/크기/UTF-8/이미지 검사를 함께 수행하고 `FileImportService`가 기존 `files:import-batch`로 게시한다. 폴더·미지원 파일·검증 실패가 포함되면 배치 전체를 반영하지 않는다. 로컬 HTML은 파일당 크기 검사와 12MB 합산에서 제외한다. 공동 HTML은 8MB이며 파일 수 20개·MD 2MB·이미지 5MB 제한과 단일 HTML 가져오기 정책은 계속 적용한다.

클립보드는 내부 복사 토큰 → 로컬 파일 URI 목록 → 이미지 → 일반 텍스트 순서로 해석한다. Windows 탐색기 FileDrop은 Electron이 제공하는 `text/uri-list`로 읽고 원본을 바꾸지 않는다. 파일/이미지는 기존 클립보드 요청 중복 방지·세션 검사·저장 후 히스토리 인정/실패 복구 경로를 함께 사용한다. 텍스트는 HTML/Markdown으로 실행·해석하지 않고 텍스트 문서 스키마로 변환한 뒤 기존 그림 생성 명령/저장 큐로 새 텍스트 상자를 만든다. 입력란 안의 붙여넣기는 기존 입력 소유권을 유지한다.

빈 내용 자동 삭제는 캔버스 텍스트 상자의 실제 편집 종료(외부 클릭·선택 해제·완료·Escape)에만 적용한다. 공백·줄바꿈·빈 목록도 빈 내용이며 IME 조합·서식 도구 이동·일반 메모/문서·단순 화면 로딩은 삭제 계기가 아니다. 보관 초안 로딩과 저장 성공 후 기존 명령/Undo·Redo를 사용한다. 삭제 target의 선택적 `expectedGeometry`를 reducer에서 비교하여 다른 사용자의 후속 내용 변경을 삭제하지 않는다. UI는 기존 `canvas:batch` 안에 조건부 geometry patch와 삭제를 묶어 이전 텍스트 지원 서버에서도 조건을 원자적으로 검사한다. 배치 전체가 지원되지 않으면 오류를 반환하며 개별 삭제로 우회하지 않는다.

검증은 `canvas-text.test.mjs`, `clipboard-images.test.mjs`, production mock IPC의 `test:clipboard`, 실제 입력 UI의 `test:text:ui`, Windows OS clipboard와 실제 패키지의 `test:clipboard:packaged`로 나누어 수행한다. 검사 명령의 존재만으로 실행 통과를 의미하지 않는다.

## 기존 명령 경로

공개 reducer 계약은 `contracts/commands.ts`의 26개 명령이다. 새 공동 편집 경로는 기존 등록된 IPC → `desktop/ipc/collaboration` → session별 `SharedEditingService` → 인증된 `CollaborationClient.command` → 기존 서버/reducer 순서다. 서버 권한·revision·잠금·receipt 및 오프라인 영속 저장의 소유권은 바꾸지 않았다.

`SharedWorkspaceReader`가 상세/목록 DTO, 개인별 접기 상태와 증분 canvas projection을 소유한다. `SharedEditingService`가 명령 전후 session 검사, mirror/trash 연결, 성공한 history receipt의 Undo 기록과 결과 DTO 변환을 소유한다. 서비스 port에는 root 경로나 인증 token을 전달하지 않는다.

아래 표의 섹션 배치와 삭제는 평면 섹션 기준이다. 중첩 섹션은 LocalCommandService에서 이동·확장·삭제 대상을 계산하고 filesystem publisher를 통해 적용한다. [로컬 중첩 섹션](section-actions.md#로컬-중첩-섹션)

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
