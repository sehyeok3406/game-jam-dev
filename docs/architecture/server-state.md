# 서버 상태 조회·편집 잠금·응답 조립

2026-10-22, 계획서 38절. R07 요청 3번 구현이다.

## 책임과 주입 경계

- `server/services/state-service.ts`는 state/lock/unlock을 처리한다. 현재 프로젝트와 인증된 참여자를 받고 권한, AI 파일 잠금, 잠금 Map, envelope, 시계·token, 알림을 주입받는다. HTTP·SQLite·파일 시스템을 사용하지 않는다. 호출자는 프로젝트 큐 안에서 현재 인증·수명·기능 지원을 검사한다.
- `project-envelope.ts`는 기존 전체 응답과 capabilities/state를 조립한다. 서버 버전·시계·presence·잠금만 주입하며, 탈퇴한 참여자와 인증 비밀을 노출하지 않는다. 관리자 초대 만료 조회와 AI 예약 baseline 제거를 유지한다.
- `project-response.ts`는 기존 v1 변경분 협상을 수행한다. 현재 committed 프로젝트와 요청·결과를 받아 응답만 만든다. 히스토리의 첫 revision이 연속일 때 파일/삭제·속성·작성자·그림 변경분을 반환하고, 기록이 끊겼거나 요청 revision이 유효하지 않으면 전체 응답을 유지한다.

## 보존한 동작

소유자와 token이 일치하는 잠금만 조회 시 갱신한다. 30초 lease, 같은 참여자의 token 재사용, 다른 참여자 잠금 거절, task 문서 관리자 권한, sections/Markdown/AI 검사 순서를 유지한다. 잠금 만료 비교는 기존처럼 `expiresAt < now`다. 해제할 잠금이 없어도 기존 알림을 발행한다. 이 동작은 잠금 프로토콜 변경 없이 추출하기 위한 호환 규칙이다.

metadataOnly가 knownRevision과 delta보다 우선한다. 같은 revision 조회의 files/revisions 생략, 그림 delta 협상과 전체 응답 fallback을 유지한다. 영속 저장이나 revision 증가는 잠금 서비스의 책임이 아니다.

## 검증

`tests/server-state.test.mjs` 9개는 응답의 비밀·예약 baseline 제외, role/presence, 조회 우선순위, 잘못된 갱신 항목·소유권/token, 재진입/clock, 잠금 보호, no-op 해제 알림, 현재 파일/삭제·metadata와 delta fallback을 검사한다. fake clock과 최소 port를 사용한다.

초기 presence fixture는 시각 1,000ms에서 기존 `(timestamp ?? 0) > now - 12000` 판정을 잘못 가정해 실패했다. 정상적인 시간대인 20,000ms로 fixture만 수정했다. 제품의 기존 판정이나 assertion은 약화하지 않았다. 실패 로그는 `out/r07-state-boundary-initial.log`에 보존했다.

최종 Windows package에서는 공동 편집·오프라인 충돌·히스토리 복원, 실제 내장 서버의 명령/receipt/SQLite 실패·재시도와 SSE 회귀를 확인했다. 전체 결과와 제한은 계획서 39절 및 `out/r07-assembly-verification.json`에 기록한다.
