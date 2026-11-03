# 공동 파일 사본과 로컬 편집 반영

## 게임 제작 원본 보관 · 2026-11-01

[게임 제작 계약](game-builds.md)의 `.game-builds/index.json`과 revision별 UTF-8 source·lock·notices·manifest를 기존 capture/materialize/apply/mirror/history에 포함한다. v2 실제 위치는 `.gamejam/project/builds`다. 명시적 구조 전환·raw stage/history의 기존 정책을 유지한다. node_modules·캐시를 프로젝트 데이터에 포함하지 않는다.

결과 이동은 현재 연결 index만 바꾸고 immutable 원본은 보존한다. 복사는 선택 결과의 모든 보존 revision과 추적 asset만 포함하고 artifact/build ID와 파일 연결을 새로 발급한다. 결과 삭제는 해당 원본 revision을 함께 제거하고 기존 히스토리에 보관한다. 원본이 포함된 기록은 HTML과 전체 기록으로 복원한다. 중단 복구는 capture에서 부분 파일을 읽은 뒤 before/after 외부 변경 검사와 원자 rollback을 재사용한다. 개인 캐시·인증·임시 파일은 복사하지 않는다.

원본 writer와 서버는 hash·목록·경로를 검사한다. capture 단독 호출을 완성 검증으로 간주하지 않는다. 공동 Undo는 기존처럼 서버를 먼저 변경하며 다음 mirror 준비에서 PC 파일을 맞춘다. 감시기는 두 layout의 build namespace를 감시한다. 검증은 `game-build-storage.test.mjs`, `game-build-server.test.mjs`, 실제 Windows `game-build-packaged.mjs`를 사용한다.

## 사용자 Markdown·HTML 개명 · 2026-11-01

[ADR 0005](decisions/0005-document-file-names.md)의 개인/공동 경로가 같은 이름 계획을 사용한다. 논리 `.canvas/file-names.json`은 ID와 현재/이전 경로·원래 HTML 진입 경로를 기록한다. v2에서는 기존 path 변환을 통해 `.gamejam/project/canvas/file-names.json`에 저장한다. MD 제목과 실제 basename, HTML 관리 문서의 표시 이름과 실제 entry filename을 함께 확정하며 결과 폴더·리소스·버전은 보존한다. v1의 고정 `project.md`는 기존 구조 정리 후 통일한다.

Filesystem repository는 같은 ID의 MD/HTML 이동 때 영향 파일의 원본/목표를 `.gamejam/local/document-names/pending.json`에 기록한다. 기존 `applyChanges`·외부 변경 검사·history를 재사용한다. 정상 반영 후 journal을 제거하며 오류·다음 열기에서 알려진 내용만 원복한다. 공유 사본도 mirror 재적용 전에 복구한다. 외부 변경이 있으면 복구 자료를 유지하고 열기를 실패 처리한다. session 전환은 이전 root에 복구 자료를 남기며 새 프로젝트에 쓰지 않는다.

HTML 미리보기의 개인 창 설정은 source ID 기반 키를 사용한다. 이름 변경은 같은 키를 유지하며, ID가 바뀌는 기존 분류 폴더 이동은 이전 경로 기반 설정과 ID 기반 설정을 같은 preflight/rollback 목록으로 이동한다. 결과 삭제도 두 키를 함께 휴지통으로 보낸다.

## 공유 사본 root · 2026-10-31

[ADR 0004](decisions/0004-project-names-and-shared-folders.md)의 sharedRoot는 mirror 전체 위치다. 새 사본은 이름 폴더, 기존 사본은 저장된 root 또는 기존 UUID 경로를 사용한다. FilesystemSharedWorkspaces와 desktop 조립만 root를 결정하며 다른 호출부는 이름/ID로 경로를 재구성하지 않는다. 이름 정리는 내용 필터 복사가 아닌 전체 디렉터리 rename이다. 추적되지 않은 파일·숨김 자료·서버 캐시·개인 상태·히스토리를 보존하고 journal이 남으면 일반 열기를 통해 옛 root를 재생성하지 않는다. docs 구조 전환과 root 이름 정리는 서로 다른 명시적 동작이다.

## 프로젝트 파일 구조 v2

[ADR 0003](decisions/0003-project-file-layout.md)의 v2는 사용자 문서를 docs 바로 아래에 두고 실제 내부 파일을 .gamejam/project와 .gamejam/local로 구분한다. snapshot 내부 식별 경로는 유지하며 projectPath의 filesystem 변환과 reader의 역변환을 사용한다. 새 직접 작성·AI 문서·가져오기·복제·프로젝트 간 복사·UI 설명에 같은 문서 경로 규칙을 적용한다. AI 문서 묶음은 속성으로 식별한다.

v1 프로젝트는 자동 전환하지 않는다. 명시적인 파일 구조 정리는 ProjectLayoutService가 기존 보존·세션·감시 경계에서 조정한다. 서버 전환은 관리자·revision·편집/AI 유휴 조건을 확인한다. 로컬 adapter는 durable journal과 해시로 원본을 보호하고 marker를 마지막에 확정한다. 재시작은 journal을 먼저 복구한다. 기존 문서 ID·링크·본문·히스토리를 보존하며 복원/Undo는 이전 경로표를 해석한다. 오래된 snapshot으로 v2 사본을 되돌리지 않는다.

전환 전 작성된 공동 히스토리를 되돌릴 때 편집 잠금도 현재 문서 경로로 검사한다. 기존 durable 문서 저장 요청은 enqueue와 전송 직전 경로표로 재연결하고 요청 ID·기준 revision·시도·본문을 보존한다. 과거 snapshot 복원은 현재 v2 marker를 유지한다.

새 프로젝트는 기본 project.md와 output/README.md를 자동 생성하지 않는다. 기존 작성 문서는 보존한다. 내부 자료와 .gamejam 전체는 삭제 가능한 캐시가 아니다. 자세한 실제 경로·지원 버전·복구 정책은 ADR을 따른다.

공동 프로젝트의 서버 snapshot과 PC의 작업용 파일 사본은 별개다. 서버 명령의 인증·revision·receipt·히스토리는 CollaborationClient/server가 계속 소유한다. PC 사본을 준비하는 데 실패했다고 서버 명령을 로컬 편집으로 우회하거나, 이미 성공한 서버 명령을 취소하지 않는다. 기존 SharedEditingService의 journal 인정 순서도 유지한다.

`SharedProjectMirror`는 시작 시 복사한 대상 snapshot에 대해 layout 준비 → 현재 파일 읽기 → 결과 폴더 이동 → 기존 원자적 파일 반영 → OS 휴지통 처리 → 빈 이전 상위 폴더 정리를 실행한다. `filesystemSharedProjectFiles`는 생성 시 받은 root만 사용하며 rollback에서도 현재 workspace를 다시 조회하지 않는다. main은 시작 session/ref·client·root와 native adapter를 연결한다.

- 결과 이동은 기존 `moveResultFiles`/`resultFileBaseline`을 재사용한다. HTML·추적된 자료·추적되지 않은 보조 파일과 개인 preview window 설정을 같은 결과 폴더와 함께 이동한다. 물리 이동부터 metadata 반영까지 감시를 일시 정지한다.
- metadata 반영 실패나 반영 전 session 변경은 이동한 폴더와 preview 설정을 **원래 root**로 복구한다. 기존 applyChanges의 외부 변경 검사/되돌리기와 파일 형식을 유지한다. metadata 반영이 성공한 뒤의 취소·휴지통 오류는 폴더만 역이동하지 않고 오류를 돌려준다.
- snapshot 전체 반영은 기존과 같이 추적 파일을 먼저 갱신/제거하고 남은 결과 폴더·개인 설정을 휴지통 처리한다. 서버 snapshot에서 제거한 추적 파일까지 모두 OS 휴지통에 남는다고 주장하지 않는다. 추적되지 않은 보조 파일의 OS 휴지통 반영은 그대로 유지한다. 직접 삭제 명령의 trash-only 경로는 기존 결과 폴더 전체 처리 방식을 사용한다.
- Undo/Redo는 공동 서버 히스토리를 변경한다. 다음 mirror 준비 시 그 최신 snapshot으로 PC 사본을 구성한다. 서버 Undo만으로 개인 파일이나 OS 휴지통 전체가 즉시 복원되는 새로운 정책은 추가하지 않았다.
- shared path reveal/open-folder의 파일 사본 준비도 기존 mutation 큐를 통과한다. 그 사이 프로젝트 전환과 저장·결과 이동이 끼어들지 않도록 하며 IPC channel/preload/sender 정책은 바꾸지 않는다.

`sessionProjectFileEffects`는 로컬 편집/Undo·history 복원과 공동 사본 준비가 사용하는 감시 중단/재개·OS trash port다. 종료 콜백은 한 번만 재개하며, 이전 session의 종료 콜백이 새 감시기를 지우거나 시작하지 않는다. `startSessionProjectWatcher`는 비동기 close 뒤에도 session을 다시 검사하고 시작 root만 감시한다. 늦은 이전 파일 이벤트도 새 프로젝트 화면에 알리지 않는다. chokidar의 ignore/안정화 설정은 유지한다.

`LocalMutationService`는 기존 desktop local handler 전후의 비교·workflow 초기값 반영·히스토리 인정·화면 갱신을 소유한다. 단일 Markdown 저장/배치/접기는 해당 파일만 capture해 변경 없는 HTML을 전체 기록하지 않는다. clipboard import와 manual command의 전용 히스토리를 중복 생성하지 않는다. AI 요청/작업 접기의 기존 Undo 제외 조건은 시작 session에 고정된 journal을 사용하는 기존 기록 adapter가 계속 처리한다. 전문 저장 서비스 자체의 원자성이나 모든 native 효과를 새로운 단일 트랜잭션으로 바꾸지 않는다.

`ensureProjectLayout`은 docs/output/assets와 이름 metadata를 준비하고 기본 문서를 만들지 않는다. 로컬 작업과 공동 mirror에 모두 캡처된 경로/세션으로 연결한다. 공동 캐시/outgoing·offline JSON 저장 큐와 프로젝트 참여/충돌 해결의 기존 책임은 유지한다.

검증: `tests/project-files.test.mjs`의 오류/세션 주입과 실제 임시 파일, `tests/local-mutation.test.mjs`의 partial capture/단일 인정/실패 경계, production session/AI 예약·통합 검사, `tests/project-mirror-packaged.mjs`의 실제 Windows 패키지 결과 이동/삭제/Undo/재구성/프로젝트 전환을 연결한다. 임시 root와 UUID 프로필만 사용하고 실제 AI 공급자·운영 서버는 사용하지 않는다.
