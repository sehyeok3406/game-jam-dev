# 게임 제작 개선 0단계 기술 검증

2026-11-01 · 기준 production source `03d938c` · Windows x64.

## 결과

**독립 HTML을 유지하면서 라이브러리·선택 이미지를 포함하고 원본을 별도로 보관하는 방향은 실행 가능하다.** Node/npm + Rolldown의 별도 제작 도구를 채택했다. 실제 앱 기능은 아직 변경하지 않았다.

- 합성 fixture 11개, Electron 관찰 33개, Chrome/Edge 외부 실행 18개를 검사한다.
- 지원 대상으로 정한 사례의 실패는 0개다. 큰 data URL, 기본 Pixi CSP, worker, WASM의 정책 차이는 별도 한계 사례로 기록한다.
- 실제 계정·유료 AI·운영 서버·사용자 프로젝트는 사용하지 않았다. 기본 지침, 한도 상수, runtime API, 서버 capability, package.json/lock은 변경하지 않았다.
- 원시 측정은 `out/game-build-stage0/verification.json`, 추적 가능한 요약은 [evidence JSON](2026-11-01-game-build-stage0-evidence.json)이다. 실행 버전·소스 hash·산출물 hash·package integrity·cache fingerprint가 포함된다.

## 방법과 재실행

```powershell
node tools/game-build-stage0/run.mjs
node tools/game-build-stage0/summarize.mjs
```

설치된 workspace Node/npm과 root lock에 있는 Rolldown을 사용한다. 공개 npm에서 고정 버전의 PixiJS 8.22.0과 Three.js 0.187.0을 별도 `out/game-build-stage0/workspace`에 준비한다. repo dependency를 변경하지 않는다. 해당 두 패키지는 사례이며 제품 allowlist가 아니다.

top-level archive의 registry SHA-512를 직접 확인하고 `npm install --ignore-scripts`로 lock을 만든다. cache 재사용 시 Node/OS/arch·lock·설치 파일 전체 hash를 비교한다. 별도 workspace에서 `npm ci --offline --ignore-scripts`로 같은 파일 tree를 재구성한다. 고지 원문은 `third-party-notices.json`과 fixture HTML에 포함한다.

browser는 매번 별도 profile로 headless 실행하고 기존 사용자 tab/profile에 연결하지 않는다. 최종 HTML은 repo 밖 임시 디렉터리로 복사한 뒤 `file:`로 열고 CDP network offline 상태에서 HTTP 요청·image decode·render proof·키 입력을 검사한다. 외부 복사본과 screenshot은 재확인을 위해 남긴다. 실행이 끝난 spike 소유 process만 종료한다.

## 실행 환경과 도구 결정

| 항목              | 확인 내용                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Node / npm        | 24.19.0 / 11.17.0                                                                             |
| Rolldown          | 1.2.12, browser IIFE, code splitting off, minify, legal comments                              |
| Electron          | 44.5.1                                                                                        |
| Chrome            | 156.0.8078.76                                                                                 |
| Edge              | 156.0.4314.58                                                                                 |
| 설치 의존성       | 약 105MB, 5,191개 파일. 원본/cache/최종 HTML을 분리할 이유                                    |
| 별도 제작 runtime | 기존 package Node + 복사한 npm/Rolldown/native binding. PATH를 비워 offline ci와 rebuild 성공 |

별도 runtime은 repo 밖 임시 위치에서 실행했다. source dependency는 replay workspace에 준비된 파일을 사용했다. 원래 빌드와 JS SHA-256이 일치했다. 이것은 **제작 도구 조립의 실험**이며 기존 Game Jam! package에 build 기능이 탑재됐다는 검증은 아니다.

[Rolldown API](https://rolldown.rs/guide/getting-started)로 직접 bundle했다. 전체 Vite dev server/plugin 구성을 넣지 않았다. [npm install 설정](https://docs.npmjs.com/cli/v11/commands/npm-install/)에 맞춰 install lifecycle script를 비활성화했다. Node/native runtime은 단계3~4에서 별도 version/hash/license manifest로 정식 패키징해야 한다.

## 정상 사례

| 사례                           | standalone HTML 대략 크기 | 확인                                                        |
| ------------------------------ | ------------------------- | ----------------------------------------------------------- |
| Canvas 2D + 합성 선택 PNG      | 17KB                      | 기존 validator, preview/player 정책, 외부 브라우저, 키 입력 |
| PixiJS WebGL + PNG             | 555KB                     | CSP 대응 진입점 포함. pixel proof·키 입력                   |
| Three.js WebGL + PNG texture   | 545KB                     | 실제 texture decode·3D canvas pixel proof·키 입력           |
| Pixi + 앱 multiplayer adapter  | 555KB                     | 정적 계약·production multiplayer 초기 상태 검사·player CSP  |
| 정적으로 확정한 dynamic import | 16KB                      | 단일 chunk로 inlining, executable import 0                  |
| blob URL image                 | 17KB                      | 이 이미지 사례는 실제 validator/preview/player에서 통과     |
| 기존 COOP_REFERENCE_HTML       | 2.5KB                     | 원본 그대로 validator와 SDK/policy harness에서 통과         |

포함된 제3자 고지 때문에 작은 fixture에도 약 15KB의 공통 notices가 있다. 이는 실제 bundle 사용 여부를 정밀 추적한 고지가 아니라 test dependency tree의 고지를 보존한 것이다. product builder는 실제 포함된 dependency provenance를 관리해야 한다.

Pixi/Three의 frame에서 여러 색 pixel을 읽었고, Chrome·Edge 각각 세 interactive fixture에서 ArrowRight 처리 1회를 확인했다. screenshot은 `out/game-build-stage0/{chrome,edge}-{canvas-image,pixi-image,three-image}.png`다. 이 결과는 초기 렌더링·입력 확인이며 게임의 전체 진행/품질 평가가 아니다.

## 한계 사례와 후속 필수 변경

| 사례               | 관찰                                                                                                           | 결정                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 큰 image 내장 HTML | 약 2.85MB인데 production data URL navigation이 ERR_INVALID_URL로 실패. 같은 HTML은 srcdoc·Chrome·Edge에서 실행 | 한도 증가 전 validator 전송 방식 변경             |
| Pixi 기본 진입점   | 일반 preview/외부 실행은 성공, player CSP에서 unsafe-eval 관련 오류                                            | 같은 버전의 CSP 대응 module을 준비 정보로 전달    |
| blob worker        | 외부 브라우저/preview는 실행, player CSP에서는 차단                                                            | 공통 profile 통과로 표시하지 않음                 |
| inline WASM        | 외부 브라우저/preview는 실행, player CSP에서는 compilation 차단                                                | 기능 요구를 profile과 비교해 명시적 미지원 처리   |
| WebGPU             | file origin에서는 navigator.gpu 존재, opaque srcdoc에서는 부재                                                 | WebGPU 지원으로 광고하지 않음. 실제 render 미검증 |

Pixi 8.22.0의 `pixi.js/unsafe-eval` source는 eval code generation 대신 polyfill을 설치한다. 이름만 보고 unsafe-eval 권한을 여는 모듈로 해석하면 안 된다. 해당 진입점을 포함하자 현재 player CSP를 바꾸지 않고 실행됐다. [해당 패키지 source](https://github.com/pixijs/pixijs/tree/v8.22.0/src/unsafe-eval), [Pixi Application 설명](https://pixijs.com/8.x/guides/components/application).

초기 co-op 합성 fixture는 neutral 상태에서도 tick을 계속 바꾸어 현재 검사 harness의 비동기 snapshot 비교에 영향을 줬다. fixture를 기존 참조와 같이 neutral 입력에서 상태가 고정되는 형태로 바꾸었으며 production validator는 수정하지 않았다. 이 검증은 online room 통신/장시간 simulation을 보장하지 않는다.

`onBeforeRequest`가 data/about만 허용한다고 해서 blob 이미지가 반드시 차단된다고 추정했던 이전 분석은 이 실험으로 정정한다. resource scheme·CSP·origin·실제 로딩 결과를 함께 봐야 한다.

## 한도·메모리 관찰

| HTML 크기        | 현재 import/shared 검사 | 현재 data URL load | 작은 shell + srcdoc 실험 |
| ---------------- | ----------------------- | ------------------ | ------------------------ |
| 7,900,000 bytes  | 통과                    | 실패               | 통과                     |
| 8,100,000 bytes  | 8MB 초과 거절           | 실패               | 통과                     |
| 16,000,000 bytes | 8MB 초과 거절           | 실패               | 통과                     |

16MB 사례는 대형 주석을 포함한 synthetic 문서다. 로딩은 약 0.5초, 해당 renderer의 peak working set은 약 270MB 수준이었다. image/복잡한 JS와 같은 비용이라고 일반화할 수 없다.

별도 Node에서 JSON stringify/parse를 16/32/64MB로 확인했다. 모든 roundtrip이 맞았고 64MB의 process RSS는 약 0.5GB였다. 여러 요청의 동시 수신·SQLite commit·실제 디스크/네트워크 부하 검증은 아니다. 새로운 한도는 [구현 계약](../architecture/game-builds.md)의 초기 목표값을 stage1에서 end-to-end 검증한 후 적용한다. 현재 상수는 그대로다.

## 확정한 계약과 다음 단계

- 원본은 `.game-builds/<buildId>` 논리 namespace와 v2 `.gamejam/project/builds/<buildId>` 물리 위치에 연결한다.
- `workflow v2`, `gameBuildVersion: 1`, `gameBuildStorageVersion: 1`을 분리한다. 기존 v1 경로는 보존하고 새 형식을 지원하지 않는 서버에는 v2 실행을 명시적으로 거절한다.
- source/lock/manifest/문서/HTML은 정식 프로젝트 데이터, node_modules/tarball/temp는 로컬 cache로 분리한다.
- 새 지침·문서 갱신·정확한 output·session/lease·기존 저장/복구 경계를 [계약](../architecture/game-builds.md)에 확정했다.
- 다음 진행 단위는 stage1의 DTO·snapshot·공동 검증·copy/history/recovery 구현이다. 이번에 시작하지 않았다.

## 실행한 검사

- 최종 `node tools/game-build-stage0/run.mjs`: exit 0. Electron 33개 관찰 중 29개 성공·4개 한계 재현, 지원 대상 실패 0개. Chrome/Edge 외부 실행 18개 성공, SDK 전제 4개는 외부 실행 대상에서 제외했다.
- `node tools/game-build-stage0/summarize.mjs`: 측정 요약 생성. 측정 시작 시 입력 13개와 산출물 11개의 SHA-256, 원시 보고서 hash, offline tree/rebuild, 상대 문서 링크 14개를 별도 검증했다.
- `npm run test:architecture`: 10개 통과. production source 경계·예외 목록 변경 없음.
- `npm run lint`: 통과. 기존 `tests/mocks/discord-transport.ts`의 no-this-alias 경고 1개는 남아 있으며 이번 변경에서 새 경고를 추가하지 않았다.
- `git diff --check`: 통과. `.ts`/production/package dependency 변경이 없어 typecheck·전체 test·앱 재패키징은 반복하지 않았다. runtime 실험의 기존 gray-matter eval 경고와 module type 경고는 기능 확장이나 정책 완화로 숨기지 않았다.

## 검증 범위의 한계

- CLI 계정 인증/실제 모델 생성/과금 호출 없음.
- full packaged app 기능 통합, 복수 PC, 실제 온라인 room 통신 검증 아님.
- Electron preview/player는 production sandbox/CSP/SDK source를 재사용한 별도 관찰 harness다. test-only offline request guard를 추가했으며, player는 실제 online shell 대신 solo SDK로 renderer 정책을 확인했다.
- 브라우저는 headless이며 다양한 GPU·저사양·모바일 성능을 인증하지 않는다. GPU 장치 정보가 있어도 특정 하드웨어 가속 경로를 보장하지 않는다.
- native toolset의 최종 앱 resource 포함·업데이트·무결성 검사는 단계3~4에 남는다.
- 새 production feature, 프롬프트, API, 저장 migration, 요금제/무제한 입력을 구현하지 않았다.
