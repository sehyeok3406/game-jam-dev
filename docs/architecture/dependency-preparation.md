# 게임 라이브러리 공통 준비

2026-11-02. 3단계에서 구현한 준비 서비스의 현재 경계다. 전체 제작·저장 계약은 [game-builds](game-builds.md), 결정 근거는 [ADR 0006](decisions/0006-game-builds-and-standalone-html.md)를 따른다.

## 현재 제공하는 동작

AI가 라이브러리 후보와 선택 이유를 파일로 요청하면 앱이 공개 npm 정보를 조회하고 정확한 버전·간접 의존성·무결성을 확정한다. 검증한 배포본에서 라이선스 고지와 README·타입 선언 자료를 읽어 다음 AI 호출의 입력 파일에 넣는다. 이름별 허용 목록은 없다.

현재 진입점은 desktop의 `createGameDependencyPreparation`이다. `run(signal)`은 확정 자료 또는 라이브러리 불필요 결과를 반환하고, `workspace()`는 이후 앱 빌드에 사용할 비공개 추출 폴더를 제공하며, 호출자는 사용 후 `close()`로 정리한다. 준비 실패 시 factory는 작업 폴더를 정리한다. 프로젝트 저장·히스토리·서버 반영은 수행하지 않는다.

**4단계에서 실제 제작 흐름에 연결했다.** 새 gamejam HTML 요청은 [source 작성·bundle·HTML 검사·기존 반영](game-build-execution.md)을 사용하고 `gameBuildVersion:1`/workflow v2를 별도로 지원한다. 기존 v1 명세는 기존 경로를 유지한다. 준비 성공만으로 최종 게임/브라우저 호환성을 판정하지 않는다.

## 책임 배치

| 계층        | 구현                                                       | 소유 동작                                                    |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| contracts   | `contracts/dependency-preparation.ts`                      | 요청·응답·자료 provenance·처리 한도                          |
| core        | `core/ai/dependency-preparation.ts`                        | 허용 필드·출처·경로·lock 연결·교환 실행 식별 검증            |
| application | `application/ai/dependency-preparation.ts`                 | 최대 교환·시간·취소·세션 확인·기존 lock과 업그레이드 권한    |
| adapters    | `adapters/node/game-preparation/engine.ts`, `worker.ts`    | 공개 registry HTTP·해시·압축 해제·도구 검증·프로세스·캐시    |
| desktop     | `desktop/ai/dependency-preparation.ts`                     | 기존 executor/parser 조립·공급자 공통 파일 교환·일회용 stage |
| 패키지 조립 | `scripts/build-game-build-runtime.mjs`, `forge.config.mts` | 독립 Node/npm/Rolldown 자원 구성                             |

준비 서비스는 UI·서버 저장소에 의존하지 않는다. 기존 `PreparedAiRun`, `AiExecutor`, 공급자별 `ProviderRunOutput`과 Gemini 실행 설정을 재사용한다. `assertCurrent`는 호출자가 기존 run/session/lease 확인에 연결해야 한다. 협업 서버에서 AI나 다운로드 작업을 새로 실행하지 않는다.

## 공통 파일 교환

Windows의 짧은 TEMP 경로·junction 표기 차이를 피하려고 준비 stage는 `realpath(os.tmpdir())` 아래에 생성한다. 정리 때도 같은 실제 부모·링크 여부·실제 경로 일치를 확인한다. 표기가 다르다는 이유로 정상 stage 정리가 실패하지 않도록 하며, 경로 보호 검사는 유지한다.

각 실행은 프로젝트 밖 임시 stage에 선택 입력의 사본을 만든다. `.ai/tasks/dependency-response.json`에 실행 ID·sequence·앱 응답·기존 lock을 제공하고, AI는 `.ai/tasks/dependency-request-<sequence>.json` 하나에 다음 요청을 작성한다.

1. `research`: 패키지 이름 목록. 앱은 설명·현재 latest 버전·참고 링크를 반환한다.
2. `prepare`: 이름·요청 버전 범위·선택 이유. 앱은 exact lock·고지·자료·경고를 반환한다.
3. `done`: 확인한 `lockSha256`. 라이브러리가 필요 없으면 `null`이다.

조사는 생략할 수 있다. 초기 한도는 **전체 최대 3회·180초**다. 다른 실행/sequence의 파일, 잘못된 완료 hash, 공급자의 비정상 종료, 원본 사본 변경, 선언 밖 출력이나 링크를 거절한다. Grok도 입력 파일 사본과 파일 쓰기만으로 같은 교환을 수행한다. Gemini는 기존처럼 hooks/MCP/셸/웹 도구를 제한한 설정을 사용한다. 교환 파일은 프로젝트 snapshot이나 공개 산출물에 포함하지 않는다.

README·타입 선언·registry 설명은 참고 데이터로 표시하며 AI 지시로 취급하지 않는다. 이 표시나 사후 파일 검증은 공급자 자체의 실행 격리를 대신하지 않는다. 기존 executor의 공급자별 도구 제한을 유지한다.

7단계의 실제 Codex 검사에서 준비 prompt의 일괄적인 ‘No shell’ 지시가 해당 CLI의 파일 읽기까지 막아 요청 파일이 생성되지 않는 문제를 확인했다. 현재 prompt는 선택 입력 경로를 명시하고, 이미 제공되는 로컬 파일 도구를 사용하도록 안내한다. 파일 I/O가 터미널을 통해 제공되는 CLI는 지정 입력 읽기와 요청 JSON 하나 쓰기에만 기존 도구를 사용할 수 있다. 프로젝트/패키지 코드 실행·설치·외부 요청·추가 권한은 계속 금지한다. executor 인자나 공급자별 도구 권한은 확장하지 않았다. 요청 파일이 없으면 임시 경로 ENOENT만 노출하지 않고 누락 사실과 최대 1,000자의 공급자 마지막 설명을 보고한다. 기존 원본·선언 밖 파일 검사와 임시 폴더 정리를 유지한다.

## 의존성 확정과 기존 버전

새 선택은 공개 npm metadata에서 exact 버전을 선택하고 필수 일반 의존성과 필수 peer를 해결한다. lock은 npm의 `node_modules/<name>` 배치 경로, exact version, canonical registry URL, SHA-512, 간접 연결, license를 기록한다. 동명 패키지의 다른 버전은 필요한 위치에 중첩 배치하며 가까운 패키지에 가려지는 경우를 처리한다. 공통 peer 충돌은 실패로 반환한다.

기존 lock은 **앱이 소유한 입력**이다. application이 사본을 주입하므로 AI가 필드를 생략해도 사라지지 않는다. AI가 다른 lock을 보내거나 앱이 허용하지 않은 `upgrades`를 요청하면 거절한다. 사용자가 요청한 업그레이드만 호출자가 `allowedUpgrades`에 넣는다. 현재 계약은 개별 업그레이드 승인 UI를 새로 만들지 않는다.

선택한 root 목록이 같고 업그레이드가 없으면 기존 graph 전체를 그대로 사용한다. registry metadata를 다시 조회하지 않고 캐시의 배포본을 재검증하므로 캐시가 온전하면 오프라인 준비도 가능하다. 명시한 범위가 기존 버전과 충돌하면 실패하며 `latest` 요청만으로 갱신하지 않는다. root 구성 변경에는 현재 명시적 변경 선언이 필요하다. source 기반 수정 정책의 전체 연결은 5단계다.

업그레이드한 경우 변경하지 않은 root는 기존 버전을 지정하고, 간접 의존성도 새 범위와 맞는 기존 버전을 우선 선택한다. 새 graph가 이전 graph와 무조건 같다는 보장은 아니다. 최종 exact lock과 hash가 변경 사실을 나타낸다.

## 배포본·라이선스·자료

다운로드는 공개 `https://registry.npmjs.org`로 한정하고 redirect를 따르지 않는다. 임의 URL·git·file·npm alias, bundled dependency, 설치 hook이 있는 배포본, OS/CPU 불일치 등은 원인을 붙여 거절한다. 선택 의존성과 선택 peer는 자동 설치하지 않으며 선택 의존성 누락은 경고에 남긴다. 이는 초기 adapter의 지원 범위다. 라이브러리 이름에 따른 영구 제한이 아니다.

`npm install`이나 패키지 코드를 실행하지 않는다. 동봉한 npm의 semver·tar 구현과 신뢰된 자체 worker만 사용한다. preinstall/install/postinstall hook이 있는 패키지는 현재 방식으로 지원하지 않는다. 임의 build plugin·사용자 npm 설정·인증 정보도 전달하지 않는다.

SHA-512 검증 후 압축을 해제한다. 절대 경로·상위 이동·Windows 장치 이름·중복 대소문자·symlink/hardlink·패키지 안의 node_modules·파일/총량 한도 위반을 거절한다. 배포본 package.json의 이름·버전·설치 조건을 다시 확인하고 모든 lock package의 license와 LICENSE/COPYING/NOTICE 원문을 확보한다. 고지가 없으면 성공으로 처리하지 않는다. 이 검사는 라이선스 조합의 법률 판단을 의미하지 않는다.

AI 자료는 root 패키지의 README와 `types`/`typings` 진입 선언을 대상으로 한다. 파일당 32KB, 전체 160KB 이내의 발췌다. 외부 홈페이지/저장소 링크는 참고 문자열로만 제공하고 자동 수집하지 않는다. 타입 재수출의 모든 하위 파일이나 외부 API 문서까지 확보하는 기능은 아니다. 자료가 부족하면 후속 제작 단계가 호환성을 확인해야 한다.

각 문서는 `npm:<name>@<exact>/<relative>` 출처, 전달 본문의 SHA-256, 원본 파일 SHA-256, 잘림 여부를 가진다. UTF-8 문자 중간을 자르지 않는다. 선택 이유·도구 digest·OS/arch도 응답에 남긴다. 원본 전체를 읽었다는 의미와 AI에 전달한 발췌를 구분한다.

## 캐시·도구·종료

프로젝트 밖 cache의 `archives/<integrity에서 계산한 hash>.tgz`에 배포본만 재사용한다. 매번 SRI를 확인하고 손상되었으면 다시 다운로드한다. 재다운로드도 실패하면 준비를 중단한다. 추출한 node_modules는 매 실행 새 `.work-*` 폴더에 만들고 성공 결과를 사용하는 동안만 유지한다. 캐시 삭제는 프로젝트 원본이나 보존된 최종 HTML을 지우지 않는다.

Windows x64 도구는 `resources/game-build-runtime`에 Node 24.19.0, npm 11.17.0, Rolldown과 native binding을 포함한다. 실제 버전·모든 파일의 크기/해시·라이선스는 manifest에 기록한다. 실행 전 파일 집합과 해시를 확인하고 추가 파일·링크·손상을 거절한다. 4단계의 별도 builder worker가 Rolldown으로 source를 번들한다. 준비 worker는 사용자 패키지 코드를 import하지 않는다.

Forge 개발 시작·package 생성 시 도구를 준비한다. 소스와 같은 파일은 해시를 비교해 재사용하고 오래된 미등록 파일은 정리한다. Node 라이선스는 버전·해시를 고정해 별도 확보/재사용한다. 자체 협업 서버 번들의 활성화 여부와 독립적이다.

worker는 절대 경로의 동봉 Node로 실행한다. PATH는 도구 폴더만, HOME/USERPROFILE/TEMP는 비공개 작업 폴더로 지정한다. 필요한 Windows 시스템 변수 외에 사용자 환경·NODE_OPTIONS·npm 설정·CLI 인증을 넘기지 않는다. 최대 동시 worker는 2개다. 이는 OS 보안 sandbox가 아니며 고정 worker와 비실행 패키지 처리라는 경계다.

취소·시간 초과는 worker를 종료하고 종료 뒤 임시 파일을 정리한다. async 전후 `assertCurrent`로 세션을 검사하며 늦은 결과를 반환하지 않는다. 삭제는 정규화·실제 경로·직접 부모·작업 폴더 접두어·링크를 확인한 뒤 실행한다. 정리 실패는 성공으로 숨기지 않으며 재시도 가능한 작업 폴더 목록을 유지한다.

| 처리 한도                                      | 초기값        |
| ---------------------------------------------- | ------------- |
| root / 전체 package                            | 12 / 256      |
| metadata 1회 / 배포본 1개                      | 8MB / 20MB    |
| metadata·배포본 다운로드 합계 / 압축 해제 합계 | 80MB / 256MB  |
| 압축 항목 수(디렉터리 포함) / 파일 하나        | 20,000 / 16MB |
| API 자료 / JSON 결과                           | 160KB / 2MB   |

이 한도는 준비 처리에만 적용한다. [원본 저장 한도](game-builds.md), 최종 HTML 한도, 서비스 구매 용량과 별개다. 전체 RSS 상한·운영 규모 부하·최종 브라우저 실행 가능성을 보장하지 않는다.

## 검증

5단계의 실제 수정 경로는 기존 exact lock을 그대로 제공한다. 기존 의존성이 있는데 준비 없이 `done(null)`로 끝내거나 준비 결과의 lock이 달라지면 거절한다. source 실행 port와 최종 local/server 반영도 기존 lock을 확인한다. 기존 graph를 교체·추가·삭제·업그레이드하는 사용자 계약/UI는 아직 제공하지 않는다. 새 게임 선정과 내부 allowedUpgrades port를 일반 수정의 업그레이드 지원으로 혼동하지 않는다.

기본 `npm test`에는 `tests/dependency-preparation.test.mjs`가 포함된다. 실제 worker·압축·HTTP·오프라인 재사용은 `node scripts/build-game-build-runtime.mjs` 뒤 `node --test tests/dependency-preparation-runtime.mjs`로 검사한다. 후자는 localhost registry fixture를 사용하며 유료 AI나 외부 registry에 의존하지 않는다.

Windows package를 만든 뒤 `GAMEJAM_PREPARATION_RUNTIME`을 패키지의 `resources/game-build-runtime` 절대 경로로 지정하면 같은 실제 worker 검사를 실행할 수 있다. package와 이 검사가 사용하는 도구 폴더를 동시에 다시 빌드하지 않는다. 이번 실행 증거와 미검증 경계는 [3단계 보고서](../audits/2026-11-02-game-build-stage3.md)에 기록한다.
