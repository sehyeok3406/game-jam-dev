# 게임 원본 수정·버전·복원

2026-11-02. 5단계의 현재 동작이다. [제작 실행](game-build-execution.md), [원본 저장 계약](game-builds.md), [요청 지침](task-instructions.md)을 확장하며 기존 저장 큐·프로젝트 세션·서버 lease·히스토리를 사용한다.

## 수정 입력과 버전

기존 게임 수정과 기준 게임에서 새 버전 만들기 모두 `htmlResult.basePath`로 기준을 선택한다. 새 원본 경로를 사용자가 입력하지 않는다. `gameBuildEditingInputs`가 그 HTML의 현재 index 항목과 manifest를 따라 현재 기준 문서·원본 아이디어·이미지를 작업 입력에 더한다. 다른 게임의 문서를 일괄로 넣지 않는다. 문서는 현재 path와 ID가 일치할 때 연결하며 삭제·다른 ID로 대체된 문서는 자동으로 다른 문서에 연결하지 않는다.

v0.43.0 통합에서는 이름 registry가 같은 ID의 현재 경로를 알고 있으면 그 경로를 사용한다. HTML 개명은 기존 파일명 계획의 참조 remap에서 mutable build index만 이동하고 과거 manifest는 보존한다. 기준 문서 개명도 과거 path 대신 registry의 현재 path/ID로 자료와 상태를 찾는다. source 단계의 previousDocuments는 당시 path/hash와 별도 currentPath/currentSha256을 구분한다. 원본 개명 이력을 과거 revision에 덮어쓰지 않는다.

실행 시작 snapshot에서 `AiRunService`가 전체 저장 묶음을 검증하고 기존 lock과 recipe를 읽는다. `previousSource`는 manifest의 entry/htmlTemplate/source 목록/asset 별칭과 원본 파일 내용이다. desktop은 이를 비공개 stage의 `source/`와 `source-plan.json`에 **수정 가능한 사본**으로 둔다. 원래 `.game-builds/<buildId>`는 읽기 전용이다. Grok의 파일 입력 JSON에도 이 수정용 사본을 전달한다. 네 공급자 모두 같은 동작을 사용한다.

`previousDocuments`는 과거 path/ID/hash와 현재 입력의 hash/ID 일치 여부를 제공한다. hash 차이는 파일 내용이 달라졌다는 사실이며 구현 누락이나 요구 완료의 자동 판정이 아니다. manifest의 문서 hash는 AI가 소스 작성 시 읽은 파일의 사실이다. 반영 과정의 캔버스 좌표·출처 등 앱 metadata 정리 후 저장 문자열과 다를 수 있다. 이 값을 의미적 구현 완료 표시로 사용하지 않는다. 누락 문서 안내·변경 상태의 사용자 화면은 6단계다.

기존 저장 전용 revision에 `htmlTemplate`이 없으면 완전한 recipe를 복원했다고 주장하지 않는다. 기존 HTML·자료·lock을 참고해 새 source 묶음을 작성한다. source가 없는 독립 HTML의 기존 입력 경로도 유지한다. 지원하지 않는 과거 lock 형식은 조용히 최신 버전으로 대체하지 않는다.

| 선택                       | 반영                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| 기존 게임 수정             | 같은 HTML 경로·artifact ID, 새로운 build ID. 이전 revision은 유지 |
| 기준 게임에서 새 버전      | 새 HTML 경로·artifact ID·build ID. 기준 HTML·원본은 유지          |
| 문서 수정 없이 게임만 수정 | 현재 저장된 기준 문서를 읽기 전용으로 사용                        |

## 고정 의존성

기준 게임의 기존 exact lock을 기본값으로 사용한다. ‘결과 설정 → 라이브러리 변경’에서 직접 사용하는 npm 패키지의 추가·삭제·버전 변경을 지정할 수 있다. 교체는 삭제와 추가를 함께 지정한다. 버전을 비우면 실행 시 npm `latest`를 확인하고, 버전을 입력하면 그 버전을 준비한다. 최종 확인 및 공동 요청 검토에는 변경 목록을 표시한다. 이 명시적 선택을 작업의 `dependency_changes`에 보관하고 문서 정리→구현 작업은 바깥 명세와 구현 단계가 일치해야 한다.

선택한 변경이 있으면 앱이 기준 lock에서 준비할 목록을 계산한다. 준비 결과와 최종 local/server 반영은 같은 규칙으로 직접 의존성 목록, 지정 버전, 변경 대상이 아닌 직접 의존성의 고정 버전·출처·무결성을 확인한다. 추가·삭제·버전 변경에 따라 간접 의존성은 다시 계산할 수 있다. 기존 검증과 고지·browser profile을 적용하며 전체 제작 성공 후 새 revision에 정확한 lock을 기록한다.

변경을 지정하지 않은 기존 게임에는 기존 graph를 유지한다. 준비 단계에서 AI가 새 패키지를 요청하면 이름과 이유를 작업 기록에 남긴다. 기록에서 이전 요청을 다시 열면 제안이 결과 설정에 표시되며 사용자가 추가를 선택할 수 있다. 자유 입력 지시와 참고 문서는 준비 단계에 전달한다. 새 게임은 기존처럼 AI가 라이브러리를 선택할 수 있다.

공동 작업에서 이 명세는 `gameDependencyChangesVersion:1`을 사용한다. 기존 변경 없는 작업은 이전과 동일한 제작·수정 capability를 사용한다. 서버는 새 명세의 생성·요청 수정·승인·실행·결과 반영에 지원판을 확인한다.

## 명시적 시스템 문서 갱신

사용자가 ‘기존 문서 수정하기’를 선택하면 task planner가 실제 기존 출력 문서의 path/ID를 `document_updates:{version:1,targets:[{path,id}]}`로 기록한다. 문서 정리만 하는 요청과 문서 정리→게임 제작 요청에 적용한다. 암묵적인 기본 출력 선택만으로 입력 원본의 덮어쓰기를 허용하지 않는다.

- 대상은 `docs/` 아래 system/overview/question 문서다. 아이디어·이미지·다른 입력은 계속 읽기 전용이다.
- 선택한 입력과 문서 출력의 교집합은 이 target에 있는 경우만 허용한다. 일반적인 입력 보호 검사를 전역으로 완화하지 않는다.
- 선언한 ID와 문서 종류는 실행 시작 및 서버 반영에서 확인한다. 사용자가 실행 전에 저장한 동일 ID 문서의 현재 내용이 baseline이다.
- 문서 단계에서만 target을 수정한다. 다음 소스 단계에서는 새로 검증한 문서도 읽기 전용이다. ID·출처·문서 구성 검사는 기존 validators를 유지한다.
- 게임을 함께 요청하면 문서/원본/lock/HTML 전체가 성공한 경우에만 반영한다. 실패 rollback은 실행 시작 전 사용자의 문서 편집을 보존한다.
- 문서 정리만 요청하면 source build 없이 기존 문서 산출 경로로 정상 완료할 수 있다.

## 충돌과 협상

`taskFileLock`은 기준 HTML뿐 아니라 해당 현재 revision과 연결 문서·이미지도 보호한다. `aiLockedSnapshot`은 관련 HTML의 index 연결만 포함한다. 전체 index를 잠그는 대신 관련 path/artifact/build 연결을 비교하므로 다른 게임의 신규 제작은 막지 않으면서, HTML이 우연히 동일해도 기준 revision 교체를 발견한다. 현재 snapshot에 새 revision을 rebase하는 기존 반영은 유지한다.

이 scoped baseline 해석과 문서 갱신을 지원하는 capability는 `gameBuildEditingVersion:1`이다. health/state에 광고하고 클라이언트가 요청 작성·승인·실행 전에 확인한다. 클라이언트는 wire에 지원판을 보내며 서버는 v2 task 작성·승인/예약·claim·replay·완료 전에 검사한다. `gameBuildVersion:1`/저장 version/지침 version을 대신 쓰지 않는다. 과거 v1 명세는 계속 기존 실행 경로를 사용한다. 저장된 v2 명세를 재작성하지 않으며 실행에는 현재 앱·서버 지원이 필요하다.

관련 파일 외부 변경, 오래된 세션, 취소, lease 만료와 실패 복구는 기존 coordinator/publication 경계를 사용한다. 결과의 HTML·source·lock hash만으로 모든 게임 요구나 화면 품질의 충족을 주장하지 않는다.

## 전체 기록 복원

원본이 포함된 AI 기록은 HTML 한 파일만 복원할 수 없다. 기존 전체 기록의 before/after 선택으로 문서·소스·lock·HTML을 함께 복원한다. 결과가 이동했다면 기존 결과 별칭 remap을 먼저 적용한다.

공통 `rebaseGameBuildRestoration`은 기록 전후 index에서 실제 달라진 artifact ID만 복원한다. 기록 이후에 만들어진 다른 게임의 index 항목·원본은 유지한다. 게임 최초 생성 이전으로 복원해 게임을 제거하는 경우 해당 게임의 후속 revision도 제거해 고아 원본을 만들지 않는다. 복원 기록 자체는 기존 history에 남는다. 전체 프로젝트를 과거 시점으로 되감는 기능은 아니다.

로컬 filesystem restore와 서버 후보 계획이 같은 계산을 사용한다. 후보 전체의 저장 정합성 검사를 통과해야 적용한다. 서버는 기존 관리자·revision·잠금·durable commit 규칙을 유지한다. 서버 확정과 클라이언트 durable cache/탐색기용 사본 갱신은 서로 다른 수명이므로 검증에서도 구분한다.

남아 있는 게임 revision이 참조하는 이미지는 기존 이미지 참조 검사로, 사운드와 모델은 로컬 미디어 어댑터로 원본을 보존한다. 역사에서 참조되던 게임 revision 전체를 제거할 때는 이미지 복구가 가능하도록 원본 해시별 사본을 로컬 복구 저장소에 보관한다. 사운드와 모델은 기존 콘텐츠 주소 기반 복구 저장소에서 복원한다. BLEND에서 만든 GLB는 프로젝트 내 해시 주소로 저장하고 여러 revision이 공유한다. 게임 출력과 제작 기록에는 바이너리 대신 참조만 저장한다.

## 검증

`tests/game-build-editing.test.mjs`는 원본/문서/이미지 승계, source 사본, 기존 수정·새 버전, 문서 target/rollback, 관련 변경·source pointer 충돌, 서버 입력 검사, 고정 의존성 생략 거절, 실제 filesystem 및 서버 후보 복원을 검사한다. 기본 `npm test`에 포함된다.

`tests/game-build-runtime.mjs`는 네 공급자의 source 수정 사본과 실제 고정 bundler를 연결한다. 실제 AI 계정은 모의 executor로 구분한다. 패키지 후 `GAMEJAM_BUILD_EDITING=1 GAMEJAM_PUBLIC_BUILD=1 node tests/game-build-execution-packaged.mjs`에 해당하는 환경 설정으로 Windows IPC·모의 Claude CLI·실제 Three.js·로컬/공동 수정·문서·새 버전·실패·재시작·복원을 확인한다. PowerShell에서는 두 환경 변수를 `$env:`로 먼저 설정한다. `node tests/game-build-browser.mjs out/game-build-stage5/edit-three.html 9`는 수정 후 단일 파일의 Chrome/Edge 실행·이미지·키 입력·외부 요청을 확인한다.

수행 결과는 [5단계 보고서](../audits/2026-11-02-game-build-stage5.md)에 기록한다. 6단계의 [가져오기/내보내기와 상태 안내](game-build-transfer.md)는 HTML 원본을 유지한 새 source 제작, 선택적 의미 비교 hash와 원본/문서 상태를 연결한다. 실제 계정·장르별 요구/아트 품질 종합 평가는 7단계다.
