# R05 선택 항목 명령과 삭제 확인 경계

2026-10-21의 기능 단위다. `WorkspaceScreen`에 섞여 있던 선택 복제·삭제·배치 계산/실행과 단일·혼합 삭제 확인을 추출했다. 전체 화면 명령이나 모든 확인 창을 분리한 단계는 아니다.

- `selection-plan.ts`: 섹션 멤버의 중복 배치 제외, 접힌 문서의 표시 높이와 저장 높이 구분, 8개 정렬/간격 계산, clipboard 선택 사본, 그림 복사 ID/시각/offset. 기존 로컬 복사 파일명과 native/shared ID 정책은 backend 서비스에 남긴다.
- `CanvasSelectionActions`: 저장 flush → 최신 revision 조회 → 기존 native 명령 또는 혼합 단일 batch → reload → 선택/확인 창/알림 인정 순서를 맡는다. 동일 화면의 실행 중 중복 확인을 동기적으로 막는다. 파일 저장/삭제 원자성과 히스토리·Undo는 기존 IPC/application/publisher가 담당한다.
- `useSelectionActions`/`useSelectionScope`: 시작 root/saveScope/sessionId/epoch/canvas/home과 화면 방문 순번을 고정한다. 대기마다 확인하며, 권한/AI 보호는 발행 직전 다시 검사한다. 캔버스를 왕복하거나 같은 root를 다시 열어도 이전 대기 작업이 살아나지 않는다. 늦은 응답은 새 화면의 선택·오류·알림·busy를 변경하지 않는다. 이미 서버에서 반영한 명령을 클라이언트가 취소/rollback했다고 주장하지 않는다.
- `useSelectionDeletePrompts`: 확인 창과 대상 목록을 시작 화면에 연결한다. 프로젝트/캔버스 전환 시 이전 확인은 표시하지 않고, 이전 setter/완료 콜백은 새 확인 창을 닫지 않는다. StrictMode 수명과 unmount도 검사한다.
- `useCreatedSelection`: 복제 응답 뒤 문서/그림의 React Flow 노드가 모두 생길 때 선택을 한 번 적용한다. 고정 시간 지연에 의존하지 않으며 시작 화면이 바뀌면 대기 선택을 폐기한다. native reload보다 노드 생성이 늦어 선택이 사라지던 실제 package 문제를 보완한다.
- `SelectionDeleteDialogs`: 기존 단일/혼합 삭제 markup·문구·이미지 원본 보존 안내·HTML 전용 폴더 안내·busy/lock/취소 동작을 유지한다. 명령 실행은 props로 연결한다. 디자인/CSS 변경은 없다.

기존 명령은 최신 revision을 쓰되 처음 선택한 ID/path를 유지한다. 혼합 삭제는 문서/HTML → 섹션 → 그림의 기존 한 batch 순서이고, 문서만 선택하면 native `deleteDocuments` 경로다. 혼합 복제도 기존 batch를 사용하며 문서만 복제할 때의 native ID/파일명과 그림만 복제할 때의 optimistic drawing 경로를 유지한다. 복제는 입력을 읽어 새 파일을 만드는 작업이므로 기존처럼 입력 파일의 AI 쓰기 잠금을 새 금지 정책으로 추가하지 않는다. 쓰기 권한·세션과 결과 발행의 backend 검증은 유지한다.

키보드 복제의 기존 이동량은 문서/혼합 56px, 그림만 선택하면 32px다. 후자의 기존 기본값도 별도로 검사한다. Undo/Redo는 기존 history 명령 뒤 그림 목록을 직접 다시 읽고 프로젝트 reload를 마친 뒤 완료한다. 변경 알림이 늦어 이전 generation으로 혼합 삭제를 요청하던 실제 package 문제를 수정했으며, backend generation 충돌 검사는 그대로 유지한다.

복제/단일·혼합 삭제는 편집기 flush 함수 목록을 await 전에 캡처한다. game UI와 drawing을 순서대로 저장한 뒤 캡처한 각 문서의 flush를 병렬로 수행한다. 배치 정렬도 pending 편집을 저장한 뒤 변경하며, 화면 대상·캔버스와 그림 generation은 시작 선택 사본으로 고정한다. 오류 시 단일 삭제 확인은 기존처럼 닫고, 혼합 삭제 확인은 다시 시도할 수 있게 남긴다. 새 화면이나 새 확인 창에 실패/성공 응답을 적용하지 않는다.

검증은 `selection-actions.test.mjs`의 계산/순서/부작용 없는 stale 거부/실패/중복/권한 검사와 `selection-hooks.test.mjs`의 실제 React StrictMode·확인 만료/busy 격리·늦은 노드 선택으로 연결한다. `selection-ui-scenarios.mjs`의 동일 실제 UI 동작을 fixture와 Windows package에서 실행한다. 문서+그림 혼합 복제/정렬/삭제·한 번 기록·Undo/Redo·캔버스 왕복 확인 만료·단일 HTML 삭제/Undo·원문·재시작을 확인한다. fixture는 workspace 변경 알림을 지연해 Undo/Redo의 직접 갱신을 확인한다. 기존 clipboard package 검사로 copy 사본 추출과 native clipboard 연결도 보완한다.

clipboard paste의 큐/중복 요청/asset 가져오기, 실제 pointer 배치 저장, 섹션 생성·단일 섹션 해제/삭제와 멤버십 변경, AI/히스토리 화면 조립은 기존 경로를 유지하며 후속 R05 단위에서 점검한다. 이번 작업만으로 R05 전체 완료를 선언하지 않는다. 실사용 프로젝트/운영 서버나 실제 AI 계정/Discord/Render/S3는 검사에 사용하지 않는다.
