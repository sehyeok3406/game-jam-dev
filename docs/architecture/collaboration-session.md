# 공동 프로젝트 연결과 세션 보존

## v0.37.0 생성·모드 전환 변경

현재 생성 방식 선택과 실제 참여 종료/소유권 인계는 [프로젝트 모드 전환](project-mode-transitions.md)을 따른다. 아래 기존 생성·leave 동작 설명은 레거시 API 경로의 계약이며 새 사용자 전환 흐름과 구분한다. 새 폼은 경로 선택과 생성을 분리하고, 신규 전환은 목록 ID·분류를 유지한다. 전환 API는 기존 property/mutation 큐와 세션 검사를 사용한다.

`CollaborationService`는 공동 생성·참여·복구의 사전 조건/순서, 충돌 선택 전 백업, 초대 갱신 후 저장, 역할·잠금 API 연결을 담당한다. application의 `ConnectionOffer`는 activate/retain 함수만 제공하며 token/recovery key와 OS 암호화 수단을 노출하지 않는다. 기존 공개 CollaborationState의 관리자 초대/복구 표시 계약은 바꾸지 않는다.

`desktop/ipc/collaboration-session.ts`가 기존 11개 wire를 등록한다. 생성·참여·복구·탈퇴·충돌 해결·복원 재개·초대·역할 변경은 기존 property queue를 flush한 뒤 mutation 큐를 사용한다. 홈 이동/열기와 네트워크 연결 응답이 교차하지 않도록 한다. 읽기와 문서 lock/unlock은 독립 경로를 유지한다. 편집 flush가 unlock 응답을 기다리는 동안 같은 mutation 큐를 점유해 교착하지 않도록 하기 위함이다. 기존 client/server 입력 검증·권한·프로토콜 v1과 sender 경계는 그대로다.

`DesktopCollaborationSessions`는 DesktopProjectSessions·DesktopLifecycle과 인증된 CollaborationClient를 조립한다.

- 생성은 로컬 이름·snapshot을 시작 root/session에서 읽은 뒤 기존 create API를 사용한다. PC 내장 서버 key와 self-host key 선택은 main의 desktop 조립에서 제공한다. 개인 프로젝트 작업에 서버나 암호화를 요구하지 않는다.
- 참여/복구는 원격 요청이 성공하기 전에는 기존 프로젝트를 정지하지 않는다. 원격 응답 뒤 시작 session을 다시 검사하고, 기존 공동 프로젝트가 있으면 홈 보존 절차를 수행한 뒤 새 연결을 연다. 기존 localRootBeforeShare 의미를 유지한다.
- 이미 서버에서 성공한 생성/참여/복구를 session 변경이나 로컬 활성화 실패로 열지 못하면 받은 접속 정보를 기존 암호화 ProjectLibrary에 보관하고 원래 오류를 반환한다. 새 프로젝트로 강제 전환하거나 원격 membership/project를 자동 삭제하지 않는다. 캐시가 깨진 경우 그 바이트를 덮어쓰지 않으면서도 받은 자격 정보가 소실되지 않게 보완했다. 새 저장 형식은 추가하지 않았다.
- 연결 활성화는 초안/저장/캐시 보존 → 이전 watcher 종료 → 해당 프로젝트의 cache root 준비 → client 활성화 → 캐시 검증/seed → refresh → client 시작 → 암호화 세션/목록 저장 순서다. 일반 네트워크 오류는 기존처럼 재접속 가능한 읽기/오프라인 상태를 유지한다. 잘못된 캐시는 보호 오류를 반환한다.
- 상태·lobby 이벤트는 시작 client와 sessionId/epoch를 함께 확인한다. 이전 연결의 늦은 refresh/이벤트가 새 프로젝트 화면·root를 덮어쓰지 않는다. 캐시 저장은 UI session에서 분리해 원래 root의 미반영 작업을 계속 보존한다.
- 홈 이동은 membership/자격 정보를 보존하고 이 창의 잠금을 해제한 뒤 watcher/client를 종료한다. 탈퇴는 offline/outgoing 또는 AI 실행 중에 거부한다. 허용된 탈퇴만 서버 leave·목록 제거·이전 local root 복귀·암호화 세션 해제를 수행한다.

`CollaborationCacheQueue`는 기존 중복 방지 키와 직렬 저장/실패 후 재시도를 유지한다. 대기 전에 root·state·offline/outgoing을 캡처하고 inviteCode/recoveryKey/conflicts를 캐시 상태에서 제거한다. 기존 `writeClientCache`의 format 2/blobs, outgoing receipt와 offline transaction 의미는 바꾸지 않는다.

`CollaborationSessionStore`는 기존 `collaboration-session.enc`의 `{credentials,localRoot}`와 OS 암호화를 사용한다. 암호화를 사용할 수 없을 때 평문으로 우회 저장하지 않는다. 휴지통에서는 일치하는 프로젝트/root 참조만 지우고 다른 세션과 기존 추가 필드는 보존한다. 오프라인 충돌 해결 전에는 시작 cache root의 `.history/offline-resolution-{historyId}/draft.json`을 기존 JSON·권한 형식으로 기록한다. 백업 실패 또는 그 사이 세션 변경은 선택 실행을 막는다. 서버 히스토리·merge와 명시적 local/server 선택 규칙은 기존 client/server가 소유한다.

검증은 `tests/collaboration-session.test.mjs`의 오류·경합·비밀 값/저장 형식 검사와 실제 임시 PC 서버, production main의 session·AI 예약·전체 통합, `tests/collaboration-session-packaged.mjs`의 실제 Windows 패키지/내장 Node 서버·오프라인 충돌 UI와 백업에 연결한다. 임시 root와 UUID 프로필만 사용한다. 실제 AI 계정/Discord/운영 서버 검증과 구분한다.
