# Game jam! 1차 게임 제작 개선 계획

2026-11-03 갱신. 사용자와 항목별로 확정한 범위다. 사용자의 단계별 지시에 따라 **0~6단계 구현과 7단계의 Codex 실제 제작·공통 기능 검증을 완료**했다. 공개 배포·후속 전체 구현 승인을 뜻하지 않는다.

## 확정된 제품 방향

| 항목          | 결정                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| 검증 환경     | Windows 앱과 Windows Chrome·Edge. 모바일은 후속                         |
| AI            | Codex/Claude/Gemini/Grok 모두 공통 기능 제공                            |
| 라이브러리    | 이름 allowlist 없이 선택. 실제 배포/실행 조건 검사. 기존 게임 lock 유지 |
| 설계          | 사용자 편집 시스템 문서에 통합. 아이디어 원본 보호                      |
| 지침          | 재사용해 만드는 새 요청에 최신 default, 사용자 지시와 과거 기록 보존    |
| 저장          | 로컬/자체 서버/향후 운영 서비스를 구분. 처리 한도와 서비스 quota 분리   |
| 원본          | 수정용 source·asset 연결·exact dependencies·HTML 함께 보관/복원         |
| import/export | 독립 HTML 우선. 외부 참조 자동 수집은 후속. 기본 export는 HTML 하나     |

이미지 자동 검색/생성, 자동 화면 평가/수정, 모바일, ZIP·폴더 import/export, 코드 편집기, 결제·quota 합산은 1차 범위가 아니다. 앱 밖 온라인 멀티플레이를 새로 제공하지 않는다.

## 단계와 완료 기준

| 단계 | 작업                      | 완료 기준                                                                                  | 상태                                                            |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 0    | 기술 검증·계약·ADR        | bundle·실행·한계 측정, 도구/경로/버전/profile/한도 설계                                    | 완료 · 제품 기능 미구현                                         |
| 1    | 원본·공동 저장·복구       | DTO, snapshot/mirror, server validation, copy/move/delete/history/backup와 capability 연결 | 완료 · 저장 기반 구현                                           |
| 2    | 지침·요구·설계 문서       | default/custom 구분, 원본 요구 재전달, 문서와 제작 기준 연결                               | 완료 · workflow v1 유지                                         |
| 3    | 공통 준비 기능            | 조사/선정/lock/자료 전달, 4개 공급자 파일 기반 교환, 취소/실패                             | 완료 · 독립 서비스/도구. 제작 흐름 연결은 4단계                 |
| 4    | 실행 v2·source·HTML build | 고정 단계, 실제 source bundle, embedded deps/assets, 검사 후 기존 경로 반영                | 완료 · 실제 source/bundle·기존 반영 연결                        |
| 5    | 수정·버전·복원            | exact lock 유지, 문서/소스/HTML 대응, 충돌·새 버전·복구                                    | 완료 · source 수정·고정 lock·문서 target·새 버전·전체 복원      |
| 6    | export/import·UI          | 외부 실행→재가져오기→수정, 누락/실패/기준 문서 안내                                        | 완료 · HTML 내보내기·새 import·원본/문서 상태·local/shared 검증 |
| 7    | 통합 검증                 | Codex 실제 제작·공통 기능·Windows package·로컬/공동/복구·요구/이미지/비주얼 검증           | 완료 · 합의한 Codex/공통 범위. 다른 3종 실제 계정은 보류        |

## 0단계 산출물

- [ADR 0005](../architecture/decisions/0005-game-builds-and-standalone-html.md): 결정·대안·이행 경계.
- [구현 계약](../architecture/game-builds.md): 논리/실제 경로, DTO, 버전 협상, source revision, 정확한 출력과 저장 정책.
- [검증 보고서](../audits/2026-11-01-game-build-stage0.md)와 [측정 JSON](../audits/2026-11-01-game-build-stage0-evidence.json).
- `tools/game-build-stage0/`: 재실행 가능한 별도 spike. production 코드에서 import하지 않는다.

0단계 완료는 설계와 실행 가능성의 확인이다. 1단계 저장·복구는 [1단계 보고서](../audits/2026-11-01-game-build-stage1.md), 2단계 지침·요구·기준 문서와 화면 검증은 [2단계 보고서](../audits/2026-11-01-game-build-stage2.md), 3단계 공통 준비·독립 도구와 제한은 [3단계 보고서](../audits/2026-11-02-game-build-stage3.md)에 기록했다. 4단계에서 준비 서비스 호출·소스 작성·실제 게임 빌드·HTML 검사·기존 반영을 연결했다. 실제 동작과 제한은 [4단계 보고서](../audits/2026-11-02-game-build-stage4.md)에 기록한다. 5단계에서 기존 원본 수정·고정 lock·명시적 시스템 문서 갱신·새 버전·전체 기록 복원을 연결했다. 결과와 제약은 [5단계 보고서](../audits/2026-11-02-game-build-stage5.md)를 따른다. 6단계에서 기본 HTML 하나 내보내기·원본을 보존한 새 가져오기/수정과 제작 상태 안내를 연결했다. 실제 Windows 저장 창·local/shared round trip·Chrome/Edge 결과와 제약은 [6단계 보고서](../audits/2026-11-03-game-build-stage6.md)를 따른다. 7단계의 실제 Codex 제작·규칙·이미지·시각 차이·수정/복원·입출력·실패/취소 결과와 수정은 [7단계 보고서](../audits/2026-11-03-game-build-stage7.md)를 따른다. 다른 AI 3종의 실제 계정 검증은 사용자 합의대로 보류한다.

## 단계별 공통 검증

2026-11-03 사용자 합의로 7단계 실제 계정 검증은 현재 사용할 수 있는 Codex를 대상으로 한다. Claude/Gemini/Grok은 기존 모의 실행·공통 계약 검사와 실제 계정 검증을 구분하고 실제 계정 부분을 보류한다. 완료 시에도 네 공급자의 실제 품질을 모두 확인했다고 표시하지 않는다. 대표 시나리오는 제공 PNG를 사용하는 픽셀 숲 게임, Three.js로 렌더링하는 3D 네온 퍼즐, 일부 수치 수정·문서 갱신·복원, HTML 내보내기/재가져오기 후 새 source 제작이다. 모두 합성 자료·격리 프로젝트를 사용하며 공개 배포는 포함하지 않는다.

TypeScript는 typecheck, contracts/core 변경은 strict 검사, 의존/배치/runtime 경계 변경은 test:architecture를 사용한다. 영역별 검사는 regression-matrix에서 선택한다. 규칙 완화·예외 목록 재생성으로 통과시키지 않는다. 실제 package 기능은 실제 package에서 확인하며 같은 소스의 검사를 불필요하게 반복하지 않는다.

결과에는 변경 동작, 실제 실행한 검증, 남은 제약을 남긴다. mock·형식 검사·실제 계정·실제 package·실행 화면 평가를 구분한다. 최초 전체 완료는 시스템 문서→원본 보존→라이브러리 활용→수정→독립 HTML 이식의 전체 경로로 판정한다.
