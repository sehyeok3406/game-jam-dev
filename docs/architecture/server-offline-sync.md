# 서버 오프라인 변경 반영 경계

2026-10-21. 실행 계획 35절의 R07 단위다. 기존 `offline-sync` HTTP action·payload·응답과 클라이언트의 초안/충돌 해결 방식을 유지하면서 검증과 저장 조정을 분리했다.

## 책임과 조립

- `src/collaboration-server.ts`는 기존 프로젝트 FIFO 큐 안에서 현재 프로젝트/인증 사용자와 lifecycle·capability·임대 만료를 확인한 뒤 `offline.execute`로 전달한다. 요청 body의 memberId/role을 권한 근거로 사용하지 않는다.
- `src/server/services/offline-sync-service.ts`는 캔버스 capability → 작업 ID → 보관된 receipt/actor 확인 → 편집 권한 → 변경 준비 → AI 보호 → revision/잠금 → 후보/히스토리/receipt → persist → envelope 순서로 처리한다.
- `src/server/services/offline-changes.ts`의 `planOfflineChanges`는 새 snapshot을 준비한다. 변경 객체·1~500개 항목·경로·string/null·온라인 전용 파일 제한과 최종 snapshot을 검증하며 원본 파일을 수정하거나 저장하지 않는다. 최종 프로젝트 자체의 500개 파일/크기/ID/참조 검증도 기존 checkSnapshot으로 유지한다.
- 서비스에 필요한 editable/assertAiMutation/assertBases·clone/recordChanges·persist/envelope만 주입한다. HTTP 객체나 서버 전체 context, 새로운 큐·CLI·계정을 전달하지 않는다. 파일 저장소와 실제 recordChanges 조립은 현재 adapter에 남아 있다.

## 보존한 규칙

같은 작업 ID의 보관된 receipt가 같은 actor에게 속하면 현재 envelope를 돌려주며 변경을 다시 적용하지 않는다. 이 재전송 처리는 새 편집 권한/변경 본문 검증보다 앞선다. 따라서 인증된 사용자가 이후 viewer로 바뀌어도 완료된 작업의 재전송은 새 쓰기를 발생시키지 않는다. 권한 회수·lifecycle·공통 capability는 그 이전의 기존 ingress에서 검사한다. 다른 actor의 같은 ID는 거부한다. payload fingerprint나 새 receipt 형식은 추가하지 않았다.

새 변경은 기존 편집 권한, scoped/legacy AI 실행 및 예약 재료 보호, 변경 파일의 revision과 현재 잠금을 검사한다. 속성 동기화 프로젝트의 메타데이터 편집 잠금 예외도 유지하지만 오프라인 반영은 파일 revision을 사용한다. 여러 파일 중 하나라도 검증에 실패하면 준비한 snapshot을 반영하지 않는다.

AI task·캔버스 목록·output 파일은 온라인 전용이다. 기존 HTML 관리 문서는 workflow 속성만 바뀔 때 허용하며 본문·ID·연결 원본·삭제/새 생성은 거부한다. 정상적인 일반 문서의 생성/수정/삭제와 한글 본문은 유지한다.

후보의 파일·파일/property revision·히스토리와 receipt를 함께 저장하고 저장 성공 이후 응답한다. receipt 한도 500개, no-op batch도 revision/빈 변경 히스토리/receipt를 남기는 동작을 보존한다. 보관 한도를 넘은 오래된 receipt의 재전송은 새 요청과 같은 revision 검사 대상이다. 프로토콜이나 제품 정책을 새로 정하지 않았다.

SQLite commit 전 실패 시 현재 프로젝트와 성공 알림이 남지 않는 경계를 검증한다. commit 이후 lifecycle/runtime/checkpoint 파일 실패를 구분하는 기존 한계와 repository/migration은 R08에 남는다. 이번 추출이 모든 persist 오류나 물리 디스크 장애의 원자적 복구를 보장하는 것은 아니다.

## 검증 연결

`tests/server-offline-sync.test.mjs` 18개는 HTTP 없이 순수 snapshot 준비, batch/경로/HTML 제한, 저장 대기·실패, receipt 동시 재전송·actor 충돌·검사 순서, revision·잠금·AI 보호, 큐 대기 중 권한/현재 revision 변경, 한도/no-op 및 재시도를 확인한다. 실제 SyncStore/SQLite RAISE(ABORT)로 DB/blob/history/receipt 롤백·재개방 뒤 재전송을 검사한다. 테스트의 recordChanges/envelope는 주입한 port이므로 실제 조립 검증과 구분한다.

`tests/server-events-packaged.mjs`에는 최종 package의 내장 Node/서버에 직접 offline-sync를 보내는 회귀를 추가했다. 실제 임시 SQLite trigger로 저장 중단을 일으켜 DB/blob·현재 파일·히스토리·성공 SSE 미발행, 같은 ID 재시도/재전송 1회 반영, 다른 actor의 ID/역할 위조·stale revision 거부와 한글 문서 보존을 검사한다. 제품에 fault injection endpoint를 추가하지 않았다.

개발 UI의 편집/저장 동기화와 실제 Windows package의 오프라인 홈 편집·충돌 선택 UI·초안 백업·로컬 복귀도 검사한다. 실행한 명령/로그·입력 지문·최종 결과물 해시는 계획 35절과 `out/r07-offline-verification.json`에 기록한다. 테스트는 임시 데이터·격리 프로필·임의 로컬 포트를 사용한다.

## 후속 단위와 남은 R07

히스토리 조회·undo/redo·복원과 프로젝트 수명·휴지통은 계획서 36~37절 및 [히스토리](server-history.md)·[수명 서비스](server-lifecycle.md)로 이어진다. 다음 단위는 상태 조회·편집 잠금·응답 조립이다. 나머지 route/bootstrap과 R08~R10, F01~F04는 아직 완료하지 않았다.
