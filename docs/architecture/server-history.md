# 서버 히스토리 조회·undo/redo·복원

2026-10-22, 계획서 36절. R07의 첫 요청 단위다.

- `history-query.ts`는 변경 전후 읽기와 최신순 목록을 제공한다. AI 지시서의 기록 시점 snapshot 우선·legacy 현재 파일 fallback을 기존 함수로 유지한다. 파일 내용이나 히스토리를 조회 과정에서 저장하지 않는다.
- `history-restoration.ts`는 복원할 snapshot을 준비한다. 단일 파일 복원의 섹션·이미지·불러온 HTML 묶음 제한, 결과 경로 재연결과 최종 snapshot 검증을 유지한다. 원본 파일을 변경하거나 저장하지 않는다.
- `history-service.ts`는 현재 권한·작업 ID/receipt·잠금·AI 보호·revision을 확인하고 후보/히스토리/receipt 저장과 응답을 조정한다. admin/editable·잠금 조회·AI 검증·사본/기록·persist/checkpoint/envelope를 주입하며 HTTP나 큐를 소유하지 않는다.
- 기존 프로젝트 FIFO 큐 안의 현재 인증·lifecycle/capability·임대 만료는 서버 입구에 남겼다. undo/redo는 편집 권한 확인 후 receipt 재전송을 확인한다. 오프라인 반영과 검사 순서가 다르므로 통합하지 않았다.

undo/redo는 본인의 user 기록만 허용한다. 내용/구조 변경은 본인 소유를 포함한 활성 잠금 중에도 거절하고, 메타데이터 변화의 기존 예외와 현재 다른 속성을 보존하는 inverse merge를 유지한다. history-change의 receipt는 actor에 묶이고 500개를 유지한다.

이전 버전 복원은 관리자·편집 가능 상태·전체 잠금 해제·현재 프로젝트 revision과 completed 기록을 요구한다. 기존 순서대로 후보 저장 후 checkpoint를 export한다. checkpoint 실패가 DB 저장 실패를 의미하지 않는 현재 한계는 R08에 남겨 두었다. 복원 후 같은 오래된 revision의 재요청은 거부하지만 새 원격 응답 계약을 만들지는 않았다.

`tests/server-history.test.mjs` 14개는 조회·순수 준비, 권한/잠금/receipt·다른 속성 보존, 묶음 복원·AI 보호·대기 중 현재 상태, 저장 대기와 실제 SQLite abort/재개방을 확인한다. 직접 서비스 검사의 recordChanges/envelope는 주입 port다. `tests/collaboration-session-packaged.mjs`는 실제 최종 패키지와 내장 서버에서 문서 변경→readHistoryFile→undo/redo→히스토리 패널→변경 전 선택→실제 복원 확인 버튼→재시작 보존을 검사한다.

코드/검증 결과와 최종 package 입력 지문은 계획 36~37절 및 `out/r07-history-lifecycle-verification.json`에 기록한다. 이어지는 [프로젝트 수명·휴지통](server-lifecycle.md)도 같은 요청 범위다. 상태 조회/잠금·응답 조립과 나머지 route/bootstrap, R08~R10은 아직 남는다.
