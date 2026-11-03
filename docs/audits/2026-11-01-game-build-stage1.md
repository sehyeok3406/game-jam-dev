# 게임 제작 개선 1단계 완료 보고

2026-11-01. 범위는 **수정용 원본의 보관·공동 저장·복구 기반**이다. 사용자가 요청한 1단계만 진행했으며 공개 배포와 2단계 이후 작업은 수행하지 않았다.

## 구현한 동작

| 영역           | 결과                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 원본 형식      | build별 UTF-8 source, exact dependency graph, 라이선스 고지, 입력/도구/출력 hash를 보관한다. 현재 HTML과 원본을 index의 artifact/build ID로 연결한다.                                      |
| 변경 보호      | 완료 원본은 일반 편집으로 덮어쓰지 않고 새 revision을 추가한다. 파일 목록·크기·SHA-256·연결·버전과 Windows 경로/대소문자/외부 junction을 검사한다.                                         |
| 파일 저장      | 기존 capture/materialize/apply/repository/mirror를 확장한다. v1은 `.game-builds`, v2는 `.gamejam/project/builds`를 사용한다. 자동 구조 전환이나 별도 저장 경로를 만들지 않는다.            |
| 수명           | 이동은 ID와 원본을 보존한다. 선택 복사는 모든 보존 revision과 필요한 asset을 포함하고 새 식별자를 발급한다. 삭제는 원본을 함께 제거하고 기존 이력으로 전체 복원한다.                       |
| 실패·복구      | 원자 파일 교체의 실패 rollback과 interrupted-history 복구를 재사용한다. 부분 쓰기는 capture로 읽을 수 있으나 완성 데이터로 인정하지 않는다.                                                |
| 공동 지원      | health/state는 저장 v1과 실제 한도를 알린다. 구버전의 state/join/쓰기와, 원본이 없는 상태에서 원본을 재도입하는 history/Redo도 거절한다. workflow v2 지원은 광고하지 않는다.               |
| 용량           | 원본 snapshot 64MB/500개, HTTP 72MB, source 한 파일 2MB·한 revision 16MB/64개다. legacy snapshot 20MB/HTTP 22MB와 HTML 8MB는 유지한다.                                                     |
| 서버 부하      | 서버마다 최대 4개 POST·body 예약 총 96MB를 유지한다. Content-Length와 chunked 수신을 검사하고, 연결이 먼저 끊겨도 진행 중인 업무가 끝나기 전 예약을 반환하지 않는다. 응답 완료도 기다린다. |
| 자체 서버 정책 | 선택적 `GAMEJAM_MAX_PROJECT_BYTES`를 commit 전에 검사한다. 기존 초과 프로젝트의 읽기와 크기 감소는 허용한다. 기술 상한·로컬 기능·미래 결제 quota와 구분한다.                               |

공통 타입은 `src/contracts/game-build.ts`, 순수 검증·reader/writer·수명 계산은 `src/core/projects/game-build.ts`, Node hash/byte codec은 `src/adapters/node/game-build-codec.ts`가 소유한다. 기존 저장 큐·프로젝트 session·권한·히스토리 경로를 유지했고 새 architecture 예외는 없다. 앱 의존성/lock 파일은 변경하지 않았다.

## 실제 수행한 검증

| 검증            | 결과와 범위                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`      | **1,077 통과, 0 실패, 1 건너뜀**(총 1,078). architecture 검사 10개 포함. 건너뛴 항목은 기존 공식 Grok CLI 지정 실행 검사다.                                                                                                             |
| 타입            | `npm run typecheck`, `typecheck:contracts`, `typecheck:core` 통과.                                                                                                                                                                      |
| lint            | `npm run lint` 통과. 기존 `tests/mocks/discord-transport.ts`의 no-this-alias 경고만 남는다.                                                                                                                                             |
| 원본 회귀       | 새 storage/server 검사 11개. 손상·누락·추가 파일, exact version, 경로/파일·폴더 충돌, 외부 junction, revision 불변성, 이동·복사, 삭제/전체 복원, 중단 복구, 구버전 차단, quota와 HTTP admission을 검사했다.                             |
| 실제 DB·백업    | 임시 협업 서버의 실제 HTTP/SQLite/checkpoint/검증된 백업을 사용했다. 서버 재시작과 다른 디렉터리로 백업 복원을 검증했다.                                                                                                                |
| 큰 데이터       | `node tests/game-build-large.mjs`: **60,857,902바이트·32 revision**의 실제 HTTP 저장→SQLite→백업 복원 통과. 64MB를 넘는 후보는 거절했다. 종료 시 RSS는 **661,962,752바이트**였다. 최대 RSS 측정이나 대규모 운영 부하 인증은 아니다.     |
| Windows package | 최종 소스로 `npm run package` 후 동일 결과물에 `node tests/game-build-packaged.mjs` 통과. 실제 Electron IPC로 명시적 v2 전환, 원본 변경 감시, 로컬→내장 공동 서버 전환, 이동·Undo/Redo·삭제·원본 복원과 앱/서버 전체 재시작을 확인했다. |

실제 package 검사는 임시 프로젝트와 UUID 테스트 프로필만 사용했다. 원본 연결 검사는 합성 게임과 합성 dependency metadata로 수행했으며, 라이브러리를 내려받거나 AI를 호출해 제작한 결과는 아니다. 현재 shared Undo는 서버 상태를 먼저 바꾸고 다음 mirror 준비에서 PC 사본을 맞춘다. 이 기존 정책을 테스트에서도 유지했다.

재실행 경로: `tests/game-build-storage.test.mjs`, `tests/game-build-server.test.mjs`, `tests/game-build-large.mjs`, `tests/game-build-packaged.mjs`. 해당 실행의 원문 로그는 로컬 ignored `out/game-build-stage1-{tests,large,package,packaged}.log`에 있다.

## 남은 범위·제약

- 현재 AI workflow는 아직 새 writer를 호출하지 않는다. **1단계 완료를 라이브러리 활용 게임 생성 완료로 해석하지 않는다.** 지침/사용자 문서, 의존성 조사·설치, bundle, 공급자별 실행, 수정 요청과 내보내기 UI는 2~7단계다.
- 저장 검증은 metadata 내부 정합성을 확인한다. 실제 registry 출처·다운로드 integrity, builder 도구 진위·실행 가능성은 후속 준비/build 단계가 확인해야 한다. source 파일 확장자 허용은 실행 지원 보장이 아니다.
- HTML 16MB 확대와 기존 대형 data URL 검사 결함 수정은 4단계다. 현재 HTML은 8MB이고, 그 아래에서도 알려진 대형 data URL 사례가 실패할 수 있다.
- 캐시·node_modules·인증·임시 파일은 원본 snapshot에 포함하지 않는다. 참조 없는 revision의 자동 GC는 구현하지 않았다. 기존 히스토리 보존/휴지통 정책을 바꾸지 않았다.
- 96MB 예약은 body 처리량 제어이며 전체 RSS·디스크 사용량 상한이 아니다. 자체 서버의 선택 정책도 현재 snapshot 문자열 누적량 기준이다. 사용자별 GB 구매·합산·분배, 히스토리를 포함한 디스크 quota와 GB 전송은 후속이다.
- 이번 검증은 Windows 한 PC의 앱/내장 서버와 임시 서버다. 실제 여러 PC·운영 서버 부하·유료 AI 4개 공급자의 실제 생성은 후속 통합 검증이다.

자세한 형식·현재/미래 기능 구분은 [게임 제작 계약](../architecture/game-builds.md), 결정 이유는 [ADR 0006](../architecture/decisions/0006-game-builds-and-standalone-html.md), 전체 진행 상태는 [1차 계획](../plans/2026-11-01-game-build-phase1.md)을 따른다.
