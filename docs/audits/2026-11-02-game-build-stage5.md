# 게임 제작 5단계: 원본 수정·버전·복원

2026-11-02. 사용자 지시 ‘5단계 진행’ 범위의 구현·검증 기록이다. 0~4단계 작업을 보존하고 기존 AI 실행·저장·히스토리 경로를 확장했다. [현재 설계](../architecture/game-build-editing.md)와 [1차 계획](../plans/2026-11-01-game-build-phase1.md)을 함께 따른다.

## 변경 동작

| 항목             | 실제 변경                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 기존 게임 수정   | 현재 recipe의 source/plan을 비공개 수정용 사본으로 제공. 기존 HTML/artifact는 유지하고 새 build revision 저장              |
| 새 버전          | 선택한 게임 원본·lock·이미지를 사용하되 새 HTML/artifact/build 생성. 기준 버전 유지                                        |
| 문서·이미지 승계 | 해당 게임 manifest에 연결된 현재 문서/원본 아이디어/이미지를 입력에 포함. path와 ID가 다른 문서는 자동 대체하지 않음       |
| 고정 의존성      | 기존 library 준비 생략, 임의 lock 변경을 준비 서비스·실행 port·local/server 확정에서 차단                                  |
| 문서 갱신        | ‘기존 문서 수정하기’가 지정한 path/ID만 document_updates로 허용. 원본 아이디어 보호, 소스 단계에서는 갱신 문서도 읽기 전용 |
| 문서만 수정      | source build 없이 기존 문서 산출 경로로 정상 완료                                                                          |
| 충돌             | 관련 문서/이미지/원본과 해당 HTML의 index 연결을 baseline에 포함. 같은 HTML이어도 원본 revision 교체를 발견                |
| 전체 복원        | 문서·원본·lock·HTML 전체 기록으로 복원. 기록 이후 다른 게임의 index 연결·원본 유지                                         |
| 구버전           | gameBuildEditingVersion:1을 별도로 협상. 미지원 v2 작성·승인/예약·claim/replay·완료를 반영 전에 거절                       |

다운로드·빌드는 사용자/관리자 PC, 공동 데이터 확정은 기존 서버 lease/durable commit에서 수행한다. UI에 별도 저장·복원 경로나 공통 재수출 import를 추가하지 않았다. 개인 로컬 실행은 서버·로그인·구독과 독립이다. 아키텍처 예외 추가·검사 규칙 완화는 없다.

## 검증

| 검사                         | 결과·범위                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm test                     | 1,109개 중 **1,108 통과**, 실패 0, 기존 Grok native CLI 조건부 검사 1개 건너뜀. architecture 포함                                                                                                                                |
| typecheck / contracts / core | 통과. 공통 DTO·순수 계산 환경 및 앱 전체 타입 검사                                                                                                                                                                               |
| lint / diff check            | oxlint 통과(기존 discord mock 경고 1개), 5단계 변경 파일 서식 검사·diff check 통과. 전체 oxfmt는 별도 계획 문서 docs/plans/2026-11-02-shared-location-links.md의 서식 문제 1개로 미통과. 해당 문서는 이번 범위에서 수정하지 않음 |
| 동봉 도구 runtime            | 실제 Windows package resource로 **14/14 통과**. 준비 8개 + source/bundle 6개. 네 공급자의 수정 사본과 실제 bundler 포함                                                                                                          |
| Windows package              | 실제 IPC·모의 Claude CLI·파일 교환·독립 HTML 빌드·Electron 검사·로컬/공동 저장·재시작·수정·새 버전·실패·before/after 복원 통과                                                                                                   |
| Chrome / Edge                | 수정 후 edit-three.html을 file://로 실행. lives=9, 이미지 decode, canvas 키 이동, 외부 요청 0·JS 오류 0                                                                                                                          |
| gamejam UI 검사              | 원본 요구/비주얼 설계·단계/출력 설정·검토·구버전 서버 차단 등 통과. 모의 runtime/AI 경계                                                                                                                                         |
| main/Electron 통합           | 통과. 기존 IPC·저장·AI 잠금·문서·HTML/이미지 초기 실행·멀티플레이·실제 탭/편집/한글 입력 회귀. main compatibility의 compiler는 모의 receipt                                                                                      |

실제 동봉 도구와 원본 보존을 모의 compiler receipt만으로 대체하지 않았다. main 호환성 harness의 compiler는 기존처럼 모의 receipt이며 실제 package/worker 검증과 구분한다. 게임을 작성한 AI executor/Claude CLI는 로컬 fixture다. 실제 Codex/Claude/Gemini/Grok 계정·유료 API는 호출하지 않았다.

## 실제 패키지 시나리오

1. 원본 아이디어·GIF로 새 게임과 제작 기준 문서 생성.
2. 기존 source/asset 별칭/CSS를 이어 받아 목숨 값을 7→9로 변경하고 선택한 제작 기준 문서 갱신. 같은 HTML/artifact와 새 build 확인.
3. 기준 게임에서 새 버전을 만들고 이전 HTML/원본·이미지 연결 유지 확인.
4. 미준비 library import로 빌드를 실패시켜 이전 HTML/index 보존 확인.
5. 수정 기록의 before/after를 복원하면서 이후 새 버전은 보존. 문서도 함께 복원.
6. 앱 재시작으로 원본 보존 확인 후 내장 협업 서버 프로젝트 생성.
7. 실제 공개 three@0.187.0을 준비·번들하고 Vector2 API 사용 확인. 고정 lock으로 수정 후 공동 기록 before/after 복원.
8. 수정 HTML을 프로젝트 밖 Chrome/Edge에서 실행해 이미지와 기존 키 입력 유지 확인.

단순 fixture이므로 ‘전투 금지’ 등의 모든 의미적 요구, 화면 문구 전체나 아트 품질을 실제 AI가 정확히 충족했다는 검증은 아니다. 수치·입력·리소스와 저장 관계를 검증했다. 실제 장르별 제작 품질은 7단계다.

## 발견·보완한 사항

- 과거에는 source revision을 입력에 둘 수 있어도 실제 수정용 `source/` 사본이 없고 연결 문서·이미지가 빠질 수 있었다. 현재 recipe를 재구성해 동일 입력 계약으로 전달했다.
- 기존 의존성이 있어도 done(null)로 준비를 생략할 수 있었다. 실제 이전 lock이 있는 완료에는 준비 결과를 요구한다.
- 과거 기록의 전체 index를 그대로 복원하면 이후 다른 게임 연결이 사라질 수 있었다. 기록 전후에 달라진 artifact만 현재 index에 반영한다. 최초 생성 이전 복원은 그 게임의 후속 revision도 제거한다.
- source pointer가 바뀌고 HTML은 같을 때 단순 파일 비교로 놓칠 수 있었다. 관련 index 연결을 scoped baseline에 포함하고 해당 지원판을 별도로 협상한다.
- 기존 검사 중 선택 문서의 모든 갱신을 거절하던 fixture를 명시적 시스템 문서 갱신 계약으로 갱신했다. 원본 아이디어 거절과 일반 출력 검사는 유지했다.
- 패키지 검사에서 서버 확정 후 client cache가 아직 이전 revision일 수 있음을 반영했다. 새 build ID와 복원 revision이 durable cache에 도착한 후 확인한다. 이를 서버 commit 실패로 판정하지 않는다.
- main 통합 검사의 동시 편집 구간은 2초 모의 실행 시간 대신 기존 hold/release barrier로 고정했다. 실행이 먼저 종료되어 잠금 검사가 흔들리는 문제를 제거했다.

## 남은 범위·제약

- 일반 수정은 기존 dependency graph 전체를 유지한다. library 추가·삭제·교체·업그레이드를 명시하는 제품 계약/UI는 아직 없다. 내부 준비 port의 allowedUpgrades를 제품 지원으로 주장하지 않는다.
- `htmlTemplate`이 없는 초기 저장 전용 revision은 완전한 recipe 복원으로 취급하지 않는다. 독립 HTML과 참고 자료에서 새 source를 작성하며 지원하지 않는 과거 lock을 최신판으로 몰래 대체하지 않는다.
- 문서 hash는 AI가 읽은 snapshot 사실이며 앱 metadata 정리 후 최종 저장 문자열과 다를 수 있다. hash 차이를 자동으로 ‘미구현’ 또는 ‘구현 완료’로 해석하지 않는다. 상태·누락 안내 UI는 6단계다.
- public npm·고지 원문·설치 hook 미실행·browser profile·HTML 8MB·Windows x64 도구 제한은 유지한다. Pixi의 고지 원문 확보 제한도 이번 단계에서 변경하지 않았다.
- HTML 가져오기/내보내기와 재가져오기 안내 UI는 6단계, 실제 AI 계정·아트/플레이 품질·전체 조합 평가는 7단계다. 자동 이미지 검색/생성은 1차 범위 밖이다.
- 새 커밋·버전 증가·공개 배포는 수행하지 않았다. 기존 복원 저장 경계를 재사용한 것으로 모든 디스크 장애·강제 종료 상황의 새 원자성 인증을 뜻하지 않는다.

## 증거

[측정 JSON](2026-11-02-game-build-stage5-evidence.json)에 최종 package 도구 digest, 실제 생성/수정 manifest·Three lock·브라우저 결과와 검사 결과를 보관한다. 임시 프로필·테스트 프로젝트는 정리하며 로그/HTML/PNG는 로컬 out/game-build-stage5\*에 남긴다.

- out/game-build-stage5-tests.log
- out/game-build-stage5-typecheck.log / contracts.log / core.log / lint.log
- out/game-build-stage5-package.log / packaged.log / packaged-runtime.log
- out/game-build-stage5-integration.log / ui.log / browser.log / diffcheck.log
