# 게임 HTML 입출력과 제작 상태 안내

2026-11-03. 6단계의 계약이다. [제작 실행](game-build-execution.md)·[원본 수정](game-build-editing.md)·[저장 계약](game-builds.md)을 사용한다. 기본 전달 형식은 플레이용 HTML 파일 하나이며 ZIP/폴더·소스 묶음 전송 형식을 추가하지 않는다.

## 내보내기

미리보기의 ‘게임 HTML 내보내기’는 runtime의 desktop API `exportPreviewHtml(relativePath)`를 호출한다. 저장하면 true, OS 저장 창을 취소하면 false다. 데스크톱 능력이 없는 runtime에는 버튼을 제공하지 않는다. 관리자가 제작한 공동 게임도 현재 읽을 수 있는 snapshot에서 같은 경로로 내보낸다. 프로젝트 권한이나 AI 실행 권한을 파일 저장 능력과 혼합하지 않는다.

`PreviewExportService`가 시작 세션의 저장된 HTML을 캡처·검사하고, OS 저장 창 뒤와 파일 교체 전에 세션·현재 HTML을 다시 확인한다. 게임이 변경됐으면 최신 파일을 다시 내보내도록 안내한다. 프로젝트를 전환한 뒤 늦은 저장 결과를 새 프로젝트에 연결하지 않는다. 저장은 실행 화면의 srcdoc가 아닌 프로젝트의 최종 원본 HTML이다. 키보드 bridge·앱 SDK 삽입·디버그 코드·task·인증 정보를 추가하지 않는다. 라이브러리 고지와 기존 HTML 바이트는 보존한다.

| 위치                                          | 책임                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| contracts/app-api.ts                          | desktop API와 반환 계약                                  |
| application/editing/preview-export-service.ts | 읽기·검사·저장 창 이후 재확인                            |
| desktop/export-preview-html.ts                | 현재 창에 연결된 OS 저장 창                              |
| adapters/filesystem/html-export.ts            | 프로젝트 내부/링크 경로 검사, 임시 파일·원자 교체·정리   |
| main.ts                                       | 기존 sender/session guard 및 local/shared snapshot 조립  |
| UI preview                                    | 버튼·진행/결과/실패 표시. 파일 저장 로직을 소유하지 않음 |

프로젝트 내부와 그곳을 가리키는 디렉터리 junction으로 내보내기는 거절한다. 기존 저장·히스토리를 우회해 프로젝트 HTML·문서·설정을 덮어쓰지 않는다. 일반 외부 파일은 사용자가 OS 저장 창에서 지정한다. 검증 실패 시 기존 내보낸 파일을 유지하고 임시 파일을 정리한다. 이전 세션이나 서버 접근 거부·삭제 상태를 성공으로 돌려주지 않는다.

프로젝트 세션의 HTML 용량 정책과 기존 inert 검사·외부 참조 안내를 사용한다. 로컬은 고정 크기 제한 없이 저장한 HTML을 내보낼 수 있다. 공동은 8MB를 유지한다. 외부 리소스가 있는 예전 HTML의 외부 파일을 수집하거나 브라우저 호환성을 보장하지 않는다. 앱 온라인 SDK가 필요한 게임은 앱 실행 조건을 안내한다. 외부 온라인 멀티 서비스는 구현하지 않는다.

캔버스 GLB를 참조하는 로컬 제작 게임은 원본 프로젝트에서 실행한다. 단일 HTML 내보내기와 다른 프로젝트로의 개별 게임 복사는 거절한다.

## 다시 가져와 수정하기

기존 `importFiles`·가져오기 reducer·로컬 저장 큐/공동 명령·히스토리 경로를 사용한다. 파일 선택·드롭·클립보드 파일 목록에서 로컬 HTML의 바이트는 파일당 한도와 묶음 합계에서 제외한다. 큰 디스크 파일의 드롭은 preload가 실제 파일 경로를 전달한다. UTF-8·HTML 형식·개수·프로젝트 scope/context 검사는 계속 적용한다. HTML을 검사할 때 코드를 실행하거나 참조 URL을 수집하지 않는다. 불러온 HTML은 기존처럼 미리보기에서 실행할 수 있다.

가져온 파일에는 새 결과 경로와 관리 문서 ID를 준다. `gamejam-build-provenance` 같은 비실행 JSON이 있어도 기존 artifact/build ID로 자동 연결하거나 dependency lock·패키지 설치·로컬 명령으로 받아들이지 않는다. 내보내기에 수정용 source와 기준 문서를 새로 끼워 넣지 않으므로, HTML만 받은 경우 원래 프로젝트의 source recipe가 복원됐다고 표시하지 않는다.

사용자는 가져온 HTML을 자료로 선택하고 ‘새 버전 만들기’를 사용한다. 원본 HTML은 유지하고 workflow v2가 HTML을 참고해 새 source 묶음·이미지 처리·독립 HTML을 만든다. 제공된 자료와 사용자 요구에 따라 새 library 선정은 가능하지만, embedded metadata만으로 자동 설치하지 않는다. 가져온 원본을 갱신할 수 없는 기존 보호 정책은 UI 선택과 검증에서도 설명한다.

## 원본·기준 문서 상태

`PreviewResult.build`는 선택적 `GameBuildStatus`다. 기존 readPreview의 최소 응답 형식을 유지하고 listPreviews의 설명 정보로 제공한다. 현재 앱이 local/shared snapshot에서 같은 core 계산을 사용한다. 외부 서버에 별도 UI 저장 경로나 소스 조회 endpoint를 만들지 않는다.

- source: 완전한 수정 recipe가 보관됨. 현재 고정 root library와 버전·제작에 사용한 문서를 보여준다.
- html: HTML 자료에서 새 수정 원본 작성. 가져온 HTML은 원본을 유지하며 새 버전으로 수정한다.
- unavailable: 원본 정합성 확인 실패. 구체적인 오류와 기존 기록/프로젝트에서 복원하는 안내를 표시한다. 정상 source로 표시하지 않는다.

기준 문서는 현재 path/ID와 당시 baseline을 비교해 unchanged/changed/missing/replaced/unknown을 구분한다. 존재하고 ID가 같은 문서만 기존 문서 링크로 연다. 삭제됐거나 다른 ID의 문서를 예전 문서로 자동 연결하지 않는다. 긴 목록은 처음 20개와 추가 개수를 표시한다. 원본 아이디어도 제작 입력으로 기록됐다면 이 목록에 포함한다.

6단계부터 새 manifest의 documents에 선택적 `designSha256`을 보관한다. 기존 sha256은 AI가 읽은 전체 파일의 사실로 유지한다. 새 비교 hash는 본문과 의미 있는 frontmatter를 안정적으로 직렬화하며 좌표·크기·캔버스·색·갱신 시각·앱 출처·업무 상태 표시 metadata를 제외한다. YAML key 순서나 앱의 저장 장식만 바뀌어도 ‘요구 변경’으로 표시하던 문제를 피한다. 문서 type/title/ID·출처·시스템 구성 등 의미 있는 값은 유지한다.

예전 revision은 전체 hash가 그대로면 unchanged이며, 다르지만 새 비교 hash가 없으면 unknown이다. 임의로 changed/unchanged를 추정하거나 과거 revision을 재작성하지 않는다. 프로젝트 간 복사에서 ID/경로가 재연결된 문서는 기존 비교 hash를 제거해 unknown으로 남기며 다음 제작부터 새 baseline을 기록한다. 저장 version 1의 선택적 추가 정보이므로 사전 migration은 필요 없다.

파일 비교 결과를 ‘게임에 반영 완료’나 ‘미구현’으로 자동 판정하지 않는다. UI는 사실과 다음 제작 요청에서 문서를 확인하는 방법을 설명한다. 자동 요구 충족/화면 평가·수정은 이 단계의 기능이 아니다. 상태 계산은 해당 게임의 원본 묶음을 검사해 다른 게임까지 반복 hash하는 경로를 피한다.

미리보기의 안내는 접을 수 있고 펼친 높이는 최대 180px로 제한한다. 카드의 남은 높이는 게임 실행 영역이 사용한다. 경고·내보내기 결과가 추가돼도 안내가 남은 공간 전체를 차지하지 않으며 최소화할 때는 제작 안내를 숨긴다.

## Windows 파일 교체

실제 패키지 검사에서 history entry 교체에 EPERM 공유 잠금 오류를 확인했다. `atomic-replace.ts`는 EPERM/EBUSY/EACCES만 20/40/80/160ms 후 최대 5회 시도하며 매번 소유 계층의 재확인을 실행한다. 디스크 부족 등 다른 오류는 즉시 실패한다. 대상 파일을 먼저 삭제하는 fallback은 없다.

history entry는 기존 내용이 달라졌으면 덮어쓰지 않는다. HTML export는 현재 세션과 저장된 게임을 재확인한다. 로컬 history의 기존 기록 경로와 완료/실패·rollback 경계 자체를 바꾸지 않는다. 모든 파일 잠금·디스크 장애를 해결한다고 표현하지 않는다.

## 검증 연결

`game-build-transfer.test.mjs`는 상태·의미 있는 문서 비교·예전 baseline·원본 없는 재가져오기·고정 metadata 비신뢰·바이트 보존·취소/충돌/세션·원자 교체/재시도·프로젝트/junction 경로를 검사한다. runtime 계약 검사에 새 desktop 메서드를 포함한다. 기존 main 통합은 모의 dialog와 실제 파일 저장을 사용한다.

패키지 후 `game-build-native-export.mjs`는 실제 Windows 저장/취소 dialog와 경로 보호를 확인한다. 도우미는 테스트 앱의 PID와 dialog/자식 control만 조작한다. 운영 앱의 테스트용 export 경로나 승인 우회 API는 추가하지 않는다.

`GAMEJAM_BUILD_TRANSFER=1`을 기존 packaged 제작 검사에 지정하면 실제 미리보기 버튼·native dialog·바이트 보존·새 import·새 source 제작을 local/shared에서 검사한다. 작성 AI/CLI는 모의 실행이며 실제 bundler·Electron/파일/서버 경로와 구분한다. Chrome/Edge 단일 파일 검사는 exported/reimport HTML에 각각 수행한다. 결과는 [6단계 보고서](../audits/2026-11-03-game-build-stage6.md)를 따른다.
