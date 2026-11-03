# 게임 제작 개선 3단계 완료 보고

2026-11-02. 범위는 **라이브러리 공통 준비 서비스·네 공급자의 파일 교환·독립 실행 도구의 패키지 포함**이다. 실제 게임의 소스 작성·번들·HTML 검사·기존 저장 경로에 연결하는 작업은 4단계다. 현재 UI/AI coordinator는 준비 서비스를 자동 호출하지 않으며 workflow v1을 유지한다.

## 변경 동작

| 영역      | 구현 결과                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공통 준비 | AI 요청을 받아 공개 npm의 후보 조사·버전 선택·필수 간접 의존성·exact lock을 처리한다. 라이브러리 이름 allowlist는 없다.                                     |
| 네 공급자 | Codex/Claude/Gemini/Grok 모두 기존 executor와 예약 JSON 파일로 교환한다. 공급자에게 새 npm/네트워크 도구를 요구하지 않는다.                                 |
| 자료 전달 | 검증한 배포본의 README·타입 선언 진입점 발췌와 참고 링크를 전달한다. 선택 이유·정확한 버전·원본/전달 본문 hash·잘림 여부를 기록한다.                        |
| 고지      | 모든 lock package의 라이선스와 고지 원문을 모은다. 원문 누락·이름/버전/무결성 불일치는 실패로 반환한다.                                                     |
| 기존 게임 | 앱이 소유한 기존 lock 사본을 주입한다. AI의 임의 변경·승인 없는 업그레이드를 거절한다. 동일 root/업그레이드 없음은 graph 전체를 그대로 재사용한다.          |
| 캐시      | 매번 SHA-512를 검사한 archive만 재사용한다. 추출 node_modules는 실행별 새 폴더에 만들고 종료 후 정리한다. 프로젝트 원본/히스토리를 cache로 취급하지 않는다. |
| 실행 경계 | 최대 3회/180초, worker 동시 2개, 다운로드·항목·압축 해제·응답 크기 한도를 둔다. 취소·오래된 세션·다른 실행의 교환·허용 밖 출력은 결과를 확정하지 않는다.    |
| 독립 도구 | Windows x64 Node 24.19.0/npm 11.17.0/Rolldown·binding 1.2.12를 `game-build-runtime` resource로 포함한다. 전체 파일 목록·크기·hash·라이선스를 검증한다.      |

계약/core/application/adapter/desktop의 책임은 [의존성 준비 설계](../architecture/dependency-preparation.md)에 기록했다. 기존 stage materialization·공급자 parser·Gemini 설정을 재사용했다. 새 저장·서버 반영 경로나 architecture 예외를 추가하지 않았다. 앱 의존성/루트 lock·공개 버전은 변경하지 않았다.

준비 worker는 npm install·패키지 코드·설치 lifecycle·사용자 build plugin을 실행하지 않는다. 동봉 npm의 semver/tar와 자체 worker만 사용한다. 사용자 설정/인증/환경을 복사하는 대신 필요한 Windows 변수와 별도 HOME/TEMP·도구 PATH를 구성한다. [npm의 설치 동작](https://docs.npmjs.com/cli/v11/commands/npm-install/)과 [npm 설정](https://docs.npmjs.com/cli/v11/using-npm/config/)을 참고했으나 전체 npm 설치 의미론을 구현했다는 뜻은 아니다.

## 수행한 검증

| 항목               | 실제 결과                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 자동 검사     | `npm test`: **1,092 통과, 실패 0, 기존 공식 Grok CLI 조건부 검사 1개 생략**(총 1,093). architecture 검사 포함.                                                                                                                                                            |
| 새 기본 회귀 5개   | 요청 출처/필드 제한·네 공급자 공통 교환·3회 한도/취소/세션/완료 hash·입력 보호/추가 산출물/비정상 Grok 종료·앱 소유 lock/업그레이드 허용을 검사했다.                                                                                                                      |
| 타입·형식          | typecheck, typecheck:contracts, typecheck:core, lint 통과. 기존 discord mock no-this-alias 경고는 유지한다.                                                                                                                                                               |
| 실제 worker 7개    | localhost registry와 동봉 Node/npm으로 압축·SRI·간접 graph·고지·API 자료·offline exact replay·손상 cache·명시적 업그레이드·git/설치 hook/링크/누락 고지/peer 충돌·실행 중 취소·늦은 세션·중첩 모듈의 실제 Node 해석·UTF-8 발췌·네 공급자 파일 교환을 확인했다. 모두 통과. |
| Windows package    | `npm run package` 성공 후 **같은 결과물의 resource**를 지정해 위 실제 worker 7개를 다시 검사했다. 모두 통과. 테스트 driver는 저장소 코드를 사용하고 worker/Node/npm은 실제 package 자원을 사용한다. Electron UI에서 신규 생성 흐름을 실행한 검사는 아니다.                |
| 도구 변조 검사 1개 | 패키지 도구의 별도 임시 사본에서 미등록 파일·worker 내용 변경을 검출했다. 추가 검사 1개 통과. 원래 package는 변경하지 않았다.                                                                                                                                             |
| 실제 공개 npm      | Three.js 0.187.0와 Matter.js 0.20.0의 실제 확보·고지 수집·exact lock 재사용 성공. Pixi.js 8.22.0는 아래 고지 누락을 정확히 실패로 반환했다.                                                                                                                               |

실제 worker 7개와 변조 검사 1개는 별도 명령으로 실행했다. 기본 CI 검사에 외부 registry·도구 package 의존을 넣지 않았다. 네 공급자는 파일 쓰기/종료 이벤트를 재현한 mock executor이며 **실제 계정·유료 AI 호출 검증은 아니다.** 오프라인 검사는 localhost registry 응답을 제거한 뒤 네트워크 요청 수가 증가하지 않고 lock hash가 유지되는지 확인했다.

로컬 도구와 package resource의 manifest digest는 일치했다. 정확한 버전과 공개 패키지 자료 출처/hash는 [측정 JSON](2026-11-02-game-build-stage3-evidence.json)에 보관했다. 도구 파일은 1,992개·127,530,734바이트(약 121.6MiB, manifest 제외)다. 압축 배포 크기나 npm package 전체의 신뢰 인증으로 해석하지 않는다.

## 공개 패키지에서 발견한 제약

| 표본               | 결과                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `three@0.187.0`    | package 1개·고지 1개·README 2,969바이트 전달. exact lock 재사용 hash 일치.                                                                 |
| `matter-js@0.20.0` | package 1개·고지 1개·README 9,023바이트 전달. exact lock 재사용 hash 일치.                                                                 |
| `pixi.js@8.22.0`   | 간접 의존성 `@pixi/colord@2.9.6` 배포본에 LICENSE/COPYING/NOTICE 원문이 없어 `LICENSE` 오류로 준비 중단. 성공 lock/HTML을 게시하지 않았다. |

Pixi.js의 라이선스가 사용 불가하다고 판정한 것이 아니다. 현재 adapter가 고지 원문을 배포본 내부에서 확보하는 방식이어서 발생한 지원 제약이다. **Pixi.js 준비 성공이나 최종 게임 실행 성공으로 보고하지 않는다.** 0단계의 Pixi bundle/실행 표본과 달리 이번 준비기는 모든 간접 의존성의 고지를 필수 검사한다. 공식 저장소의 해당 버전/commit에서 누락 원문을 확보하는 일반 경로를 추가하려면 출처 고정·hash·캐시·오프라인 재사용을 함께 보강해야 한다. 이름별 예외나 고지 생략으로 통과시키지 않았다.

## 남은 범위와 후속 연결

- 4단계: 기존 coordinator가 준비 서비스를 호출하도록 연결하고 source/asset 계약·실제 bundle·독립 HTML·실행 검사·기존 확정 경로를 구현한다. 준비 DTO나 toolset 존재만으로 제작 기능 지원을 광고하지 않는다.
- 기존 HTML 8MB 한도와 알려진 대형 data URL 검사 결함은 유지한다. 새 HTML 검사 경로는 4단계 대상이다.
- 공개 npm만 지원한다. 설치 hook 필수 패키지·bundled/git/file/alias·선택 의존성·공통 peer 충돌의 초기 처리 범위는 설계 문서를 따른다. OS/arch 검사와 API 자료 확보는 브라우저 profile 통과를 의미하지 않는다.
- README/타입 선언 진입점 발췌만 전달한다. 타입 재수출의 모든 하위 API·외부 공식 문서·라이선스 누락 자료의 별도 확보는 현재 지원하지 않는다. 다음 제작 단계가 자료 부족/호환성을 성공으로 오인하지 않아야 한다.
- 기존 root 구성 변경·source 기반 수정/버전/복원과 cache 보관 운영은 후속 범위다. 캐시가 없거나 registry에서 삭제된 패키지의 영구 재준비는 보장하지 않는다.
- 최종 브라우저 플레이·비주얼 품질·실제 네 계정·다중 PC·운영 부하는 7단계 통합 검증에서 별도로 확인한다. 공개 배포는 수행하지 않았다.

주요 로컬 로그는 ignored `out/game-build-stage3-tests.log`, `out/game-build-stage3-{package,runtime,packaged-runtime,packaged-integrity,public}.log`다. 전체 계획은 [1차 계획](../plans/2026-11-01-game-build-phase1.md), 현재 준비 계약은 [설계](../architecture/dependency-preparation.md)를 따른다.
