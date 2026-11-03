# 공유 위치 링크 구현·검증 기록

- 날짜: 2026-11-03
- 정책: [ADR 0007](../architecture/decisions/0007-shared-location-links.md)
- 구현 안내: [공유 위치 링크](../architecture/location-links.md)

## 구현한 동작

공동 프로젝트의 문서/이미지·HTML·단일 그림/도형/텍스트에 위치 링크 복사를 연결했다. 기존 참여 자격으로 온라인 lifecycle/state와 대상 존재를 확인하고, 기존 프로젝트 열기·저장 큐·세션 경계를 사용한다. 링크는 권한을 부여하지 않으며 다른 서버로 자격을 보내거나 자동 참여하지 않는다. 붙여넣기 열기, 최초 실행, 실행 중인 앱으로 전달, renderer 준비 전 보관과 요청 확인을 구현했다.

Windows가 URL을 `gamejam://open/?...`으로 정규화하는 실제 동작을 확인하고 원래 `open?...` 형태와 함께 지원했다. 큰 대상은 회전 후 전체 표시 크기로 맞추고 작은 대상은 100% 상한·32px 강조 표시를 사용한다. 문서·텍스트·HTML은 읽기 높이를 유지한다. 이동 중 사용자가 화면을 조작하면 후속 카메라 이동과 강조를 취소한다. 초기 전체 보기와 링크 이동의 경합을 보완했다.

문단 링크는 편집 도구에서 처음 복사할 때 Markdown 주석/Tiptap JSON의 보이지 않는 앵커를 저장한다. 문단·제목·목록·표 셀·인용의 왕복과 동일 문서 내 복제·Undo를 검증했다. 앵커를 보존하는 수정은 같은 위치로 연결되고 삭제·중복된 앵커는 문서까지 열고 안내한다. 서버의 `locationAnchorVersion:1` 협상으로 구버전의 읽기/수정에 의한 앵커 소실을 막는다.

## 검증 결과

| 검사                                             | 결과                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                       | 1,160개 중 1,159개 통과, 1개 건너뜀, 실패 0. architecture 포함                                                           |
| `npm run typecheck`                              | 통과                                                                                                                     |
| `npm run typecheck:contracts` / `typecheck:core` | 통과                                                                                                                     |
| `npm run lint`                                   | 통과. 기존 Discord transport mock의 `no-this-alias` 경고 1개 유지                                                        |
| `npm run test:location-links:main`               | 실제 임시 서버·production main/IPC에서 자격 확인·홈 복귀 후 열기·세션 변경 거절·문단 저장·구버전 및 외부 frame 거절 통과 |
| `npm run test:location-links:ui`                 | 빌드된 fixture의 실제 Electron 화면에서 수신·문단 span·스크롤·강조·복사 메뉴 통과                                        |
| `npm run package`                                | 최종 소스로 Windows x64 패키지 생성 통과                                                                                 |
| `npm run test:location-links:packaged`           | 실제 exe의 종료/실행 중 수신·Windows ShellExecute 전달·문단/HTML/텍스트·회전/극대/극소 도형·극대 이미지 통과             |
| `node tests/document-links-packaged.mjs`         | 기존 링크의 새 프로세스 재열기·제목 갱신·구형 파일·삽입·캔버스 전환·임시 펼침·역링크·삭제/복원 통과                      |
| `npm run test:integration`                       | 통과. production main·실제 HTML 검증·fullscreen/pointer lock·격리 사용자 창·캔버스 전환·저장/충돌/한글 입력 UI 회귀 포함 |

로그는 `out/location-links-unit-tests.log`, `out/location-links-package.log`, `out/location-links-document-regression.log`, `out/location-links-integration.log`에 기록했다. 패키지 수치/검증 근거는 `out/location-links-packaged/evidence.json`, 화면은 `out/location-links-ui/paragraph.png`에 있다. 실제 100,000×90,000 회전 도형은 약 0.455%까지 축소되어 전체가 들어왔고 극소 대상의 강조는 32×32px였다. 1×1 원본 PNG를 90,000×60,000으로 배치한 카드도 파일 해상도 대신 표시 경계를 기준으로 맞췄다.

OS 전달 검사는 기존 `HKCU\Software\Classes\gamejam` 등록을 백업하고 UUID 테스트 프로필로 잠시 연결한 뒤 원상 복구했다. 이번 환경에는 기존 키가 없어 검사 뒤 생성한 키를 제거했다. 실행 중인 실제 사용자 앱·프로젝트를 검증 대상으로 사용하지 않았다.

## 남은 제약

- 공개 게시·사용자 설치 앱 업데이트는 수행하지 않았다. Setup 설치/자동 업데이트/제거의 전체 등록 수명은 이번 패키지+OS 전달 검사와 별도다.
- 한 PC의 임시 서버·격리 프로필 검사다. 실제 두 PC, 외부 서버 연결, 특정 메신저의 링크 인식은 미검증이다.
- 문단 링크에는 업데이트된 서버/클라이언트가 필요하다. 코드 블록·여러 문단 선택·문자 일부의 영구 범위·HTML 내부 DOM 요소는 지원 범위가 아니다.
- 원문/외부/AI 편집이 앵커를 제거하면 위치를 자동 복구하지 않는다. 경로 기반 레거시 파일의 개명/재생성 동일성도 보장하지 않는다.
- 임의 PC 파일이나 실행 파일을 열어주는 공유 링크는 제공하지 않는다. 개인 로컬 기능의 서버 독립성은 유지한다.
- 새 아키텍처 예외나 검사 규칙 완화는 없다.
