# Game build stage-0 spike

0단계의 별도 기술 실험이다. 앱 production에서 import하지 않으며 정식 게임 생성 기능이나 package installer가 아니다.

## 실행

Windows x64, 설치된 repo dependencies, Node/npm, Chrome/Edge, `out/Game Jam!-win32-x64/resources/self-host-runtime/node.exe`가 필요하다. 공개 npm package 다운로드를 사용한다. 실제 AI 계정이나 사용자 project는 사용하지 않는다.

```powershell
node tools/game-build-stage0/run.mjs
node tools/game-build-stage0/summarize.mjs
```

- 고정 Pixi/Three를 `out/game-build-stage0/workspace`에 설치한다. root package.json/lock과 전역 설치를 변경하지 않는다.
- archive integrity, lock, 설치 파일 tree hash를 검사한다. 검증된 cache만 재사용한다.
- Electron에서는 현재 validator와 preview/player sandbox/CSP를 관찰한다. 일부 한계 fixture의 실패는 의도된 측정이며 product 요구로 고정하지 않는다.
- Chrome/Edge는 별도 headless profile·offline 상태로 repo 밖 HTML 복사본을 실행한다. 현재 사용자 browser/profile은 사용하지 않는다.
- `toolset.mjs`는 별도 temp의 Node/npm/Rolldown으로 PATH 없이 offline 설치·재빌드가 가능한지 검사한다.
- 출력·profile·cache는 `out/game-build-stage0`, 외부 export/toolset 복사본은 `gamejam-stage0-*` temp에 남는다. 본 실험이 생성한 자료이며 삭제 시 기존 프로젝트와 `.gamejam` 전체를 대상으로 삼지 않는다.
- `summarize.mjs`는 마지막 원시 결과를 docs의 추적 가능한 evidence JSON으로 정리한다. 실패한 실행 뒤 오래된 결과를 요약하지 말고 최종 run의 exit code·finishedAt을 먼저 확인한다.

정확한 범위·결정·한계는 [보고서](../../docs/audits/2026-11-01-game-build-stage0.md)와 [구현 계약](../../docs/architecture/game-builds.md)을 따른다.
