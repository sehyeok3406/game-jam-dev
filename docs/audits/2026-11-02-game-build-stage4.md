# 게임 제작 개선 4단계 완료 보고

2026-11-02. **공통 준비 서비스를 실제 제작에 연결하고, 소스와 라이브러리·선택 이미지를 독립 HTML로 빌드한 뒤 기존 저장/서버/히스토리 경로에 반영하는 단계**를 구현했다. 새 gamejam HTML 요청은 workflow v2를 사용하고 과거 v1 명세는 기존 실행을 유지한다. 공개 배포나 5~7단계 완료를 의미하지 않는다.

## 변경 동작

| 영역        | 구현 결과                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 요청/협상   | 새 HTML 요청에 gameBuildVersion:1, 작업 명세에 workflow 2/game_build_version 1을 기록한다. 서버 health/state, 작성·승인·예약·claim·재시도·finish에서 생성 지원을 저장/지침 지원과 구분한다.                      |
| 실행        | 기존 coordinator가 run/session/lease·취소·완료를 유지한다. 문서 정리 선택 시 기존 첫 단계 후 ‘준비 → source → 앱 빌드’를 실행한다. 구현만 요청해도 공통 준비를 사용한다.                                         |
| AI 소스     | 비공개 stage의 source-plan.json과 JS/CSS/JSON/HTML 파일만 받는다. 원본 자료·요구·설계 문서·준비 자료를 전달하고 입력 변경·추가 출력·링크·파일/총량 위반·공급자 실패를 거절한다.                                  |
| 빌드        | 동봉 Node/Rolldown의 고정 builder로 선언된 source와 준비한 의존성만 번들한다. Node/URL/범위 밖 import·남은 동적 import·외부 리소스·분할 산출물은 실패한다. 사용자 설정/script/plugin을 실행하지 않는다.          |
| 이미지/고지 | 선택 이미지의 data URI를 catalog에 한 번만 넣어 HTML/CSS/JS에서 공유한다. 같은 그림을 반복 사용해도 payload를 반복 저장하지 않는다. 전체 라이선스 고지와 dependency/toolset/profile 기록을 비실행 JSON에 넣는다. |
| 원본 기록   | immutable revision에 원본 source·entry·HTML template·asset key/path/hash·문서 baseline·exact lock·고지·HTML/tool hash를 보관한다. 제작 recipe를 잃지 않도록 선택적 htmlTemplate 필드를 추가했다.                 |
| 실행 검사   | 큰 HTML을 navigation URL에 넣는 경로를 작은 shell + renderer IPC/srcdoc으로 교체했다. 이미지 decode/font 준비·리소스 오류, 기존 예외/Promise/ResizeObserver 분류와 timeout을 유지한다.                           |
| 반영/복구   | 기존 저장 큐·외부 변경 확인·lease·서버 durable commit을 재사용한다. 새 원본 revision과 HTML을 함께 반영하며 completed history 실패 시 함께 복구한다. 다른 게임의 index와 관련 없는 사용자 편집을 보존한다.       |

현재 책임 배치와 상세 source 계약은 [제작 실행 설계](../architecture/game-build-execution.md)에 기록했다. 새 범용 workflow 엔진·저장 큐·서버 AI 실행 경로·코드 편집기를 만들지 않았다. 기존 HTML 8MB·source 64개/각 2MB/합계 16MB 한도는 유지한다.

## 수행한 검증

| 항목                   | 실제 결과                                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 자동 검사         | `npm test`: **1,099 통과, 실패 0, 기존 공식 Grok CLI 조건부 검사 1개 생략**(총 1,100). architecture 검사 포함.                                                                                                                                                                         |
| 새 기본 회귀 7개       | v2와 과거 v1 구분·기존 요청 변환기의 버전 보존·source/asset 범위·단계 순서/늦은 세션/정리·source+HTML 반영/rollback·서버 산출물 범위·승인/claim 전 지원 버전을 확인했다.                                                                                                               |
| 실제 동봉 도구         | 최종 package의 game-build-runtime을 지정한 준비 8개 + source/bundle 5개 **총 13개 통과**. localhost fixture로 SRI·offline exact lock·고지·설치 hook/링크/peer 충돌·도구 변조·실제 JS/CSS/이미지/간접 모듈 bundle·미준비/동적/Node/URL import·입력 보호·네 공급자 파일 교환을 검사했다. |
| 실제 Windows 전체 경로 | `npm run package` 후 `GAMEJAM_PUBLIC_BUILD=1`의 `tests/game-build-execution-packaged.mjs` 통과. production IPC·실제 CLI 프로세스 fixture·준비/빌더·Electron HTML 검사·문서/source/HTML 저장·재시작 보존·내장 공동 서버 lease/cache/history를 사용했다.                                 |
| 실제 공개 라이브러리   | 위 공동 제작에서 **three@0.187.0**을 공개 npm에서 실제 확보/SRI 확인하고 Vector2 API를 사용하는 source를 번들했다. 최종 HTML은 494,121바이트, 라이브러리 없는 로컬 표본은 2,724바이트다. source 3개와 선택 이미지·empty 또는 Three exact lock을 보관했다.                              |
| 외부 단일 파일         | `tests/game-build-browser.mjs`로 같은 Three 결과 HTML을 Windows **Chrome·Edge의 file://**에서 실행했다. 양쪽 모두 목숨 7 표시·선택 GIF decode·화살표 입력에 따른 canvas 변경·페이지 외부 요청 **0건**·JavaScript 오류 **0건**을 확인했다.                                              |
| 기존 통합              | `npm run test:integration` 통과. 개인/공동 AI 반영·취소·Undo/Redo·예약/승인·프로젝트/자료/탭·native 창·포인터 잠금·한글 편집/저장 회귀를 확인했다. HTML runner는 실제 Electron에서 **7.5MB 전달**, 이미지 decode 실패, 기존 예외/거절/ResizeObserver 분류를 검사했다.                  |
| 타입/형식              | typecheck, typecheck:contracts, typecheck:core, lint 통과. 기존 discord mock no-this-alias 경고 1개는 유지한다.                                                                                                                                                                        |

별도 `npm run test:gamejam-validation`도 통과했다. 단계별 입력 보존·출력 구성·검토·서버/역할 차단·좁은 화면을 실제 renderer의 mock API로 확인했으며, 실제 AI 제작 검증과 구분한다.

네 공급자의 공통 source 준비/빌드는 실제 고정 worker와 **mock executor**로 검증했다. 전체 Windows IPC 경로의 CLI는 로컬 Claude fixture다. 실제 계정/유료 모델 생성·네 계정의 실제 tool 동작·게임 아트/규칙 전체 품질 검증은 하지 않았다. Chrome/Edge 표본은 의도적으로 단순한 이동 fixture이며 게임의 재미나 비주얼 다양성 개선을 평가한 결과가 아니다.

기존 main/IPC integration harness에는 mock compiler receipt를 주입했다. 과거 v1 호환·새 publication/session/lease 경로의 회귀이며 실제 bundle을 대신하지 않는다. 실제 compiler와 생성 결과는 별도 runtime/package/browser 검사로 확인했다. 기존 통합 fixture의 ‘정리 문서만 전달’ 가정도 현재 원본 요구 보존 계약에 맞춰 갱신했다.

## 패키지 검사에서 확인·수정한 사항

- 기존 공동 요청 변환기가 gameBuildVersion을 누락해 새 요청을 v1로 만들던 문제를 수정하고 순수 reducer/실제 서버 회귀를 추가했다. 구버전 승인/예약 claim이 쓰기 전에 거절되는 것도 확인했다.
- 원본 source의 module entry가 head에 있어도 DOM 분석 후 실행되도록, bundle을 inline module script로 넣었다. 실제 package fixture가 이 위치를 사용한다.
- 공유 전환 뒤에는 원래 로컬 프로젝트와 공동 프로젝트의 캐시 위치가 다르다. source 반영 확인은 현재 세션의 기존 durable cache를 사용했다. 탐색기용 파일 mirror를 새 반영 경로로 만들거나 서버 commit 성공을 원래 로컬 폴더 갱신과 혼동하지 않았다.
- 현재 Rolldown의 CSS 직접 bundle 미지원은 앱의 고정 CSS 처리로 해결했다. 코드 분할 파일이나 외부 리소스를 남긴 채 독립 HTML 성공으로 처리하지 않았다.

도구는 Node 24.19.0/npm 11.17.0/Rolldown·binding 1.2.12의 Windows x64 묶음이다. 로컬/실제 package의 manifest digest가 일치하며 파일 1,994개·128,196,213바이트(manifest 제외)다. worker에 번들된 파서/CSS 도구 8개 패키지의 라이선스·AUTHORS/COPYRIGHT 원문은 별도 THIRD-PARTY-NOTICES.txt에 동봉하고 manifest로 검사한다. 정확한 도구 digest, source/HTML/asset/lock hash와 브라우저 측정은 [측정 JSON](2026-11-02-game-build-stage4-evidence.json)에 보관했다.

브라우저 캡처 [Chrome](../../out/game-build-stage4/chrome.png)·[Edge](../../out/game-build-stage4/edge.png)와 실행 HTML/원본 측정은 로컬 ignored `out/game-build-stage4/`에 있다. 주요 로그는 `out/game-build-stage4-{tests,package,packaged,packaged-runtime,browser,integration,protocol,start}.log`다. 앱 의존성·루트 lock·공개 버전은 변경하지 않았고 공개 배포는 수행하지 않았다. architecture 예외를 추가하거나 검사 규칙을 완화하지 않았으며 shared.ts 호환 import 예외 한 곳을 제거했다.

## 남은 제약과 후속 단계

- **5단계:** source 기반 수정·새 버전·문서/소스/HTML 대응·복원의 전체 사용자 흐름과 충돌 정책. 현재도 연결된 기존 lock을 준비기에 전달하고 기존 revision을 보호하지만 이 전체 단계가 완료된 것은 아니다.
- **6단계:** 내보내기/가져오기 안내·누락/기준 문서 표시와 사용자 UI. 이번 외부 실행 검사는 생성한 HTML의 독립 실행 증거다. HTML 재가져오기 후 source 복원/수정 전체 흐름을 대신하지 않는다.
- **7단계:** 실제 네 AI 계정·여러 PC·게임 의미/전체 진행·장시간·시각 품질·여러 engine/asset/profile의 통합 검증. 요구 문구가 입력으로 보존된 것과 실제 AI가 모두 준수한 것을 구분한다.
- **기존 준비 제약 유지:** 공개 npm 초기 adapter, 설치 hook/bundled/git/file/alias 미지원, 선택 의존성 처리와 peer 충돌, root/간접 자료의 제한된 발췌는 [준비 설계](../architecture/dependency-preparation.md)를 따른다. Pixi.js 8.22.0의 간접 `@pixi/colord@2.9.6` 고지 원문 누락은 3단계에서 발견한 제한이며 이번에 우회하지 않았다. 해당 버전의 공식 원문을 별도 고정/캐시하는 경로는 아직 없다.
- HTML 한도는 8MB다. source/빌드 profile·처리 한도는 운영 서비스 구매 용량/결제와 별개다. 생성 결과의 byte-for-byte 재현성·운영 규모 부하·모든 브라우저 API 지원을 인증하지 않는다. 초기 검사만으로 게임 전체의 정상 동작을 추정하지 않는다.

단계별 상태는 [1차 계획](../plans/2026-11-01-game-build-phase1.md), 공개 저장/실행 계약은 [game-builds](../architecture/game-builds.md)를 따른다.
