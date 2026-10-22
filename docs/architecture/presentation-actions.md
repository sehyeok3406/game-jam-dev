# R05 이름 변경과 최소화 명령 경계

2026-10-21의 기능 단위다. WorkspaceScreen에서 섹션 이름 변경과 문서·섹션·선택 항목의 최소화/펼치기 명령을 분리했다. 표시 상태의 저장 정책을 통일하지 않는다.

- `CanvasSectionActions.rename`은 기존 `renameSection(path, title, revision)`을 실행한다. 원래 revision과 제목을 그대로 넘기며 backend의 제목 정규화·경로/ID 보존·충돌·히스토리를 유지한다. 실패 시 확인 창을 남기고, 성공한 명령의 reload 실패를 쓰기 재시도로 처리하지 않는다.
- `useSectionPrompts.sectionRename`은 기존 `SelectionScope`와 화면 방문 순번에 연결한다. 캔버스/프로젝트 왕복 시 이전 이름 변경 창이 만료되며 이전 완료 콜백은 새 제목/대상을 닫지 않는다. `SectionRenameDialog`는 원래 DOM 위치·문구·입력 최대 길이·디자인을 유지하고 busy 중 입력/확인/닫힘을 막는다.
- `CanvasCollapseActions`는 시작 대상·명령 환경·저장 함수와 화면 수명을 고정한다. 문서는 ID/path/제목/collapsed만 복사하며 본문을 복제하지 않는다. 섹션/멤버·미리보기 설정·칸반 callback도 await 전에 캡처한다. 같은 화면의 중복 실행을 막고 대기 뒤 화면과 현재 AI 보호를 다시 검사한다.
- 로컬 문서 최소화는 기존 IPC가 Markdown metadata를 변경하고 문서별 히스토리에 기록한다. 공동 문서는 같은 IPC의 기존 개인 collapsed map을 사용하며 서버 문서나 공동 히스토리를 변경하지 않는다. 문서 ID/body/확장 높이는 그대로다. 이 단계에 새로운 IPC 필드나 서버 계약을 추가하지 않았다.
- 단일 문서 헤더/문맥 메뉴의 저장 순서를 유지한다. 문맥 메뉴에만 기존 성공 알림을 표시한다. 링크로 잠시 펼친 문서는 temporary 표시만 닫고 metadata나 공동 개인 map을 쓰지 않는다. 검색 중 펼침과 임시 섹션 펼침도 저장된 값과 구분한다.
- 섹션 최소화는 개인 `section-view:${personalScope}` 설정이다. 기존처럼 문서 편집기만 flush한 뒤 개인 값을 변경하고, 접을 때 멤버 선택을 정리하고 섹션을 선택한다. 개인 표시 자체에 새 계정/구독/서버 권한 정책을 도입하지 않으며 기존 AI 보호를 유지한다. flush 뒤 최신 개인 설정에 결과를 합쳐 다른 값의 손실을 막는다.
- 선택 최소화는 game UI→drawing→캡처한 문서 편집기 flush 순서를 유지한다. 선택 중 하나라도 접혀 있으면 모두 펼치고, 아니면 모두 접는다. 문서는 기존 순서로 개별 IPC를 실행하고 섹션/칸반은 개인 설정, HTML은 기존 preview window 저장 경로를 사용한다. 미리보기의 optimistic 반영·정규화·기존 오류 안내/계속 진행 의미를 유지하되 늦은 오류는 새 화면에 표시하지 않는다. 혼합 작업을 새 원자적 batch나 하나의 히스토리로 바꾸지 않는다.
- 문서 쓰기/flush 실패나 화면/AI 보호 변경 시 나머지 쓰기를 중단한다. 이미 저장한 앞부분을 rollback했다고 주장하지 않는다. 기존 section/selection busy와 연결하며 늦은 완료가 새 화면의 작업 상태를 해제하지 못하게 한다.

`collapse-actions.test.mjs`와 section/React hook 검사는 계산·저장 종류/순서·temporary 분리·대상 사본·중복 실행·지연·중간 실패·AI 보호·확인 만료와 StrictMode를 확인한다. `presentation-ui-scenarios.mjs`는 동일 실제 App 동작을 fixture와 Windows package에서 실행한다. 이름 변경/한 번 기록/Undo/Redo·개인 섹션 접기와 검색 중 펼침·문서 헤더/문맥 메뉴/선택 최소화/문서별 히스토리·캔버스 왕복 확인 만료를 검사한다. 실제 pane 드래그로 문서·섹션·HTML을 함께 선택해 미리보기 접기와 기존 위치/크기/preset/freeSize 보존도 확인한다. package는 사용자 섹션 본문/custom metadata·문서 원문·히스토리·개인 접기의 완전 재시작 보존까지 확인한다. 칸반 callback과 링크 temporary 문서 닫힘은 별도 서비스 검사로 구분한다.

pointer 배치 저장, clipboard paste 큐와 asset 가져오기, 나머지 inspector·AI/히스토리 화면 조립은 후속 R05 범위다. 이번 단위로 R05 전체 완료를 선언하지 않는다. 실사용 데이터·운영 서버·실제 AI/외부 계정은 검사에 사용하지 않는다.
