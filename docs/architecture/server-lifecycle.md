# 서버 프로젝트 수명·휴지통

2026-10-22, 계획서 37절. 히스토리 분리 다음의 R07 요청 단위다.

## 경계와 보존 규칙

- `lifecycle-policy.ts`는 기본 active/version 0과 조회용 수명 정보, PROJECT_TRASHED/PROJECT_PURGED의 410 및 미존재 404 계약을 제공한다. 서버의 기존 공통 gate와 프로젝트 서비스가 같은 정책을 사용한다.
- `lifecycle-service.ts`는 관리자·이름·버전·팀 확인·AI 중지 검사와 trashing→trashed, restoring→active, purging→tombstone 처리 순서를 담당한다. 프로젝트 조회/큐·권한·체크포인트 대기·저장/marker·접근 정보 정리/제거·시계/ID·파일 작업만 주입한다.
- `project-retention.ts`는 UUID 자식 경로를 만들고 기존 statDirectory/moveChecked/purgeChecked를 사용한다. symlink/junction·디렉터리 정체성·목적지 덮어쓰기 검사를 끄지 않는다. 파일 이동/삭제는 체크된 경로에만 실행한다.
- 처음 휴지통 이동은 checkpoint 정리를 기다리고 전체 폴더를 보관한다. 기존 7일 보관과 팀 접근 차단·클라이언트 로컬 사본 보존을 유지한다. 복구는 lifecycle version과 프로젝트 revision을 올리고 이전 초대를 만료시킨다. 완전 삭제는 파일 삭제 후 DB tombstone/marker, 메모리와 SSE 정리를 따른다.

새 트랜잭션이나 파일 형식을 추가하지 않았다. 수명 처리는 의도적으로 지속 가능한 중간 단계를 저장하며, 일반 문서 편집의 후보 단일 commit과 다르다. 파일 이동과 DB/marker를 하나의 원자적 트랜잭션으로 만들었다고 주장하지 않는다. 저장 중 실패한 현재 객체가 단계 상태를 갖는 기존 동작도 유지하며, commit 이후 파일 오류 구분·저장소 계층은 R08에 남는다.

## 현재 상태 재검증 보완

기존 유지보수는 프로젝트 목록의 객체를 잡은 뒤 큐를 기다렸고, 다른 작업이 프로젝트를 교체해도 이전 객체를 사용할 수 있었다. 이제 큐 안에서 프로젝트를 다시 조회하고 현재 lifecycle을 확인한다. 이미 active로 교체되거나 제거된 프로젝트에는 오래된 휴지통 작업을 수행하지 않는다. 실제 코드의 안전한 현재 상태 검증을 위한 계획 보완이며, 새 삭제 정책을 도입한 것은 아니다.

## 검증

`tests/server-lifecycle.test.mjs` 12개는 정책/권한·버전/확인/AI, checkpoint 대기·전체 파일·재전송, 복구 버전/초대, 만료·삭제/tombstone, 교체된 폴더·junction·경로 탈출 차단, rename 뒤 저장 실패와 trashing/restoring/purging 재개, 큐 대기 뒤 현재 상태를 검사한다. 실제 임시 디렉터리와 기존 checked 파일 함수를 사용하고 DB/marker는 port 기록으로 확인한다. 기존 서버 통합 project-trash 회귀도 함께 실행한다.

실제 package 공동 연결 검사에는 내장 Node/서버의 휴지통→재시작→접근 차단→복원→다시 삭제/완전 삭제→재시작 후 tombstone 차단을 추가했다. 별도 project-trash-packaged 검사는 실제 Windows 앱의 확인/취소·보관·초안/숨김 파일 복구·영구 삭제·팀 삭제/복원과 로컬 사본 복구 UI를 확인한다. 이 별도 검사의 팀 backend는 소스 서버이며, 내장 번들 자체는 앞선 공동 연결 검사로 별도 확인한다.

SQLite trigger는 실제 디스크 장애나 전원 차단 시험이 아니다. 실제 계정·외부망·Linux/Render와 운영 자료 이전은 수행하지 않았다. 후속 상태 조회·편집 잠금·응답 조립과 route/bootstrap은 계획서 38~39절에서 완료했다. 경계 설명은 `server-state.md`, `server-assembly.md`이며 다음 구현은 R08 저장소 책임 분리다. R09~R10도 남아 있다.
