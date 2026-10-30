# 프로젝트 홈 업무 경계

## 파일 구조와 탐색기 접근 · 2026-10-30

새 로컬·공유 프로젝트는 기본 문서 없이 생성한다. 기존 프로젝트는 명시적으로 파일 구조를 정리하기 전까지 v1을 유지한다. [ADR 0003](decisions/0003-project-file-layout.md)을 따른다.

홈의 ‘탐색기에서 표시’는 로컬·공유에 모두 제공한다. 공유 directory port가 대상 자격·서버 상태·미전송 변경을 확인하고 기존 mirror로 PC 사본을 준비한다. 활성 프로젝트는 전환하지 않는다. 홈 서비스는 준비 완료 후 OS 탐색기를 열고 offline 여부를 반환한다. UI는 오래된 사본을 열었을 때 안내한다. 권한 회수·휴지통·준비 실패·요청 중 세션 교체는 오류로 처리한다. 현재 내장 서버 주소를 재사용한다.

파일 구조 정리는 별도 ProjectLayoutService와 세션에 고정된 desktop port를 사용한다. status와 실행 API는 desktop capability이며, 실행은 상태 확인 당시의 session을 다시 검증한다. 기존 projects:reveal은 공유를 포함하도록 확장했다.

## v0.37.0 생성·모드 전환 변경

현재 생성 방식 선택과 실제 참여 종료/소유권 인계는 [프로젝트 모드 전환](project-mode-transitions.md)을 따른다. 아래 기존 생성·leave 동작 설명은 레거시 API 경로의 계약이며 새 사용자 전환 흐름과 구분한다. 새 폼은 경로 선택과 생성을 분리하고, 신규 전환은 목록 ID·분류를 유지한다. 전환 API는 기존 property/mutation 큐와 세션 검사를 사용한다.

`ProjectHomeService`가 목록 보강, 로컬/공동 이름 변경, 열기/홈 이동/생성, 홈 폴더 분류, 연결 주소 검사/적용, 휴지통 전후의 대기 순서를 소유한다. `desktop/ipc/projects.ts`는 기존 25개 `projects:*` 채널의 인자를 변환한다. 채널·preload API·반환 형식은 유지하며 기존 main의 mutation 큐·AI 작업 보호·외부 창/프레임 거부를 통과해 등록한다. 연결 정보의 sender 검사도 등록 경계에서 유지한다.

- `HomeProjectRegistry`는 공개 항목만 제공한다. desktop의 `homeProjectRegistry`가 `credentials`와 `localRoot`를 제외한다. 토큰·recovery key·암호화·`projects.enc`/`local-projects.json` 저장은 기존 ProjectLibrary에 남는다. 개인 로컬 목록·편집·폴더 분류에 암호화된 공동 세션이나 서버를 요구하지 않는다.
- `filesystemHomeProjects`는 로컬 이름/시각·경로 확인·mkdir와 이름 저장을 맡는다. `project.md`의 unknown frontmatter/본문, expectedName, 임시 파일 compare/replace, 기존 before/after 히스토리와 `.canvas/project.json`을 유지한다. 삭제된 project.md는 이름 변경으로 다시 만들지 않는다. 디스크 문서/metadata/registry/history를 하나의 새 원자 트랜잭션으로 바꿨다고 주장하지 않는다.
- `desktopSharedProjects`는 인증된 CollaborationClient와 캐시를 사용한다. 목록 기본 조회는 서버에 접속하지 않고 기존 offline/outgoing 표시와 역할·시각을 사용한다. 명시적 refresh만 lifecycle과 metadataOnly state를 읽는다. 서버에 접근할 수 없어도 목록·이전 이름·참여 세션은 유지한다. inactive lifecycle은 숨기거나 active로 덮어쓰지 않는다.
- 공동 이름 변경은 cache queue 완료 후 offline/outgoing을 검사하고, 기존 active client 또는 별도 인증 client를 refresh한 뒤 expectedName과 함께 전송한다. 성공 후에만 registry와 화면을 갱신한다. 큐·권한·프로토콜·서버 데이터 형식은 바꾸지 않는다.
- 추출 중 내장 서버의 이전 포트가 이름 변경/metadata 조회/다시 열기에 사용될 수 있는 경로를 발견했다. 내장 서버로 표시된 항목만 현재 desktop 서버 주소를 조립해 사용한다. 외부 서버 주소는 저장된 값을 그대로 사용한다. 실제 임시 PC 서버의 기본 transport와 패키지 프로세스 재시작 검사로 확인한다.
- 휴지통 처리 순서는 viewer 동기화 중단 → 진행 중 게시 완료 → 프로젝트 보존/정지 → 저장 큐 정지 → shared cache 완료 → 기존 ProjectTrash 실행이다. 실패도 finally에서 viewer 동기화를 재시작한다. token/이름/버전 확인, 7일 보관, 암호화, 원래 경로·파일·초안 복구/ack/purge는 기존 ProjectTrash와 서버가 계속 소유한다. 이번 단계에서 운영 데이터 삭제/이전이나 백업 형식을 추가하지 않는다.

서비스의 열기/정지 port는 기존 DesktopProjectSessions·DesktopLifecycle에 연결한다. main에 남은 `suspendProject`는 저장/잠금/워처/세션 수명 adapter 조립이며 collaboration 참여·복구 경로도 공유한다. 공동 프로젝트 생성·참여·복구·PC 서버 시작 IPC, 파일 mirror 조립, 잔여 편집 mutation wrapper는 이번 홈 IPC 추출의 완료 범위에 포함하지 않는다.

검증은 `tests/project-home.test.mjs`(업무 실패·충돌·형식/비밀 값 경계·기본 인증 HTTP)와 `tests/projects-packaged.mjs`(실제 Windows 홈 UI/IPC·임시 프로젝트 휴지통/복원·내장 서버·프로세스 재시작)를 연결한다. 패키지 검사는 UUID 프로필과 임시 프로젝트만 사용하며 연결 정보 적용 후 외부 주소에 접속하지 않는다. 실제 AI 계정이나 운영 서버 검증과 구분한다.
