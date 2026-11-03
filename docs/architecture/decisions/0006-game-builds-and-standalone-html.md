# 0006 · 게임 제작 원본 보존과 단일 HTML 배포

- 날짜: 2026-11-01
- 상태: 채택 — 0단계 기술 검증·1단계 원본 저장·2단계 지침/제작 기준·3단계 독립 준비 서비스/도구·4단계 실제 source/build 및 반영 연결 완료. 수정·입출력·전체 통합은 5~7단계다.
- 근거: 사용자가 확정한 1차 범위, [구현 계약](../game-builds.md), [0단계 검증](../../audits/2026-11-01-game-build-stage0.md)

## 문제와 현재 구현

현재 제작은 Markdown 정리와 HTML 구현의 1~2회 CLI 실행에 맞춰져 있다. workflow v1은 두 단계와 Markdown/HTML 출력만 인정한다. 새 라이브러리 준비와 수정용 원본 파일을 그 형식에 임의로 넣을 수 없다. 공급자별 도구도 다르다. 특히 Grok은 보호된 입력 사본과 파일 쓰기만 제공받는다.

사용자는 모든 현재 AI 공급자의 라이브러리 활용, 편집 가능한 시스템 문서, 수정용 원본 보관, 독립 HTML 입출력을 선택했다. 따라서 라이브러리 금지 문구 삭제만으로 완료할 수 없다. 저장·복구·공동 결과의 확정 경계도 함께 보존해야 한다.

## 결정

1. **제작 원본과 배포 결과를 분리한다.** 프로젝트의 정식 데이터에 버전별 소스·에셋 참조·의존성 lock·제작 manifest를 보관한다. 내보내기는 기본적으로 독립 HTML 하나다. 외부 HTML만 가져온 결과는 소스가 없는 기존 경로로 수정한다.
2. **사용자 시스템 문서를 제작 기준으로 사용한다.** 문서는 docs 바로 아래에 기존 구성·ID를 유지해 생성/갱신한다. 비주얼 의도·사용자 요구·AI 제안·미정 사항을 구분한다. 기계용 manifest는 실제 제작 사실을 담는다. 문서 수정만으로 AI를 실행하지 않는다.
3. **AI는 선택하고 앱은 공통 제작 기능을 제공한다.** 조사 요청 → 앱의 공개 패키지/공식 자료 조회 → 확정 버전과 사용 자료 전달 → AI 소스 작성 → 앱 빌드 순서로 연결한다. 파일 기반 단계 교환을 사용하므로 공급자마다 셸/MCP를 열 필요가 없다. 패키지 이름 allowlist는 두지 않는다. 실제 실행·배포 조건을 만족하지 못하면 이유를 보고한다.
4. **초기 도구는 격리된 Node/npm + Rolldown이다.** Windows x64용 버전·실행 파일·네이티브 binding·라이선스를 고정한 도구 묶음을 앱의 별도 resource로 제공한다. 사용자 전역 Node/npm과 앱 자체 node_modules를 수정하지 않는다. 0단계에서는 기존 package의 Node와 복사한 도구로 실행 가능성을 검증했고, 3단계에서 제품 resource 조립과 파일별 hash manifest를 구현했다. OS 보안 sandbox를 제공한다는 의미는 아니다.
5. **의존성은 정확한 버전과 transitive lock/integrity로 관리한다.** 설치 lifecycle script는 기본 실행하지 않는다. 임의 npm script·빌드 plugin을 자동 실행하지 않는다. 초기 acquisition은 공개 npm registry adapter로 시작하고 다른 배포 방식이 필요하면 미지원 원인으로 표시한다. 패키지 출처/형식 지원 범위는 이름 allowlist와 다르다. 기존 게임은 lock을 유지하고 필요한 변경을 기록한다.
6. **workflow v2와 별도 build capability를 도입한다.** 정해진 제작 단계만 추가하며 범용 사용자 정의 workflow 엔진을 만들지 않는다. v1은 기존 검증을 그대로 통과해야 한다. 새 서버가 지원을 광고하기 전 클라이언트는 v2를 생성·예약·실행하지 않는다. 저장된 build 데이터를 이해하지 못하는 클라이언트의 변경도 서버에서 거절한다.
7. **기존 반영 경로를 재사용한다.** 소스/manifest까지 포함한 정확한 산출물 목록, 원본 baseline, session, lease를 검증한 뒤 문서·소스·HTML을 반영한다. 실패 중간 결과는 게시하지 않는다. 새 전용 저장/서버/히스토리 경로로 우회하지 않는다. 서버 durable commit 뒤 mirror 실패를 전체 rollback으로 표현하지 않는다.
8. **캐시와 보존 데이터를 구분한다.** node_modules·설치 tarball·일회용 build workspace는 로컬 cache다. 소스와 lock은 공동 snapshot·복사·히스토리·복원 대상이다. lock만으로 미래 재다운로드를 보장하지 않으며, 이력에 고정된 최종 HTML은 재다운로드 없이 실행되어야 한다.
9. **기술 한도와 서비스 quota를 분리한다.** 로컬은 서비스 구매 용량과 독립이다. 자체 서버의 총 저장 정책과 한 요청/파일의 기술 한도를 구분한다. 운영 서비스의 결제·사용자별 용량·합산은 구현하지 않는다. 설정 가능한 한도를 검사 입력으로 받아 확장 경계를 보존한다.
10. **실행 정책을 일괄 완화하지 않는다.** 0단계에서 Pixi의 CSP 대응 진입점으로 현재 player CSP를 유지한 실행이 확인됐다. blob worker·WASM은 player에서 실패했고 WebGPU는 opaque iframe에서 제공되지 않았다. 초기 공통 실행 profile은 해당 기능이 필요한 결과를 성공으로 처리하지 않는다. 검증된 대체 진입점/표현을 선택하거나 지원 불가를 보고한다.

## 기술 검증에서 확정한 수정과 현재 조치

- 0단계 당시 validateHtml의 큰 data URL navigation은 약 2.85MB 이미지 내장 사례와 7.9MB 문서에서 ERR_INVALID_URL로 실패했다. 4단계에서 작은 shell + renderer IPC/srcdoc으로 교체하고 7.5MB 전달을 검증했다. 0단계의 16MB synthetic 전달과 구분하며 제품 HTML 한도는 8MB를 유지한다.
- 검사·미리보기·온라인 player의 origin/CSP가 다르다. 일반 브라우저에서 실행된 사실만으로 공통 profile 통과라고 판단하지 않는다.
- blob URL 이미지가 현재 검사에서 실제로 실행됐다. onBeforeRequest의 접두어 필터만 보고 모든 blob 리소스가 차단된다고 가정하지 않는다.

## 검토한 대안

| 대안                                    | 판단                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| 라이브러리 금지 문구만 삭제             | 준비 도구·출력·실행 검증이 없어 요구를 충족하지 못함                                      |
| 각 CLI에 셸·설치·웹 권한 제공           | 공급자별 차이가 커지고 기존 격리 범위를 넓히므로 기본안으로 채택하지 않음                 |
| CDN을 런타임에 사용                     | 기본 독립 HTML 배포와 현재 player 정책에 맞지 않음                                        |
| Vite 전체를 게임 build runtime으로 사용 | HTML 개발 서버·plugin 계층까지 포함한다. 필요한 기능이 작아 Rolldown 직접 API를 우선 선택 |
| 최종 HTML만 저장                        | 단순하지만 사용자가 선택한 원본 보관·수정·복구 요구를 충족하지 못함                       |
| node_modules 전체 공동 저장             | 표본만 약 105MB/5천 파일이며 cache와 프로젝트 책임을 혼합함                               |
| 즉시 ZIP·외부 엔진 중심으로 전환        | 현재 합의한 단일 HTML 사용성을 바꾸므로 후속 수요에 따라 검토                             |

## 1단계에서 구체화한 결정

- 현재 HTML 위치는 `.game-builds/index.json`이 소유하고 manifest의 `pathAtCreation`은 불변 제작 사실로 둔다. 결과 이동마다 모든 과거 manifest를 재작성하는 대안은 revision 불변성과 충돌하므로 채택하지 않았다. 복사는 새 artifact/build ID와 asset 파일 연결을 발급한다.
- 저장 capability `gameBuildStorageVersion:1`과 후속 생성 capability `gameBuildVersion:1`을 분리했다. 저장만 구현된 서버를 생성 v2 지원으로 잘못 광고하지 않는다. index의 version은 프로젝트 저장 marker이며 state에 실제 파일 버전도 제공한다.
- 대형 data URL 결함이 남아 있으므로 HTML은 기존 8MB를 유지한다. source 묶음·snapshot/HTTP는 계약의 별도 한도를 구현하고 최대 4개 POST·96MB body 예약으로 동시 처리를 제한했다. 응답 완료/업무 종료까지 예약을 보유한다. RSS 전체 상한이나 대규모 운영 부하 인증은 아니다.
- 자체 서버 정책의 현재 범위는 선택적 프로젝트 snapshot 바이트 한도다. 디스크 전체/히스토리·결제 quota와 구분하며 로컬에 서비스 정책을 적용하지 않는다. 기본은 별도 quota 없음이다.

## 영향·이행 예외

4단계는 coordinator와 기존 반영 서비스를 유지하고 구현 단계에만 선택적 실행 port를 연결했다. AI가 직접 보존 namespace나 완성 HTML을 함께 쓰는 대안은 출력 권한을 섞으므로 채택하지 않았다. 비공개 source 계획을 검증하고 앱이 revision·HTML을 만든다. 생성 capability/작업 버전을 기존 저장 버전과 분리하며, 서버의 요청 변환기에서도 값을 유지하고 승인/claim/완료 전에 검사한다.

고정 Rolldown은 JS graph를 번들하고 앱 plugin이 CSS/이미지를 내장한다. 현재 Rolldown의 CSS bundle 미지원에 맞춰 별도 dev server·사용자 plugin 실행 없이 처리했다. 같은 이미지의 data URI를 반복하는 대안 대신 catalog/속성/CSS 변수를 사용해 한 번만 저장한다. inline module script는 DOM 분석 뒤의 원래 실행 시점을 유지한다. 부족한 API 자료·고지·호환성은 오류로 남기며 자동 설치나 다른 엔진 대체로 통과시키지 않는다.

보존 manifest의 선택적 `htmlTemplate`은 entry/파일 목록/asset 연결과 함께 source recipe를 식별한다. 초기 저장 전용 revision에는 이 필드가 없어도 된다. 저장 version 1의 추가 metadata를 보존하며 자동 migration은 요구하지 않는다. 새 revision과 현재 index/HTML은 기존 큐·히스토리·서버 durable commit으로 함께 반영한다. shared cache/탐색기용 사본은 기존 수명을 유지한다.

대형 HTML의 navigation URL 전달은 작은 shell과 renderer IPC/srcdoc으로 교체했다. 리소스 준비·오류와 기존 예외/ResizeObserver 분류·timeout을 유지한다. 7.5MB 전달과 실제 Chrome/Edge의 단일 파일 실행을 검증했으며 최종 HTML 한도는 8MB를 유지한다. 관련한 현재 계약은 [제작 실행](../game-build-execution.md)을 따른다.

3단계는 [공통 준비 서비스](../dependency-preparation.md)를 독립 구현하고 도구를 실제 package resource에 포함한다. 공급자에게 npm/셸 권한을 추가하는 대안 대신 기존 파일 도구를 재사용한다. npm install을 실행하는 대신 동봉 npm의 semver/tar로 공개 registry 배포본과 의존성 graph를 처리한다. 따라서 전체 npm 설치 의미론을 지원한다고 주장하지 않는다. 설치 hook·bundled/git/file/alias 의존성은 거절하고 선택 의존성은 제외/경고하며 공통 peer 충돌은 실패한다. 배포본의 고지 원문이 없는 패키지도 현재 지원하지 않는다. 라이선스 자료의 별도 확보 경로는 필요할 때 provenance·오프라인 재사용 정책과 함께 확장한다.

캐시의 추출 node_modules를 재사용하는 대안은 로컬 변경이 다음 빌드에 섞일 수 있어 채택하지 않았다. 검증한 archive만 재사용하고 실행별 새 폴더에 추출한다. 기존 lock과 업그레이드 허용 목록은 앱이 소유해 AI가 생략하거나 임의 변경하지 못하게 한다. 사용자 인증/설정과 준비 worker 환경도 분리한다. 4단계에서 새 v2 요청에 최종 source bundle·HTML 검사·기존 반영을 연결했다. 과거 v1 coordinator 동작은 유지한다.

2단계에서는 전체 지시를 편집하는 기존 UX를 유지하고, 기본판 출처와 실제 적용 내용/해시를 별도 저장했다. 사용자 편집에 새 기본판을 자동 병합하는 대안은 요구 변경 가능성이 있어 채택하지 않았다. 새 요청에서 정확히 확인되는 기본판만 갱신하고 구분 불가/편집/초안·기존 요청은 보존한다. 문서 요약만 다음 단계로 넘기는 기존 방식은 세부 요구를 잃을 수 있어 원본과 단계별 지시도 함께 전달한다. 문서/결과 이동은 실행 경로만 바꾸고 지시·해시는 보존한다. 자세한 현재 정책은 [요청 지침](../task-instructions.md)을 따른다.

- 준비 서비스·도구와 source/build 및 기존 반영 연결까지 구현했다. source 기반 수정/복원은 5단계, HTML 입출력·상태 UI는 6단계에서 연결했다. 실제 AI 계정·장르별 품질 종합 검증은 **승인된 후속 목표**다. 저장 경로·한도·복구와 공통 지침/원본 요구/기준 문서를 구현했으며 AI workflow v1의 실행·반영 경계는 유지한다.
- 기존 직접 HTML 생성과 과거 workflow v1을 유지한다. v2를 지원하지 않는 서버로 자동 downgrade해 원본을 버리거나 일부 산출물만 보내지 않는다.
- 초기 공통 profile이 지원하지 않는 runtime 기능, 설치 hook 필수 패키지, 다른 acquisition 방식은 구체적 미지원으로 보고한다. 영구적인 이름 제한이 아니다.
- 원본 저장 구현은 contracts/core/adapters와 기존 조립·업무 경계를 사용하며 architecture 예외를 추가하지 않았다.

## 검증·재검토 조건

2026-11-03 배포 통합에서 원격의 문서 파일명 ADR 0005를 보존하기 위해 이 결정을 0006으로 정리했다. 이름 변경은 mutable build index와 현재 이름 registry를 연결하고 immutable source/manifest는 유지한다. 과거 문서 baseline은 ID를 통해 현재 경로를 찾으며 실제 입력의 hash와 별도 currentPath를 전달한다. 개명 전후 제작·수정·상태 검사를 추가한다.

6단계는 현재 저장된 플레이용 HTML을 바이트 그대로 외부에 저장한다. HTML에 source 묶음을 새로 삽입하거나 가져온 metadata로 기존 artifact를 자동 복원하는 대안은 배제했다. 기본 HTML 하나 전달이라는 합의와 가져온 문서의 새 identity·원본 보호를 유지하기 위해서다. 외부 파일만 받은 사용자는 HTML을 참고해 새 source를 제작하며 기존 프로젝트의 수정 recipe가 복구됐다고 표시하지 않는다. export는 별도 desktop API/application 서비스/파일 adapter로 조립하고 세션·HTML 재확인과 프로젝트 내부 경로 보호를 수행한다. 문서 상태 비교에는 전체 입력 hash 외의 선택적 의미 비교 hash를 추가한다. 예전 revision과 복사 remap 뒤에는 비교 정보 부족을 unknown으로 표현하고 과거 원본을 재작성하지 않는다. 실제 Windows 잠금 때문에 atomic rename을 제한적으로 재시도하되 매번 대상 baseline·세션을 재확인하고 삭제 fallback은 사용하지 않는다. 현재 계약은 [HTML 입출력](../game-build-transfer.md), 검증 결과는 [6단계 보고서](../../audits/2026-11-03-game-build-stage6.md)를 따른다.

5단계에서는 기존 source recipe를 비공개 수정용 사본으로 전달한다. HTML만 다시 해석하는 대안은 구조·에셋 별칭을 잃으므로 완전한 recipe가 있는 결과에는 사용하지 않는다. 문서 입력의 전면 쓰기 허용 대신 path/ID를 선언한 `document_updates`만 갱신하며 원본 아이디어를 보호한다. 기존 exact graph는 준비·source·서버 확정에서 유지한다. 관련 HTML의 index 연결만 scoped baseline에 포함해 다른 게임을 잠그지 않고 기준 revision 교체를 검출한다. 이 해석의 지원판은 별도 `gameBuildEditingVersion:1`로 협상한다. 히스토리의 과거 index 전체를 덮어쓰는 대신 실제 바뀐 artifact만 복원하여 이후 다른 게임을 보존한다. 현재 정책·제약은 [게임 원본 수정](../game-build-editing.md)에 기록한다.

0단계는 합성 fixture·실제 패키지 확보·offline lock 재설치·Electron/Chrome/Edge 실행을 검증한다. 실제 AI 생성·전체 앱 package 통합·복수 PC 협업·일반 GPU 성능 검증은 아니다. 1~7단계의 완료 기준은 [1차 계획](../../plans/2026-11-01-game-build-phase1.md)을 따른다.

원본 복구가 깨지거나 실행 정책을 바꿔야 하는 라이브러리 수요가 생긴 경우, Node/native tool 버전 변경, 한도 증가, 큰 프로젝트 전송 병목이 확인되면 이 결정을 재검토한다. 기존 아키텍처 검사를 완화해서 해결하지 않는다.
