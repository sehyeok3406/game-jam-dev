# 클립보드 이미지 붙여넣기 조사

조사일: 2026-10-13. 대상: 현재 작업 트리의 Game Jam! 0.18.1, 설치된 Electron 44.5.1.

## 결론

구현 가능하다. 첫 단계는 **Windows에서 캡처하거나 복사한 이미지를 Ctrl+V로 현재 캔버스에 이미지 카드로 추가**하는 기능을 권장한다. 기존 이미지 파일 불러오기·저장·협업 명령을 재사용할 수 있어 새 이미지 관리 시스템이나 추가 패키지는 필요하지 않다.

**문서 본문에 이미지 삽입**은 별도 범위다. 현재 편집기의 이미지 표현, 커서 위치, 문서 자동 저장과 파일 저장의 일관성까지 다뤄야 한다.

이 문서는 코드와 공식 문서를 조사한 결과다. 기능 구현이나 실제 Windows 클립보드 호환성 검증은 수행하지 않았다.

## 현재 코드에서 확인한 내용

| 영역                              | 현재 동작과 재사용 지점                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/App.tsx`                  | `copyCanvasSelection()`은 선택된 문서와 그림을 메모리 ref에 저장한다. `pasteCanvasSelection()`은 이 자료를 복제한다. OS 클립보드의 이미지 데이터는 읽지 않는다.                 |
| `src/canvas-ux.ts`                | Ctrl+V를 캔버스 붙여넣기로 분류한다. 입력창·문서 편집·모달·게임 실행에서는 캔버스 단축키를 제외한다.                                                                            |
| `src/main.ts`                     | `files:import`는 파일 선택창에서 읽은 데이터를 검증한 뒤 로컬 저장 또는 협업 `files:import-batch` 명령으로 전달한다. 클립보드 관련 기존 IPC는 텍스트 복사인 `clipboard:copy`다. |
| `src/file-assets.ts`              | `buildFileImports()`가 고유 ID, 이미지 원본과 설명 Markdown을 만든다. PNG/JPG/WebP/GIF, 이미지당 5,000,000바이트 제한이 있다.                                                   |
| `src/collaboration-model.ts`      | `files:import-batch`가 활성 캔버스 검증, 배치, 스냅샷 검증을 처리한다.                                                                                                          |
| `src/shared.ts`, `src/preload.ts` | 위치·캔버스·이미지 용도를 받는 `ImportFilesInput`과 파일 불러오기 API가 있다. 클립보드 붙여넣기용 API는 추가해야 한다.                                                          |
| `src/ui/MarkdownEditor.tsx`       | Tiptap 편집기와 원문 textarea가 있다. 이미지 파일을 저장하는 붙여넣기 처리는 없다.                                                                                              |
| `src/markdown-extensions.ts`      | `SafeImage`가 이미지를 실제 그림 대신 이미지 이름·경로가 있는 span으로 표시한다. `allowBase64: false`다.                                                                        |
| `src/asset-links.ts`              | 읽기 화면에서 프로젝트 내부 `assets/images/` 경로를 해석한다. 외부 URL과 본문 data URI는 허용하지 않는다.                                                                       |
| `src/dev-api.ts`                  | 브라우저 개발 미리보기의 파일 불러오기·이미지 읽기는 현재 지원하지 않는다. 새 API 추가 시 미리보기용 명시적 처리도 필요하다.                                                    |

원본은 실제 프로젝트 이미지 파일로 저장하고, 스냅샷/협업 전송에서는 기존 data URI 표현을 사용한다. 따라서 data URI를 Markdown 본문에 직접 넣는 방식은 현재 구조와 맞지 않는다.

## 사용할 API

### 데스크톱 캔버스: Electron 메인 프로세스

설치된 `node_modules/electron/package.json`과 `electron.d.ts`를 함께 확인했다. 44.5.1의 `Clipboard`에는 비동기 `read()`, `has()`, `write()`가 있으며 `readImage()`는 없다. **예전 Electron의 `clipboard.readImage().toPNG()` 예제를 그대로 적용하면 안 된다.** 이 사실은 [Electron 44.5.1 공식 문서](https://github.com/electron/electron/blob/v44.5.1/docs/api/clipboard.md)와도 일치한다.

권장 흐름:

1. 캔버스 붙여넣기 요청을 제한된 preload API로 메인 프로세스에 전달한다.
2. `await clipboard.read()`로 항목을 읽고 `item.types`에서 지원 이미지 MIME을 찾는다.
3. `await item.getType(mime)`로 Blob을 얻는다. Blob 크기를 먼저 확인하고 바이트로 변환한다.
4. PNG/JPEG는 기존 `nativeImage.createFromBuffer()` 검사도 활용한다. 기존 형식·크기 검증을 거친다.
5. 안전한 생성 파일명과 `encodeAsset()`으로 기존 import payload를 만든다.
6. 공통 가져오기 로직으로 원본과 설명 문서를 함께 저장하고 생성된 카드를 반환한다.

PNG가 제공되면 PNG를 우선 선택하는 것이 캡처 지원의 시작점이다. 한 항목에 PNG와 JPEG가 함께 있어도 같은 이미지의 대체 표현일 수 있으므로 **MIME마다 카드를 만들지 않는다.** 복사 원본 앱이 제공하는 형식은 실제 Windows 검증으로 확인해야 한다.

Electron 클립보드 API는 메인 프로세스용이며 renderer 직접 사용은 deprecated다. 프로젝트의 `sandbox: true`, `contextIsolation: true` 구조를 유지하고, renderer에는 원시 클립보드 접근 대신 붙여넣기 목적의 좁은 API를 노출하는 것이 적합하다. [Electron clipboard](https://www.electronjs.org/docs/latest/api/clipboard)

### 문서 편집기: paste 이벤트

`paste` 이벤트의 `event.clipboardData`는 DataTransfer다. 파일 항목은 `items`/`files`와 `getAsFile()`로 얻을 수 있다. 이미지 처리를 맡을 때 이벤트 안에서 동기적으로 `preventDefault()`를 호출한 뒤 저장을 시작해야 한다. 현재 캔버스 keydown에서 Ctrl+V 기본 동작을 막으므로, DOM paste 방식으로 전환한다면 이 처리와 함께 조정해야 한다. [MDN clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData), [getAsFile](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile), [paste 이벤트](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event)

Tiptap에는 `FileHandler`의 `onPaste`가 있다. 다만 저장·업로드·이미지 노드 삽입은 앱에서 구현해야 한다. 현재 편집기에 `editorProps`가 있으므로 자체 `handlePaste`로 처리할 수도 있다. 첫 단계 캔버스 지원에는 이 확장이 필요하지 않다. [Tiptap FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)

## 권장 사용 동작

| 상황                                | 권장 결과                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| 캔버스에서 캡처 이미지 Ctrl+V       | 현재 캔버스에 이미지 카드 생성, 선택, 저장 완료 안내                                 |
| 앱 안에서 카드·그림 Ctrl+C → Ctrl+V | 기존 복제 동작 유지                                                                  |
| 외부 이미지를 복사한 뒤 Ctrl+V      | 이전 메모리 ref의 카드 대신 새 이미지 추가                                           |
| 제목·검색·연결 정보 입력창          | 해당 입력창의 일반 텍스트 붙여넣기 유지                                              |
| 문서 편집 중                        | 첫 단계에서는 기존 편집 동작 유지. 본문 이미지 삽입은 후속 지원                      |
| 모달·게임 iframe·홈                 | 캔버스에 이미지가 생성되지 않게 범위 제한                                            |
| 뷰어·연결 끊긴 협업 상태            | 기존 불러오기 권한과 동일하게 거절                                                   |
| 이미지 URL만 복사                   | 이미지 데이터와 구분. 외부 다운로드 기능은 별도 범위                                 |
| 탐색기에서 이미지 파일 Ctrl+C       | 파일 경로 복사와 이미지 픽셀 복사는 구분. 초기 지원을 보장하려면 별도 실기 검증 필요 |

배치는 현재 캔버스 뷰의 중앙을 기본값으로 하고 기존 배치 함수를 활용한다. 이미지 용도는 최초에는 현재 불러오기 설정을 사용하고 카드에서 확인 가능하게 하는 방식을 권장한다.

## 구현 시 핵심 사항

- **내부 복사와 OS 클립보드의 우선순위:** 현재 내부 복사는 OS 클립보드를 갱신하지 않는다. 단순히 이미지가 있으면 먼저 붙이는 구현은 외부 이미지 → 내부 카드 복사 순서에서 잘못 동작한다. 내부 Ctrl+C 때 OS 클립보드에 앱 전용 토큰을 기록하고 현재 메모리 자료와 일치할 때 내부 복제하는 방식이 적합하다. 외부 복사로 토큰이 사라지면 새 OS 데이터를 처리한다. 임의 토큰만으로 경로나 자료를 신뢰하지 않고 현재 프로젝트·세션과 대조한다. Electron은 `web` 접두사의 사용자 정의 형식을 지원한다. [Electron 44.5.1 clipboard 문서](https://github.com/electron/electron/blob/v44.5.1/docs/api/clipboard.md)
- **검증과 기록 재사용:** `files:import`의 파일 선택 이후 로직을 공통 함수로 추출한다. 새 IPC도 `handle()`의 mutation queue, `assertMutationAllowed()`, AI 파일 잠금, 로컬 사용자 기록과 협업 history 등록에 연결한다. 기존 코드에는 채널명 기반 특별 처리가 있어 단순 핸들러 추가만으로 같은 보호·기록이 적용된다고 가정하면 안 된다.
- **붙여넣기 시점 보존:** 클립보드 항목을 요청 초기에 확보하고, 대기 중 프로젝트나 캔버스가 바뀌면 다른 프로젝트에 저장되지 않게 scope를 검사한다. 연속 Ctrl+V는 요청별로 처리하되 한 입력을 keydown과 paste 양쪽에서 두 번 처리하지 않는다.
- **용량·디코딩:** 기존 5,000,000바이트 제한을 적용한다. base64 변환 시 약 4/3로 커지는 전송 데이터도 기존 batch/snapshot 제한을 통과해야 한다. 고해상도 압축 이미지의 메모리 사용을 고려해 픽셀 수 제한도 검토한다. 초과 이미지는 명확히 안내하고 자동 축소는 별도 제품 선택으로 둔다.
- **원본과 수명:** 임시 파일이나 blob URL만 남기지 않고 기존 프로젝트 파일로 저장한다. 이미지 카드 삭제 시 원본을 보존하는 기존 정책을 따른다. Undo/Redo는 단순 카드 삭제와 구별해 원본·설명·참조의 일관성을 검증한다.
- **HTML과 이미지가 함께 들어오는 경우:** 같은 이미지가 두 번 추가되지 않게 한 처리가 이벤트를 소유한다. 외부 HTML의 이미지 URL은 현재 정책대로 자동으로 불러오지 않는다.
- **애니메이션:** 복사한 GIF가 정지 PNG 한 프레임으로 제공될 수 있다. 애니메이션 보존을 보장하지 않으며 원본 GIF 파일 가져오기를 안내한다. [Tiptap FileHandler의 GIF 설명](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)

## 후속 범위: 문서 본문 이미지

이미지 파일을 프로젝트에 저장한 후 해당 문서의 상대경로 Markdown을 커서 위치에 삽입한다. Tiptap과 원문 textarea를 모두 처리해야 한다. 저장 대기 중 커서 이동·문서 닫힘·프로젝트 전환·편집 잠금이 바뀌는 상황을 고려한다.

편집 중에도 그림을 보여주려면 `SafeImage`를 프로젝트 이미지 전용 NodeView로 확장하고 `readAsset()`을 이용해야 한다. 이미지가 저장됐는데 문서 참조가 저장되지 않은 경우와 문서에는 참조가 있지만 이미지 저장이 실패한 경우의 복구 방식도 정해야 한다. 기존 문서 저장 큐와 충돌 처리에 연결하는 것이 필요하다.

## 구현 후 필요한 검증

1. 실제 Windows 앱: Win+Shift+S 캡처, 브라우저의 이미지 복사, 그림 편집기의 이미지 복사.
2. PNG 투명도·고해상도 이미지, JPEG, 지원되지 않는 형식, 손상 데이터, 용량 초과, 이미지 없는 클립보드.
3. 카드 복사 → 외부 이미지 복사, 외부 이미지 복사 → 카드 복사, 텍스트 복사로 내용 변경, 연속 붙여넣기.
4. 확대/이동된 캔버스·다른 캔버스에서 위치, 저장 후 앱 재시작, 카드 선택·Undo/Redo·원본 파일 일관성.
5. 관리자·편집자 사이 동기화, 뷰어 거절, 연결 끊김, AI 실행 중 허용되는 새 자료 추가, 프로젝트 전환.
6. 제목·검색·문서 원문·Tiptap·모달·게임 입력의 붙여넣기 회귀 확인.
7. 실제 패키지에서 IPC/preload 동작 검증. 기존 `tests/file-import.test.mjs`는 파일·협업 경로의 검증 기반이지만 OS 클립보드와 키보드 입력 검증을 대체하지 않는다.

첫 구현의 주요 변경 대상은 `src/ui/App.tsx`, `src/main.ts`, `src/preload.ts`, `src/shared.ts`, `src/dev-api.ts`이며 내부 복사 토큰과 가져오기 공통 로직을 작은 모듈로 분리할 수 있다. 본문 삽입까지 포함하면 `MarkdownEditor.tsx`와 `markdown-extensions.ts` 및 문서 저장 연동이 추가된다.
