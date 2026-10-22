# R05 섹션 명령과 확인 창 수명

2026-10-21의 단계별 기능 단위다. 섹션 생성·단일 섹션 해제/파일 함께 삭제·드래그 후 멤버십 변경/취소를 WorkspaceScreen의 나머지 화면 명령에서 분리했다.

- `section-actions.ts`의 `sectionCreationInput`은 기존 선택 문서의 bounds, 최소 420×280, 여백, 접힌 문서의 저장 높이와 기본 제목을 유지한다. `CanvasSectionActions`는 기존 세 IPC의 실행·reload·확인/선택/알림 인정 순서를 맡는다. 저장 원자성·휴지통·히스토리/Undo·협업 검증은 기존 application/desktop/server 경계에 남긴다.
- `useSectionPrompts`는 생성 대상/제목, 삭제 대상/동반 삭제 여부, 멤버십 문서/출발/도착/drag geometry를 화면 방문에 연결한다. 생성 대상은 창을 열 때 복사한다. 일반 창 표시 hook의 `sectionDialogOpen` 상태는 이 경계로 옮겼다. UI debug의 생성 미리보기는 별도 샘플 대상으로 조립한다.
- `useSectionActions`는 root/saveScope/sessionId/epoch/canvas/home/viewEpoch를 포함한 기존 `SelectionScope`를 사용한다. 같은 화면의 동시 확정을 동기적으로 막고, 늦은 응답이 다른 화면의 busy를 해제하지 못하게 한다. 이미 backend에서 반영한 작업을 클라이언트가 취소했다고 주장하지 않는다.
- 실행 직전 현재 권한과 AI 보호를 확인한다. 생성은 선택 문서, 해제/삭제는 섹션 정의와 멤버, 멤버십 변경은 문서와 출발/도착 정의를 보호 대상으로 쓴다. 취소는 저장 명령 없이 reload하므로 권한을 잃어도 가능하다. 실행 중에는 확인/취소/제목 입력을 막는다.
- 멤버십에는 drag 시작 문서의 ID/path/revision과 저장 높이를 그대로 전달한다. 임의로 최신 revision을 가져와 충돌 검사를 우회하지 않는다. 기존 IPC에 새로운 사전 저장/새 batch/새 프로토콜을 넣지 않는다. 실패 시 원래 확인 창을 닫고 원래 화면을 reload하는 기존 동작을 유지한다. 성공한 명령 이후 reload가 실패해도 쓰기를 재시도하지 않는다.
- WorkspaceScreen의 인정 콜백은 현재 확인 대상과 시작 대상이 같을 때만 그 창과 선택을 정리한다. 생성된 섹션 선택은 기존 `useCreatedSelection`으로 실제 노드가 준비될 때 한 번 적용한다. 이전 80ms timeout을 제거했다.
- `SectionDialogs`는 원래 인접한 세 창의 DOM 위치·순서·문구·아이콘·CSS와 휴지통 안내를 유지한다. 화면 명령과 저장을 소유하지 않는다. 일반 modal focus/Tab은 셸에서 계속 처리한다.

단위 검사는 bounds·원래 revision/삭제 플래그·문서/멤버 보호 경로·빠른 두 번 확정·입력 사본·지연 응답/오류·화면/세션 교체·권한·읽기 전용 취소·reload 실패를 확인한다. 실제 React StrictMode 검사는 생성/멤버십/삭제 확인의 왕복 만료와 이전 setter/busy 응답 격리를 확인한다.

`section-ui-scenarios.mjs`를 실제 App fixture와 실제 Windows package가 공유한다. 키보드 선택과 실제 pointer drag를 사용해 생성/선택·해제/동반 삭제·취소/추가/이동/제외·한 번만 기록·Undo/Redo·캔버스 왕복 확인 만료를 확인한다. package는 실제 Markdown 본문/custom metadata와 membership의 완전 재시작 보존도 검사한다. 목적지 섹션 준비만 다른 fixture 문서를 멤버로 지정한 기존 API로 수행한다. native의 빈 섹션 생성 거절 정책을 유지한다. 파일 제거/복원 관측과 IPC·히스토리 완료를 구분해 실제 확인 창과 busy 종료를 기다린다. fixture의 HTML 창이 드래그 시작점을 덮지 않게 목적지를 배치하며 제품의 레이어 정책은 바꾸지 않는다.

섹션 이름 변경, pointer 배치 계산/저장, 최소화, clipboard paste 큐, AI/히스토리/inspector 등의 나머지 화면 명령과 조립은 R05 후속 범위다. 이번 단위로 R05 전체 완료를 선언하지 않는다. 실제 AI 계정·운영 서버·사용자 데이터·외부 서비스는 검사에 사용하지 않는다.
