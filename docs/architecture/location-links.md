# 공유 위치 링크

정책과 대안은 [ADR 0007](decisions/0007-shared-location-links.md)을 따른다.

## 제공 동작

공동 프로젝트의 문서/이미지·HTML 메뉴와 단일 그림/텍스트 선택 메뉴에서 `위치 링크 복사`를 제공한다. 이미 저장된 참여 자격으로 서버의 접근 권한을 확인하고 발급한다. 링크를 열면 프로젝트·캔버스를 선택하고 대상을 중앙에 표시한다. 파일의 원본 크기나 좌표는 바꾸지 않는다. 화면 오른쪽 아래의 링크 버튼에서 주소를 직접 붙여넣을 수도 있다.

문단 링크는 공동 서버가 `locationAnchorVersion:1`을 지원할 때 문서 편집 도구와 캔버스 텍스트 도구의 `문단 위치 링크 복사`에서 만든다. 커서가 속한 하나의 문단에 앵커를 추가하고 기존 저장 완료 후 링크를 발급한다. 이미 앵커가 있는 Markdown 문단은 읽기 화면 우클릭으로도 복사한다. codeBlock·여러 문단 선택·모호한 앵커는 오류 안내를 제공한다.

도형/이미지는 전체 경계를 화면에 맞추고 작은 대상은 100%를 넘겨 자동 확대하지 않는다. 강조 테두리는 최소 32px다. 문단 링크는 읽기 가능한 문서 배율을 유지하고 해당 문단으로 스크롤한다. 삭제된 문단을 추측해서 다른 문단을 강조하지 않는다.

## 연결과 보존

- 외부 URL은 프로젝트 ID·대상 종류/ID·선택적인 블록 ID만 담는다. 인증 자격이나 PC 경로는 담지 않는다.
- Windows가 `gamejam://open?...`을 `gamejam://open/?...`으로 정규화해 넘기는 두 형태를 모두 해석한다.
- `LocationLinkService`는 ProjectLibrary의 공개 항목과 desktop port로 현재 참여 자격을 확인한다. `ProjectHomeService.verifyLocationAccess`의 lifecycle/state는 인증된 온라인 조회이며 캐시로 우회하지 않는다. 원격 대상 색인을 먼저 검사해 이미 삭제된 대상을 열려고 프로젝트를 불필요하게 전환하지 않는다.
- 기존 home open, 저장 큐, project session, mutation queue와 재접속을 사용한다. 이전 세션의 요청은 IPC와 UI에서 다시 확인한다. URL 주소로 서버 연결 정보를 변경하는 API는 없다.
- `LocationLinkInbox`는 renderer 준비 전에도 최신 요청을 보관한다. renderer는 수신 통지와 pending 조회를 조합하며 일치한 요청 ID만 확인한다. 시작 시 잘못된 URL은 비밀 값 없이 일반 오류로 전달한다.
- 설치 앱은 OS protocol handler를 등록하고 Squirrel uninstall에서 자신의 등록을 해제한다. 테스트 프로필은 등록을 바꾸지 않는다. 개발 실행의 자동 OS 등록은 제공하지 않는다.
- HTML/문서 ID와 경로 이력은 현재 저장 정책을 따른다. 모든 레거시 파일에 영속 ID가 있다고 가정하지 않는다. ID가 없는 상대 경로 링크는 개명 뒤 끊길 수 있다.

## 구현 위치와 검사

| 역할                            | 위치                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| URL/대상 계약                   | `src/contracts/location-links.ts`                                                          |
| 순수 검증·대상 해석·카메라 계산 | `src/core/projects/location-links.ts`, `location-anchors.ts`                               |
| 열기·발급 업무 순서             | `src/application/projects/location-link-service.ts`                                        |
| snapshot 색인                   | `src/adapters/markdown/location-index.ts`                                                  |
| OS 수신·확인·IPC                | `src/desktop/location-link-protocol.ts`, `location-link-inbox.ts`, `ipc/location-links.ts` |
| 화면 수신/이동                  | `src/ui/locations`, `src/ui/canvas/useLocationNavigation.ts`                               |
| 편집 앵커                       | `src/ui/editor/location-anchor.ts`                                                         |

기본 검사는 `npm test`의 URL·세션·Markdown/JSON 왕복·복제/Undo·구버전 거절이다. `npm run test:location-links:main`은 실제 임시 서버와 production main/IPC를 사용한다. `npm run test:location-links:ui`는 빌드된 fixture를 실제 Electron renderer에서 실행한다. 기존 dev fixture가 간접 Node 의존성을 갖는 제한 때문에 배포와 같은 tree shaking을 적용하되 테스트를 위한 Node polyfill을 넣지 않는다.

`npm run package` 뒤 `npm run test:location-links:packaged`는 실제 Windows 실행 파일과 UUID 테스트 프로필에서 종료/실행 중 수신·실제 OS 전달·문단/HTML/텍스트·큰/작은/회전 그림과 이미지를 확인한다. OS 등록 검사는 기존 프로토콜 키를 임시 파일에 백업하고 테스트 프로필로 잠시 연결한 뒤 원래 키를 복원한다. 테스트 실행은 공개 배포나 설치 프로그램의 업그레이드/제거 전체 검증을 대신하지 않는다.
