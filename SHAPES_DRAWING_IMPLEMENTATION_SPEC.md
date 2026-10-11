# 도형 삽입·자유 드로잉 구현 기술 스펙

작성일: 2026-10-11 · 조사 기준: Game Jam! v0.13.6, Git `94a0345`, Figma·Microsoft·React Flow 공식 문서.

상태: **구현 제안**. 이 문서는 조사와 설계를 위한 명세이며, 기능 구현·의존성 설치·데이터 전환·배포는 수행하지 않았다. 아래의 제품 동작과 수치 제한은 별도 표시가 없으면 Game Jam!에 적용할 제안이다.

## 1. 목표와 권장 방향

사용자가 캔버스에 원·삼각형·사각형과 선을 배치하고, 마우스나 펜으로 아이디어·레벨 구조·플레이 흐름을 그릴 수 있게 한다. 완성한 도형과 획은 선택·이동·크기 변경·색 변경·삭제·실행 취소가 가능한 독립 객체로 유지한다.

**기존 React Flow 캔버스 + 객체별 SVG 표시 + Pointer Events 입력 + 캔버스별 JSON 저장**을 권장한다. Figma의 도형 생성·정밀 조작과 PowerPoint의 펜·형광펜·획 지우개를 참고한다. 저장·협업·히스토리도 첫 출시의 필수 범위로 다룬다.

요구사항의 기본 해석은 다음과 같다.

- 대상은 Game Jam!의 프로젝트 캔버스다. Markdown 본문 안의 그림 편집이나 HTML 게임 안의 그림판은 별도 작업이다.
- 첫 지원 환경은 현재 Windows Electron 앱의 마우스·트랙패드·디지털 펜이다. 터치는 입력 충돌 방지까지 포함하며 전문 태블릿 편집 UX는 후속 범위다.
- 도형과 드로잉은 확대해도 편집 가능한 벡터 자료다. 비트맵 브러시·레이어 합성 편집은 후속 범위다.
- Figma와 PowerPoint의 사용 패턴을 참고하며, 두 제품의 전체 기능이나 파일 형식 호환을 목표로 하지 않는다.

## 2. 제품 조사와 적용 판단

공식 도움말에 기재된 기능을 확인했다. 실제 앱의 모든 버전·구독·입력 장치 조합을 직접 조작해 검증한 결과는 아니다.

| 참고 제품·기능               | 공식 문서에서 확인한 동작                                                        | Game Jam! 적용 제안                              |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Figma 도형 도구              | 사각형·선·화살표·타원·다각형·별, Shift 비율 제한, Alt 중심 생성 [S1]             | 기본 도형과 Shift/Alt 생성부터 도입              |
| Figma Pencil                 | 드래그로 스케치, 도구 유지, Esc 종료, 생성 후 선 색·굵기와 크기 변경 [S2]        | 연속 그리기와 편집 가능한 획 객체                |
| Figma Stroke                 | 색·두께·불투명도·점선·선 끝·안/중앙/바깥 정렬 등 [S3]                            | 중앙 테두리·실선/점선·색·굵기부터 구현           |
| PowerPoint 도형              | 갤러리 선택·드래그 생성, 채우기·윤곽선 변경, 도형 안 텍스트, 반복 생성 모드 [S4] | 도형 메뉴·색 속성·반복 생성; 텍스트는 후속       |
| PowerPoint Freeform/Scribble | 클릭 직선 구간과 드래그 곡선, 열린/닫힌 도형, 점 편집 [S5]                       | 자유 드로잉부터 구현; 점 편집과 혼합 경로는 후속 |
| PowerPoint 디지털 잉크       | 펜·형광펜, 색·굵기, 선택·이동, 지우개; 기능은 플랫폼·버전에 따라 다름 [S6]       | 펜·형광펜·획 전체 지우개                         |
| PowerPoint Ink to Shape      | 선택한 잉크를 도형으로 변환; 구독·연결된 환경 등 조건 존재 [S7]                  | 후속의 명시적 변환 기능으로 검토                 |
| PowerPoint 정렬              | 여러 객체의 정렬·균등 배치 [S8]                                                  | 기존 스냅을 도형에 확장; 정렬 버튼은 후속        |

특히 Microsoft 문서는 Word/Excel과 PowerPoint의 잉크 변환 동작을 구분한다. 조사 결과를 근거로 “PPT에서는 항상 자동 변환된다”는 전제를 두지 않는다. Game Jam!의 첫 버전은 사용자가 그린 획을 그대로 보존한다. [S7]

## 3. 현재 코드에서 확인한 구현 조건

| 현재 근거                                         | 확인한 사실                                                                      | 구현에 미치는 영향                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `package.json`                                    | React 19, TypeScript, Electron, `@xyflow/react` 사용                             | 현재 도구 체계를 유지할 수 있음                             |
| `src/ui/App.tsx:197`, `:1643`                     | 도구는 `select/hand/note`; 노드는 문서·HTML 미리보기·섹션                        | 도구와 노드 종류, 선택 명령을 확장해야 함                   |
| `src/ui/App.tsx:6093` 인근                        | 메모 드래그 생성에 pointer capture와 `screenToFlowPosition` 사용                 | 좌표 변환·취소 흐름을 드로잉 입력과 통합 가능               |
| `src/ui/App.tsx:6381` 인근                        | 선택/이동 도구에 따라 드래그 동작 변경; 확대 범위 0.15–2                         | 드로잉 중 기존 이동·확대를 제어해야 함                      |
| `src/project-store.ts:62`                         | `Snapshot = Record<string,string>`; 허용된 Markdown·HTML·이미지·특정 JSON만 수집 | 새 JSON의 캡처·복원·백업 경로 등록 필요                     |
| `src/collaboration-model.ts:48`, `:81`            | 협업 경로 허용 목록, 최대 500개 파일·총 20MB·일반 파일 2MB 제한                  | 획마다 파일을 만들면 공유 한도에 빠르게 도달                |
| `src/sync-properties.ts`                          | Markdown 내용·위치·크기·색 단위 병합; JSON은 구조 변경으로 처리                  | 드로잉 JSON에 객체별 병합을 새로 구현해야 함                |
| `src/edit-journal.ts`                             | 클라이언트별 최대 100개 편집 기록, 조건부 속성 역변경                            | 획/제스처 단위 히스토리와 객체별 역변경 필요                |
| `src/offline-sync.ts`                             | 비 Markdown 파일의 양쪽 변경은 기본적으로 충돌                                   | 서로 다른 획 추가도 충돌하지 않도록 전용 병합 필요          |
| `src/canvas-sheet-commands.ts`                    | 자료 이동/탭 삭제는 파일 경로와 Markdown 소속 중심                               | 드로잉 객체 이동과 탭 삭제 시 자료 이전을 확장해야 함       |
| `src/main.ts:1236` 인근                           | watcher의 숨김 경로 제외 규칙 존재                                               | `.canvas/drawings/`와 그 하위 파일을 명시적으로 감시해야 함 |
| `src/canvas-ux.ts`                                | `L`은 문서 목록, `Ctrl+G`는 섹션 만들기에 사용                                   | Figma 단축키를 그대로 복사하면 충돌 발생                    |
| `src/web-viewer.ts`, `tools/web-viewer/worker.ts` | 웹 보기용 자료 변환·렌더링 경로 존재                                             | 웹 보기에서 새 그림이 누락되지 않게 확장 필요               |

현재 문서·섹션 저장 API에 도형 JSON을 억지로 넣지 않는다. **공통 저장 큐·스냅샷·거래·히스토리는 재사용하고, 드로잉의 모델·명령·병합은 별도 모듈로 추가**한다.

## 4. 기능 범위와 출시 기준

### P0 — 첫 출시 필수

| 영역           | 포함 기능                                                                    |
| -------------- | ---------------------------------------------------------------------------- |
| 도형           | 사각형, 둥근 사각형, 타원/원, 삼각형, 마름모, 선, 단방향 화살표              |
| 생성           | 메뉴 선택, 클릭 기본 크기 생성, 드래그 크기 지정, Shift·Alt, 반복 생성 선택  |
| 스타일         | 채우기/없음, 테두리/없음, 색·불투명도·굵기, 실선/점선; 둥근 사각형 반경      |
| 조작           | 클릭·다중 선택·드래그 선택, 이동, 크기 변경, 회전, 복제·복사·붙여넣기·삭제   |
| 겹침           | 그림끼리 앞/뒤 순서, 카드 뒤/주석 앞 표시 선택                               |
| 그리기         | 펜, 형광펜, 획 전체 지우개; 색·굵기·펜 필압 켜기/끄기                        |
| 화면           | 도구막대, 속성 패널, 우클릭 메뉴, 미니맵·전체 맞춤·선택 맞춤                 |
| 저장           | 자동 저장, 미확정 변경 유지, 초안 복구, 프로젝트 재열기·백업·복원            |
| 협업           | 편집/보기 권한, 객체별 변경, 응답 유실 재시도, 팀원 변경 보존, 오프라인 병합 |
| 캔버스         | 객체의 다른 캔버스 이동, 탭 삭제 시 대상 캔버스로 이전                       |
| 기존 기능 연동 | AI 입력 제외 안내, 웹 읽기 전용 표시, F12 상태 미리보기, 단축키 안내         |

P0에서 “원”과 “정사각형”은 별도 저장 종류가 아니라 동일 폭·높이의 타원/사각형이다. 삼각형은 기본 이등변 삼각형이며 Shift는 가로세로 비율 1:1을 제한한다. 정삼각형 프리셋은 후속으로 추가할 수 있다.

### P1 — 사용성 확장

도형 안 일반 텍스트·한글 조합과 자동 줄바꿈, 다각형·별·양방향 화살표, 도형 종류 변경, 정렬·균등 배치·스냅 고도화, 그림 그룹, 올가미 선택, SVG/PNG 내보내기, 섹션 소속, AI용 그림 입력을 추가한다.

### P2 — 정밀 드로잉

부분 지우개, 직선/곡선 혼합 경로와 꼭짓점·베지어 핸들 편집, 도형 자동 인식, 연결 대상에 붙는 커넥터, 불리언 연산, 그라데이션·텍스처 브러시를 검토한다.

P0의 화살표는 두 점으로 정의되는 독립 도형이다. 문서 간 관계를 자동 추적하는 커넥터와 구분한다. `.fig`·`.pptx` 가져오기/내보내기와 전문 이미지 편집은 이번 범위에 포함하지 않는다.

## 5. 사용자 동작과 입력 규칙

### 5.1 도구막대와 단축키

기존 선택·손·메모에 `도형 ▾`, `펜 ▾`, `획 지우개`를 추가한다. 도형 메뉴는 아이콘과 한국어 이름을 함께 제공하고, 펜 메뉴에는 펜·형광펜·필압 설정을 둔다. 선택 객체가 있으면 속성 패널, 없으면 다음 생성에 사용할 스타일을 보여준다.

| 입력              | 제안 동작                                              |
| ----------------- | ------------------------------------------------------ |
| `V / H / N`       | 기존 선택/손/메모 유지                                 |
| `R / O / T / D`   | 사각형/타원/삼각형/도형 메뉴                           |
| `Shift+L`         | 선. `L` 문서 목록 유지                                 |
| `A`               | 화살표                                                 |
| `Shift+P / B / E` | 펜/형광펜/획 지우개                                    |
| `Esc`             | 진행 중 제스처만 취소; 다음 Esc는 선택 도구로 전환     |
| `Space`           | 제스처 시작 전에는 임시 손 도구; 획을 긋는 중에는 무시 |
| `Shift`           | 생성 비율·선 각도·회전 각도 제한                       |
| `Alt`             | 도형 중심 기준 생성/크기 변경                          |
| 기존 Ctrl 단축키  | 복제·복사·붙여넣기·실행 취소·다시 실행 유지            |

단축키는 편집기·입력칸·대화상자·게임 실행 중에는 처리하지 않는다. 한글 조합 중 `event.isComposing` 또는 조합 상태이면 무시한다. `Ctrl+G`는 기존 섹션 기능을 유지한다.

### 5.2 도형 생성

1. 도구 선택 → 캔버스 좌표 확보 → 드래그 프리뷰 → 포인터를 놓으면 객체 1개 확정.
2. 화면 이동량이 5 CSS px 이하이면 클릭 생성: 사각형/타원/마름모 160×120, 삼각형 160×140, 선/화살표 길이 180 캔버스 단위. 시작 위치가 기본 경계 상자의 좌상단이고 선은 오른쪽 방향이다.
3. 드래그에서는 방향에 관계없이 `x/y`를 최소 좌표, `width/height`를 양수로 정규화한다. 선·화살표는 원래 시작/끝 방향을 별도 두 점에 보존한다.
4. Shift+사각형/타원 등은 1:1, Shift+선/화살표는 45° 단위. Alt는 시작점을 중심으로 하고 Shift+Alt는 동시에 적용한다.
5. 드래그 후 최소 크기는 4 캔버스 단위, 최소 선 길이는 4 단위다. 유효하지 않으면 저장 없이 취소한다.
6. 도형은 기본 1회 생성 후 선택 도구로 돌아간다. `연속 삽입`을 켜면 유지한다. 펜·형광펜·지우개는 연속 사용한다.

### 5.3 겹친 카드와 입력 우선순위

도형/펜/지우개 모드에서는 캔버스 내부에 입력용 투명 레이어를 두어 문서 카드·게임 iframe 위에서도 입력을 받는다. 도구막대·속성 패널·대화상자는 이 레이어보다 위에 둔다. 게임 실행 입력을 받을 때는 먼저 선택/손 도구로 전환한다.

선택 모드에서는 입력 레이어를 해제하고 실제 객체 윤곽을 선택 대상으로 삼는다. 채우기가 없는 도형은 윤곽만 선택되며 내부 빈 공간은 아래 자료에 전달된다. 얇은 선/작은 점은 별도 넓은 히트 영역을 제공한다. 겹친 객체는 위쪽 객체부터 선택하고, 우클릭의 `겹친 객체 선택`에서 이름·종류 목록으로 아래 객체를 선택할 수 있게 한다.

펜 제스처가 시작되면 `pointerId`, 프로젝트 범위, 캔버스 ID, 도구/스타일, 좌표 변환을 고정한다. 그리는 동안 휠·핀치·팬·자동 맞춤을 잠시 막는다. 새 포인터는 무시한다. 터치 드로잉은 기본 꺼짐이며 사용자가 켤 수 있다. 펜으로 그리는 동안 터치를 무시하는 방식으로 기본적인 오입력을 방지한다. 드로잉 입력 레이어에는 `touch-action:none`을 적용하고 선택/손 모드의 터치 정책과 분리한다. [S15]

`pointercancel`, 비정상적인 capture 상실, 창 포커스 상실, 도구/프로젝트 전환은 미완성 제스처를 취소한다. 정상 pointerup의 release에서 발생하는 capture 상실은 완료 상태를 되돌리지 않아야 한다. 탭 전환은 완료된 대기 저장을 flush한 뒤 처리하고, 미완성 제스처는 취소한다. 저장 실패 시 전환을 보류한다.

### 5.4 편집과 지우개

- 선택 후 8개 크기 핸들과 회전 핸들을 표시한다. Shift 크기 변경은 원래 비율, Shift 회전은 15° 단위다. 여러 객체는 P0에서 함께 이동·복제·삭제할 수 있지만 회전/크기 변경은 단일 객체에만 제공한다.
- 선/화살표는 양 끝점 핸들로 편집한다. 점선은 기본 `6,4` 캔버스 단위다. 필압 획·형광펜은 실선만 제공한다.
- 지우개는 펜/형광펜 획만 지운다. 커서 지름 기본 16 CSS px, 확대와 무관한 화면 크기다. 스윕 구간과 획의 교차를 검사하여 빠른 움직임도 놓치지 않는다.
- 한 번 누르고 드래그해 여러 획을 지워도 삭제와 실행 취소 기록은 하나다. P0는 획 일부를 잘라내지 않는다. 도형 삭제는 선택 후 Delete를 사용한다.
- 그림만 삭제하는 동작은 즉시 처리하고 실행 취소 안내를 표시한다. 파일 자료가 포함된 혼합 선택의 삭제는 기존 파일 삭제 확인 흐름을 유지한다. 파일 복제와 그림 복제를 묶는 명령은 한 거래로 처리한다.
- 다중 선택 스타일은 공통값/서로 다름을 구분한다. 속성을 바꿀 때 해당 속성만 patch하고 다른 객체 속성 전체를 전송하지 않는다.

## 6. 렌더링 기술과 좌표 설계

### 6.1 선택한 기술

| 선택지                       | 장점                                       | 제약                                           | 판단                               |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------- | ---------------------------------- |
| React Flow 커스텀 노드 + SVG | 기존 선택·이동·미니맵·맞춤과 연결하기 쉬움 | 회전·윤곽 히트 테스트는 추가 구현              | 권장                               |
| 하나의 Canvas 2D 그림판      | 많은 획을 한 번에 표시하기 유리            | 선택·좌표·접근성·레이어·히스토리를 크게 재구현 | P0에서 도입하지 않음               |
| 별도 편집기 엔진 삽입        | 완성된 벡터 편집 기능 확보 가능            | 기존 문서 캔버스와 자료/입력 체계가 중복       | 이번 기능 규모에 비해 변경 범위 큼 |

`ShapeNode`와 `StrokeNode`를 React Flow의 커스텀 노드로 등록한다. 도형은 `<rect>/<ellipse>/<polygon>/<path>`, 획은 `<path>`로 표시한다. 미완성 획과 선택 핸들은 `ViewportPortal`을 사용해 노드와 같은 이동·확대 좌표계에 둔다. 화면 좌표 변환에는 React Flow의 `screenToFlowPosition`을 사용한다. [S9][S10]

### 6.2 회전과 경계 상자

모델의 transform은 **회전 전 도형 상자의 좌상단 x/y, 폭/높이, 중심 기준 rotation**이다. 렌더러는 실제 도형을 중심 기준으로 회전한 뒤, 테두리·선 끝까지 포함한 축 정렬 경계 상자(AABB)를 계산한다.

React Flow 노드의 position/width/height에는 AABB를 사용하고 SVG 내부에서 실제 논리 도형을 배치한다. 드래그의 AABB 이동량만 모델 x/y에 더한다. 확대·선택 맞춤·미니맵에는 AABB를 사용한다. 역회전 좌표 변환으로 크기 핸들을 처리하며 크기 변경 중 반대쪽 기준점을 유지한다.

React Flow `NodeResizer`에는 비율 제한과 리사이즈 콜백이 있으나, 이 문서가 필요한 회전 도형의 좌표 처리를 자동 해결한다고 가정하지 않는다. P0 첫 기술 검증에서 무회전 객체의 재사용 여부를 확인하고 회전/선 끝점용 `DrawingTransformHandles`는 별도 구현한다. [S11]

SVG/노드 부모는 빈 사각형 영역이 클릭을 가로채지 않도록 pointer-events를 구성한다. SVG 도형/투명 히트 경로만 `pointer-events: stroke/fill` 등으로 활성화한다. SVG 속성과 CSS의 우선순위, React Flow 선택·드래그 이벤트가 함께 동작하는지는 실제 Electron에서 검증한다. [S13]

### 6.3 순서와 표시

기존 섹션 zIndex 0, 문서 2, HTML 창 3을 고려하여 그림은 `background` 대역 1–2 미만 또는 `annotation` 대역 4–5 미만에 배치한다. 도형 기본은 background, 펜·형광펜 기본은 annotation이다. 이 값은 모델의 layer/order를 화면용 zIndex로 변환하는 규칙이다.

`order`는 동일 대역 안의 순서다. 생성은 마지막에 추가하고 앞/뒤 이동은 서버 거래에서 최신 목록을 기준으로 순서를 계산한다. 같은 순위가 있으면 ID로 정렬한다. 대역 이동은 속성 메뉴에서 가능하며 카드 전체의 zIndex 모델은 변경하지 않는다. React Flow가 선택 시 적용하는 자동 순서 상승도 제어하여 저장된 순서와 맞춘다.

기본 도형은 연한 채우기 + 2 단위 테두리, 펜은 3 단위 검정, 형광펜은 16 단위 노랑/불투명도 0.3이다. 생성 기본값은 테마를 고려하지만 저장한 실제 색은 테마 변경으로 바꾸지 않는다. 크기 변경 시 선 굵기는 그대로 유지하며 속성 패널에서 별도로 변경한다. 투명도는 획 path 한 개에 적용해 한 획 내부 교차부가 반복 합성되지 않게 하고 다른 획과 겹치는 부분은 누적된다.

## 7. 자유 드로잉 처리

### 7.1 입력 → 프리뷰 → 확정

```text
pointerdown → 세션/시작점 고정 + capture
pointermove → 입력 샘플 수집 → rAF마다 프리뷰 갱신
pointerup → 마지막 샘플 포함 → 정규화/검증 → 객체 생성 1건 → 저장 큐
cancel → 프리뷰 제거, 확정 저장 없음
```

입력은 native PointerEvent의 좌표·pressure를 사용한다. `getCoalescedEvents()`가 있으면 병합 전 샘플을 사용하고, 없거나 빈 배열이면 현재 이벤트를 사용한다. 두 경로의 중복 샘플은 제거한다. API는 지원/보안 컨텍스트 조건이 있으므로 실제 Electron에서 feature detection으로 확인하며 필수 의존으로 두지 않는다. [S12]

포인터 이벤트마다 React 전체 노드 배열이나 디스크를 갱신하지 않는다. 세션 ref의 샘플 버퍼에 쌓고 rAF당 프리뷰 path만 갱신한다. 단일 클릭 펜은 점 하나를 원형 획으로 보존한다. 입력 허용·취소·저장 여부는 도형과 펜에 공통 적용한다.

### 7.2 획 생성 알고리즘

`perfect-freehand`의 `getStroke`를 선택 후보로 권장한다. 입력 점에서 획 외곽 polygon을 생성하고 압력·smoothing·streamline 등을 지원하며 MIT 라이선스다. 실제 채택 버전은 기술 검증 후 package-lock으로 고정한다. [S14]

- 마우스와 필압 꺼짐: pressure=0.5, `simulatePressure:false`, `thinning:0`으로 일정 굵기.
- 펜과 필압 켜짐: 장치 pressure 0–1을 저장하고 `simulatePressure:false`, `thinning:0.5`를 시작값으로 검증한다. 유효하지 않은 pressure만 0.5로 대체한다.
- 형광펜: 일정 굵기, `thinning:0`, 둥근 끝. 지우개 판정은 중심선과 반경을 사용한다.
- 초기 smoothing=0.5, streamline=0.3, taper=0. 값은 기술 검증 중 조정하고 확정된 renderer 버전을 기록한다.

저장 정본은 생성된 SVG 문자열이 아니라 로컬 좌표의 샘플 점과 스타일이다. geometry에는 원본 점의 기준 크기 `sourceWidth/sourceHeight`를 함께 저장한다. 크기 변경 때 현재 폭/높이로 점을 먼저 변환한 뒤 굵기를 유지한 상태로 외곽을 다시 계산한다. 점/수평선처럼 폭이나 높이가 0인 경우 기준 크기는 1로 정규화하고 실제 점 좌표를 유지한다.

필압 획은 좌표 오차만 보는 단순화로 필압 변화가 사라질 수 있다. 초기에는 중복점 제거와 경미한 근접점 병합만 적용하고, pressure 차이가 0.05 이상인 샘플·첫/끝점·급격한 방향 전환은 보존한다. 화면 기준 0.5px 상당 거리보다 가까운 점만 병합하되 제스처 시작 확대율로 캔버스 거리로 환산한다. 형광펜은 같은 규칙을 쓰고 pressure는 고정한다. 모든 임계값은 출력 품질 검증 대상으로 둔다.

최대 샘플에 도달하면 획을 안내 없이 잘라 저장하지 않는다. 경고를 표시하고, 포인터를 놓으면 현재 획을 저장할 수 있도록 추가 입력을 중지한다. 저장 용량 초과는 확정 거절과 초안 보존으로 처리한다.

외곽 path 캐시는 객체 ID, geometry 버전, transform 크기, stroke 스타일, renderer 버전으로 관리한다. 단순 이동·회전·다른 객체 변경 때 재생성하지 않는다. 브라우저 화면과 웹 뷰어는 같은 순수 기하 함수/고정 버전을 사용한다.

## 8. 데이터 모델과 파일 형식

### 8.1 저장 단위 결정

`.canvas/drawings/<canvas-id>.json`에 해당 캔버스의 도형·획을 함께 저장한다. 한 획당 Markdown/JSON 파일을 생성하지 않는다. 첫 객체 생성 시에만 파일을 만들며, 이후 빈 파일도 유지해 오프라인 최초 생성 병합과 히스토리를 단순화한다. 탭 자체가 삭제되면 대상 캔버스에 객체를 옮긴 뒤 소스 파일을 제거한다.

여기서 **디스크 저장 단위는 캔버스 파일, 편집·충돌 단위는 객체**다. 파일 전체를 덮어쓰는 저장 API를 클라이언트에 제공하지 않는다. 한 캔버스 파일의 크기/반복 저장 비용은 성능 검증의 주요 항목이며, 성능 기준을 못 맞추면 출시 전에 저장 분할 설계를 재검토한다.

### 8.2 타입 계약 초안

```ts
type DrawingTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // 0 <= rotation < 360
};
type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'line'
  | 'arrow';
type DrawingStyle = {
  fill: string | null; // #RRGGBB; 획/선/화살표는 null
  stroke: string | null; // #RRGGBB; 획은 반드시 색 지정
  strokeWidth: number;
  opacity: number;
  strokePattern: 'solid' | 'dashed';
};
type DrawingObjectBase = {
  id: string; // 프로젝트 안에서 유일한 UUID
  generation: string; // 삭제·복원·재생성 구분 UUID
  transform: DrawingTransform;
  style: DrawingStyle;
  layer: 'background' | 'annotation';
  order: number;
  createdAt: number;
  updatedAt: number;
};
type ShapeObject = DrawingObjectBase & {
  kind: 'shape';
  geometry: {
    shape: ShapeKind;
    cornerRadius?: number;
    endpoints?: [[number, number], [number, number]]; // 선/화살표, 상자 내 0–1 좌표
  };
};
type StrokeObject = DrawingObjectBase & {
  kind: 'stroke';
  geometry: {
    brush: 'pen' | 'highlighter';
    sourceWidth: number;
    sourceHeight: number;
    points: [number, number, number][]; // 로컬 x,y,pressure
    pressureEnabled: boolean;
    rendererVersion: 1;
  };
};
type DrawingObject = ShapeObject | StrokeObject;
type DrawingFile = {
  version: 1;
  canvasId: string;
  objects: DrawingObject[];
};
```

geometry는 종류별 schema로 검증한다. `endpoints`는 선/화살표만 필수이고 다른 도형에는 금지한다. 끝점은 정규화된 좌표라 폭/높이 변경 시 비율을 유지한다. 끝점 직접 드래그는 새 경계 상자를 구하고 transform과 geometry를 한 거래로 변경한다. `cornerRadius`는 둥근 사각형만 사용하며 실제 렌더링 반경은 폭/높이의 절반 이하로 제한한다. 저장 시 객체는 order/ID 기준 정렬, 키 순서는 serializer에서 고정하여 불필요한 blob 변경을 줄인다.

서버 리비전·속성 버전은 기존 sync 메타데이터에 드로잉 전용 `drawingVersions: Record<objectId, {generation, canvasId, groups}>`를 추가하여 관리한다. 기존 Markdown의 `PropertyVersions`와 키를 섞지 않는다. 객체 생성·이동·삭제와 버전 갱신은 같은 거래다. 삭제된 객체의 버전은 오래된 명령/undo 판정에 필요한 tombstone으로 보관한다. 로컬 단독 프로젝트도 같은 그룹 비교 함수를 사용한다. 필압 옵션·rendererVersion은 geometry에 속한다. 생성/수정 작성자는 기존 FileAuthorship의 actor 표현을 참고한 객체 메타데이터로 확장하고 캔버스 파일 작성자와 구분한다.

### 8.3 제안 제한과 검증

| 항목           | P0 제안                                                |
| -------------- | ------------------------------------------------------ |
| JSON 파일      | UTF-8 2,000,000 bytes 이하; 기존 일반 파일 제한 적용   |
| 캔버스 객체    | 최대 1,000개; byte 제한이 먼저 적용될 수 있음          |
| 한 획 입력 점  | 최대 5,000개                                           |
| 캔버스 전체 점 | 최대 50,000개; byte 제한과 함께 검사                   |
| 좌표/크기      | finite 값, 좌표 절댓값 1,000,000 이하, 크기 1–100,000  |
| 스타일         | strokeWidth 0.5–128, opacity 0–1, 허용된 HEX 색/null   |
| 캔버스/ID      | 존재하는 캔버스, 안전한 파일명 ID, 객체 UUID 중복 금지 |
| 공유 프로젝트  | 기존 전체 500개 파일·20MB 유지; 새 JSON도 합산         |

한 프로젝트에 100개 탭이 있으면 최대 100개의 새 파일이 추가될 수 있으므로 공유 한도 UI에서 이를 함께 계산한다. 객체 1,000개 또는 점 50,000개를 항상 저장할 수 있다는 보장은 없다. 바이트 한도를 더 먼저 초과하면 생성/붙여넣기 전에 안내한다.

도형/획 경로는 schema에서 만든다. 임의 SVG/HTML, 외부 URL, script, `foreignObject` 입력은 저장 형식에서 받지 않는다. P0 형식의 채우기/테두리가 모두 없거나 opacity=0인 객체는 표시 불능 상태이므로 속성 변경 시 안내하고 객체 목록에서 선택·삭제할 수 있게 한다.

## 9. 명령·저장·히스토리 계약

### 9.1 공통 명령

신규 API 이름은 구현 제안이며 기존 API로 존재하지 않는다.

```ts
listDrawings(canvasId): Promise<DrawingObject[]>;
applyDrawingCommand(command): Promise<DrawingCommandResult>;
flushDrawingChanges(scope): Promise<void>;

// applyDrawingCommand의 action
// create | patch | delete | duplicate | reorder | moveCanvas
```

공통 envelope에는 `requestId`, `sessionId`, `localSeq`, 프로젝트 `scope`, `canvasId`, `drawingVersion:1`, 객체 대상 `{id,generation}`, 변경 그룹과 예상 버전을 둔다. patch는 허용된 필드만 받는다. 생성 ID와 requestId는 첫 시도 전에 고정하여 재전송 때 그대로 사용한다. 응답은 거래 리비전, 변경 객체/삭제 ID, 그룹 버전, 히스토리 ID를 반환한다.

그룹은 `transform`, `style`, `geometry`, `layerOrder`, `structure`다. transform은 x/y/폭/높이/회전을 하나로 묶어 선 좌표계가 갈라지지 않게 한다. style은 색/두께/불투명도/선 패턴을 하나로 묶고 서로 다른 객체의 style은 독립 처리한다. 구조 그룹은 생성·삭제·캔버스 이동·generation 변경이다.

일반 patch의 transform/style은 generation과 구조 버전을 확인한 뒤 서버 확정 순서를 적용한다. geometry 편집·복원·구조 명령은 예상 버전 일치를 요구한다. undo와 오프라인 병합에서는 모든 관련 그룹의 예상 값을 비교한다. 변환 핸들처럼 transform+geometry를 함께 바꾸는 명령은 두 그룹을 묶어 검사한다. 어떤 경우에도 요청에 없는 그룹을 덮어쓰지 않는다.

### 9.2 저장과 큐

- renderer는 confirmed/pending/in-flight를 구분한다. 오래된 응답이 이후 입력을 해제하거나 위치를 되돌리지 못하게 localSeq를 확인한다.
- `PropertyQueue`의 키를 프로젝트+객체+그룹으로 잡는다. 전송 전 같은 그룹 변경은 합치고 전송 중 명령은 불변 사본을 유지한다.
- 획 생성과 지우개 삭제는 합치기 대상이 아니다. 순서대로 보존한다. 스타일 패널 드래그는 약 150ms 합치기와 pointerup 즉시 flush를 시작값으로 사용한다.
- 메인 프로세스의 mutation queue에서 마지막 권한·scope·예상 버전을 검사하고 reducer로 최신 파일에 변경을 적용한다. 로컬 JSON은 임시 파일 기록 후 교체한다.
- 공동 프로젝트는 SQLite 거래 확정 이후 성공으로 표시한다. JSON blob·그룹 버전·명령 중복 결과·히스토리를 같은 거래에 기록한다.
- pointerup 뒤 확정 대기 객체는 별도 로컬 초안에 즉시 기록 요청한다. 진행 중 획은 최대 300ms 주기로 보관한다. 정상 취소는 초안을 제거하고 강제 종료 복구는 사용자가 복원/버리기를 선택한다.
- 일반 저장 종료·프로젝트/탭 전환·앱 종료·업데이트 재시작은 완료된 명령과 초안 기록을 flush한다. 갑작스러운 종료 시 마지막 초안 기록 이후 미완성 샘플은 일부 유실될 수 있다.
- 저장 실패 시 화면의 pending 객체와 초안을 유지하고 저장 재시도/오류 이유를 보여준다. 숨겨진 자동 데이터 삭제나 확정된 것으로 표시하는 동작은 금지한다.

### 9.3 실행 취소와 복원

한 획 추가, 한 도형 추가, 한 번 이동/크기 변경/회전, 한 번 지우개 스윕을 각각 하나의 기록으로 만든다. 기존 클라이언트별 journal에 연결하여 팀원의 작업은 취소하지 않는다.

`mergeProperties`의 드로잉 분기는 파일 전체가 아니라 변경 객체/그룹의 expected/current를 비교한다. 다른 객체 또는 다른 그룹의 변경은 보존하며 같은 그룹의 후속 변경은 거절한다. 여러 객체를 묶는 역변경은 검증 전부 통과 후 원자적으로 적용한다.

특히 첫 획을 취소할 때, 이후 팀원이 같은 파일에 추가한 획을 파일 삭제로 함께 지우면 안 된다. expected/desired의 파일 부재는 객체 목록이 빈 상태로 해석하여 해당 객체만 역변경한다. 삭제 복원은 같은 객체 ID를 사용하되 새 generation을 발급하여 오래된 patch가 복원 객체를 바꾸지 못하게 한다. journal의 다음 redo/undo 기대값도 복원 응답 기준으로 갱신한다.

프로젝트 전체 히스토리 복원은 기존 복원 정책을 유지한다. 단일 객체 undo와 전체 스냅샷 복원을 명확히 구분하여 사용자가 팀원 작업까지 되돌리는 상황을 확인할 수 있게 한다.

## 10. 협업·오프라인·호환성

### 10.1 동시 변경 규칙

| 상황                              | 결과                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| A/B가 서로 다른 획 생성           | 같은 JSON 파일에서도 둘 다 보존                                   |
| A가 객체1 이동, B가 객체2 색 변경 | 둘 다 보존                                                        |
| A가 객체1 이동, B가 객체1 색 변경 | transform/style 독립 그룹으로 병합                                |
| A/B가 같은 객체 transform 변경    | 기존 배치 속성처럼 서버 확정 순서 사용; 순번과 최신 pending 반영  |
| A/B가 같은 객체 style 변경        | 서버 확정 순서; 상대의 이후 style은 자신의 undo에서 덮어쓰지 않음 |
| 삭제/이동 뒤 오래된 patch         | generation/structure 버전 검사로 거절                             |
| 객체 reorder 동시 요청            | 현재 목록에서 대상/기준 객체가 유효한지 검사하고 서버 순서로 확정 |
| viewer 또는 권한 회수             | 서버에서 생성·변경·삭제 거절; 미확정 초안 보존                    |

P0에서는 그리는 도중 팀원에게 실시간 포인터 점을 전송하지 않는다. 완성된 획은 거래 확정 후 기존 SSE 변경 신호·조회 흐름으로 전달한다. 라이브 획 프리뷰는 후속에서 별도의 일시 데이터로 추가할 수 있다.

### 10.2 객체별 변경분과 저장 비용

현재 파일 변경분 API에 JSON 파일을 그대로 넣으면 새 획 하나마다 캔버스 JSON 전체를 내려받게 된다. P0에서 drawingVersion을 지원하는 클라이언트용 `drawingChanges` 표시용 변경분을 추가한다.

- 최초 조회·변경 기록 누락 복구는 전체 DrawingFile.
- 일반 응답은 생성/변경 객체만 + 삭제 ID + 파일/객체 리비전.
- 렌더러 캐시는 객체별 patch로 갱신한다. 실제 파일 사본은 기존 materialize 흐름처럼 필요한 시점에 준비하며, 서버 정본 파일과 변경분 투영 결과의 일치를 검증한다.
- 서버의 content-addressed blob 저장 자체는 캔버스 파일 전체다. 따라서 네트워크 응답을 줄여도 서버 해시 계산·blob/히스토리 증가량은 남는다. 최대 용량에서 저장 시간·디스크 증가량을 반드시 측정한다.
- 거래 로그에는 drawing 객체 변경 내역을 포함하여 최근 거래 조회가 표시용 patch를 재구성할 수 있게 한다. 기록 범위를 벗어나면 기존 전체 복구 정책으로 전환한다.

### 10.3 오프라인 병합

base/local/server를 객체 ID와 generation 기준으로 비교하는 `mergeDrawingFile`을 추가한다. 파일 부재는 빈 목록으로 해석해 양쪽의 첫 생성도 병합한다. 서로 다른 객체 추가와 독립 그룹 변경은 보존한다. 같은 그룹의 서로 다른 수정·삭제 대 수정·같은 ID의 다른 생성은 충돌이다.

온라인 배치의 서버 순서 정책을 오프라인 충돌에 그대로 적용하지 않는다. 오프라인에서 판단할 수 없는 같은 그룹 수정은 서버/로컬을 모두 보관하고 객체별 비교 UI를 제공한다. `서버 유지 / 내 변경 유지 / 내 그림을 새 ID로 복제`를 선택할 수 있다. 해결 시 파일 전체가 아니라 해당 객체에만 결정을 적용한다.

오프라인에서는 기존 캔버스에서 그림 추가·속성 변경·삭제를 허용한다. 캔버스 이동·탭 삭제와 같은 구조 작업은 기존 정책대로 온라인·동기화 완료 상태에서만 허용한다. 이미 서버에서 삭제된 탭의 오프라인 그림은 버리지 않고 복구 대상 탭을 고르게 한다.

### 10.4 기능 협상과 기존 프로젝트

- 서버 health/state에 `drawingsVersion:1` capability를 추가한다. 클라이언트 명령에도 버전을 포함한다.
- 첫 드로잉 파일 생성 시 프로젝트의 최소 쓰기 계약을 갱신한다. 드로잉 프로젝트에서는 구버전 클라이언트의 전체 사본 업로드·AI 완료 사본·오프라인 병합·히스토리 복원도 모두 검사하여 새 파일 유실을 막는다.
- 새 앱+구서버에서는 공동 프로젝트 드로잉 편집을 막고 서버 업데이트 이유를 안내한다. 그림이 없는 기존 프로젝트는 기존 편집을 유지한다.
- 파일이 없는 프로젝트는 빈 그림 목록으로 해석하고 일괄 변환하지 않는다. 알 수 없는 파일 version·손상된 JSON은 원본을 보존하고 읽기 오류와 복구 경로를 안내한다. 빈 그림으로 덮어쓰지 않는다.
- 쓰기 가능한 새 앱과 서버를 함께 검증·배포한다. 롤백 전 새 JSON을 포함한 전체 사본을 보관하고 구형 서버/앱으로 해당 프로젝트를 쓰지 못하게 한다.

## 11. 캔버스·섹션·AI·웹 보기 연동

### 캔버스와 섹션

그림의 캔버스 소속은 파일의 canvasId가 정본이다. 다른 탭으로 이동할 때 양쪽 JSON과 소속 구조를 한 거래로 갱신하고 좌표·ID를 유지한다. 캔버스 삭제는 기존 UI에서 선택한 대상 탭으로 모든 그림을 옮긴 후 원본 파일·탭을 제거한다. 대상 객체 수/바이트 제한을 초과하면 전체 작업을 거절한다.

P0 그림은 섹션의 논리 멤버가 아니다. 섹션과 시각적으로 겹쳐도 섹션 이동/삭제에 따라 함께 이동/삭제되지 않는다. 이 제한은 섹션 포함 메뉴와 안내에 표시한다. 그림이 섞인 선택에서 기존 `섹션 만들기`는 자료만 포함한다는 설명을 제공한다. 섹션 소속이 필요해지면 P1에서 `{kind,id}` 형태 멤버 참조로 기존 path 기반 모델을 확장한다.

파일과 그림의 혼합 선택은 공통 selection ref(`document/section/preview/drawing`)로 분기한다. 다른 탭 이동·복제·삭제가 지원되는 대상인지 미리 검사하고 모두 성공 또는 모두 실패로 처리한다. 파일 복사만 수행하고 그림이 누락되는 부분 성공은 허용하지 않는다.

### AI 입력

P0에서는 도형/획을 AI 입력 목록에 자동으로 추가하지 않는다. 해당 자료가 입력 대상이 아니며 아직 지원되지 않는다는 안내를 gamejam! 재료 선택에 표시한다. AI staging·capture·결과 병합에서는 그림 JSON을 보존하고, AI가 입력으로 받지 않은 JSON의 수정/삭제는 거절한다. 프로젝트 전체 복사/백업에는 포함한다.

P1은 선택한 그림의 정적 SVG/PNG와 위치/종류 설명을 작업 범위 안에 생성하는 방식을 검토한다. 그때 지원하는 모델의 이미지 입력 경로·잠금·인접 자료 보호·아티팩트 저장을 별도 명세로 확정한다. 편집 중인 캔버스 전체를 매번 이미지로 넘기는 방식은 채택하지 않는다.

### 웹 보기와 F12

`WebProject`에 별도 drawings 배열을 추가하고 현재 캔버스 필터·표시 순서·맞춤 범위에 반영한다. worker와 Electron이 같은 기하 코드/rendererVersion을 사용한다. 웹 뷰어는 선택·탐색·보기만 제공하고 쓰기 API를 추가하지 않는다. 기존 재게시/동기화 정책에 따라 새 그림이 표시된다.

F12에 도형 메뉴, 펜 설정, 속성 패널, 회전 선택, 지우개, 저장 실패, 구서버, viewer, 오프라인 충돌의 상태 프리셋을 등록한다. 미리보기는 표시 컴포넌트를 재사용하고 실제 파일 쓰기·협업 연결을 수행하지 않는다. object 이름/종류·aria-label·키보드 포커스·패널 숫자 입력을 제공한다.

## 12. 파일별 구현 계획

아래 신규 파일 이름은 제안이다. 단계별로 역할을 합칠 수 있지만 브라우저 기하 코드에는 Node/Electron 의존성을 넣지 않는다.

| 파일                                                                                                     | 구현 내용                                                                                           |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 신규 `src/drawing-types.ts`                                                                              | 객체/schema/명령/그룹 타입                                                                          |
| 신규 `src/drawing-model.ts`                                                                              | 파싱·직렬화·검증·객체 CRUD reducer                                                                  |
| 신규 `src/drawing-geometry.ts`                                                                           | 도형 path, 회전 AABB, 좌표 변환, 히트/지우개 판정                                                   |
| 신규 `src/drawing-strokes.ts`                                                                            | 획 생성·샘플 정규화·rendererVersion 캐시                                                            |
| 신규 `src/drawing-merge.ts`                                                                              | 객체/그룹 diff, 조건부 역변경, 3방향 병합                                                           |
| 신규 `src/drawing-save-queue.ts`                                                                         | 생성 보존·그룹 합치기·scope·순번·초안                                                               |
| 신규 `src/ui/drawing/*`                                                                                  | DrawingToolbar, ShapeNode, StrokeNode, DrawingInputLayer, DrawingInspector, DrawingTransformHandles |
| `src/ui/App.tsx`                                                                                         | 도구/노드/혼합 선택/레이어/탭 전환 연결; 입력 코드는 새 hook으로 분리                               |
| `src/index.css`, `src/canvas-ux.ts`                                                                      | SVG·핸들·히트 영역·단축키·포커스 표시                                                               |
| `src/shared.ts`, `src/preload.ts`, `src/main.ts`, `src/dev-api.ts`                                       | 신규 IPC 계약·로컬 reducer·watcher·대기 저장·모의 API                                               |
| `src/project-store.ts`, `src/collaboration-model.ts`                                                     | 새 파일 capture/materialize/history·경로/schema·snapshot 검증                                       |
| `src/sync-properties.ts`, `src/edit-journal.ts`, `src/offline-sync.ts`                                   | JSON 전용 diff/undo/merge 분기·파일 부재 처리                                                       |
| `src/canvas-sheet-commands.ts`                                                                           | 객체 이동·캔버스 삭제 원자성·용량 검증                                                              |
| `src/collaboration-client.ts`, `src/collaboration-server.ts`, `src/sync-store.ts`, `src/client-cache.ts` | capability·중복 처리·객체 버전·drawingChanges·재접속·캐시                                           |
| `src/ui/CanvasMiniMapNode.tsx`, `src/canvas-view.ts`, `src/new-document-layout.ts`                       | 그림의 bounds를 미니맵/맞춤/새 자료 배치에 포함                                                     |
| `src/ai-file-lock.ts`, `src/ai-artifacts.ts`, AI staging 관련 `src/main.ts`/서버 경로                    | 기존 AI 입력/보호 정책에서 그림 파일 보존·무단 변경 검사                                            |
| `src/web-viewer.ts`, `tools/web-viewer/worker.ts`                                                        | 읽기 전용 drawing 투영·렌더러 공유                                                                  |
| `src/ui/debug/*`                                                                                         | 실제 UI 목록·fixture·상태 프리셋                                                                    |
| `tests/*`, 사용자 안내 문서                                                                              | 기하/거래/병합 테스트·실제 Electron fixture·단축키·저장 구조 안내                                   |

## 13. 구현 순서와 단계별 완료 조건

| 단계              | 작업                                                                     | 다음 단계로 넘어가는 조건                                                    |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1. 기술 검증      | SVG 커스텀 노드, 카드/iframe 위 입력, 비율 생성, 회전 AABB·핸들, 펜 샘플 | Electron 확대 0.15/1/2에서 좌표·선 끝·선택/드래그 검증; 의존성/renderer 고정 |
| 2. 모델·저장 기반 | schema·reducer·capture·watcher·JSON 역변경·초안·객체 명령                | 기존 프로젝트 무변경, 로컬 추가/재열기/undo, 손상 파일 보존                  |
| 3. 편집 UI        | 도형·펜·형광펜·지우개·속성·회전·복사·혼합 선택                           | P0 단독 사용 흐름과 한 제스처 한 기록 검증                                   |
| 4. 협업           | capability·객체 버전·변경분·3방향 병합·원자 탭 이동                      | 서로 다른 획 보존·유실 응답 재시도·권한·undo 충돌 검증                       |
| 5. 기존 기능 연동 | AI 보호·웹 보기·미니맵·F12·문서·패키지                                   | 새 자료가 경로별로 빠짐없이 보존/표시됨                                      |
| 6. 출시 검증      | 기존 회귀 검사·성능·실제 Windows 패키지·서버 번들                        | 아래 수용 기준 만족 후 배포 준비 완료                                        |

작업량은 기존 JSON 병합과 회전 선택 UX를 추가하는 단계가 가장 크다. 단순 “도형 버튼 추가”보다 저장·협업 통합이 많은 기능이므로 기술 검증 후 일정과 작업 단위를 확정한다. P1/P2는 P0 출시 조건에 끼워 넣지 않는다.

## 14. 검증·수용 기준

### 기능·데이터 검사

1. 7종 도형을 클릭/네 방향 드래그로 생성하고 Shift/Alt가 동작한다. 선/화살표의 시작 방향이 보존된다.
2. 펜 점 1개·짧은 획·긴 획·형광펜이 저장 후 같은 모양으로 표시된다. 필압 지원/미지원 입력 모두 처리한다.
3. 확대 0.15/0.5/1/2, 패닝, 창 크기/DPI 변경 후 포인터 위치와 도형/획 위치가 일치한다.
4. 회전 0/45/90/359°에서 선택·크기 변경·선 끝점·맞춤·미니맵이 표시 영역과 일치한다.
5. 드로잉 모드의 카드/iframe 위 그리기, 선택 모드의 빈 도형 내부 클릭 전달, 실제 윤곽 선택이 동작한다.
6. 캔버스 밖에서 pointerup, Esc, capture 상실, 창 focus 상실은 중복 저장/유령 획을 만들지 않는다.
7. 획 1개·지우개 스윕·이동 제스처의 undo는 1회다. 서로 다른 객체/그룹의 팀원 변경을 유지한다.
8. 파일이 처음 없던 양쪽 클라이언트가 각각 획을 만들고 병합하면 둘 다 남는다. 첫 획 undo도 팀원 획을 유지한다.
9. 200/500/1500ms 응답 지연과 응답 유실·동일 requestId 재시도에서 중복 객체·위치 되돌아감이 없다.
10. 권한 변경·삭제 후 오래된 patch·구앱 업로드·AI 완료 사본·구형 복원 경로는 새 그림을 유실시키지 않는다.
11. 탭 이동/삭제·혼합 선택 거래·용량 초과는 전부 적용 또는 전부 거절이다. 그림과 무관한 파일 바이트를 보존한다.
12. 정상 종료/재열기·강제 종료 초안 복구·백업/히스토리·웹 게시 사본에 그림 파일이 포함된다. 손상 JSON을 빈 파일로 바꾸지 않는다.
13. viewer·gamejam! 실행·한글 조합·문서 본문 undo·게임 단축키와 새 도구 입력이 충돌하지 않는다.

신규 순수 함수 검사는 `drawing-model`, `drawing-geometry`, `drawing-merge`, `drawing-save-queue` 중심으로 작성한다. 실제 Electron fixture에서 Pointer Events·SVG hit test·iframe·회전·DPI·초안 복구를 검사하고 임시 협업 서버의 2명/5명 시나리오를 실행한다. 사용자 운영 프로젝트로 검증하지 않는다.

### 성능 목표 — 측정 전 제안값

자료 조건은 메모 100개, HTML 10개(각 500KB), 도형 300개, 획 500개(평균 80점), 2개 캔버스다. 파일/점/바이트 제한을 모두 만족하는 fixture를 생성한다. CPU/RAM/GPU·디스플레이 주사율·Electron/OS 버전·활성 HTML 게임 수를 결과에 기록한다.

| 측정                 | 목표                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| 로컬 드로잉 프리뷰   | 60Hz 기준 프레임 간격 p95 ≤ 20ms                                       |
| 포인터 → 화면 반영   | p95 ≤ 35ms                                                             |
| 획 종료 후 로컬 확정 | p95 ≤ 300ms; 초안 기록 완료/정본 저장 완료를 분리 측정                 |
| 변경분 응답          | 80점 획 1개 추가 ≤ 20KB; 파일 전체/무관한 HTML 생략                    |
| 임시 로컬 서버 5명   | 거래 확인 p95 ≤ 300ms; 인터넷 지연 포함 보장 아님                      |
| 리렌더링             | 다른 객체 변경 시 기존 획 외곽 계산 횟수 0                             |
| 장시간 작업          | 30분 생성/삭제/undo 반복 후 캐시·리스너·초안 파일이 계속 증가하지 않음 |

2MB 근접 캔버스도 별도로 검사한다. 전체 JSON 직렬화/해시·blob 누적·히스토리 증가·최초 열기 지연을 기록한다. 목표를 못 맞추면 샘플 정규화/표시 캐시/저장 큐를 먼저 조정하고, 그래도 실패하면 안정된 shard 파일이나 객체 저장소 설계로 변경한 뒤 병합·복원 검증을 다시 한다. 현재 성능 수치를 이미 달성한 것처럼 안내하지 않는다.

최종 구현에서는 `npm run typecheck`, `npm run lint`, `npm test`, 관련 Electron UI 검사, `npm run test:integration`, 웹 뷰어/협업 서버 build와 Windows 패키지 검증을 수행한다. 이 문서 작성 시점에는 실행 코드를 변경하지 않았으므로 해당 구현 검사는 수행하지 않았다.

## 15. 핵심 위험과 결정

| 위험                                    | 설계 대응                                                     |
| --------------------------------------- | ------------------------------------------------------------- |
| 획마다 파일이 늘어 500개 공유 한도 도달 | 캔버스별 JSON, 기존 프로젝트 합산 제한 유지                   |
| 같은 JSON의 서로 다른 획이 충돌         | 객체·그룹별 reducer/undo/3방향 병합을 P0에 포함               |
| JSON 전체가 반복 전송/저장됨            | 표시용 객체 patch; 디스크 blob 비용은 별도 성능 검증          |
| 회전 후 리사이즈·선택이 어긋남          | 논리 transform과 AABB 분리, 역회전 핸들·실제 Electron 검사    |
| 도형과 카드/게임 입력 충돌              | 도구 모드별 입력 레이어·윤곽 hit test·포커스 제한             |
| 구앱/AI/백업에서 새 자료 누락           | capture·경로 계약·capability·완료 사본·복원 검사              |
| 저장 지연/실패 때 그린 자료 손실        | pending/in-flight/confirmed 분리, 로컬 초안, 동일 명령 재시도 |
| 비트맵 그림판/벡터 편집기로 범위 확대   | P0/P1/P2 분리; 첫 출시도 저장·협업은 완료                     |

구현 착수 시 필요한 기본 결정은 이 명세에 제안값으로 지정했다. 사용자 확인을 기다려야만 시작할 항목은 없으며, 필압 라이브러리·회전 핸들 구현·최대 용량에서의 저장 비용은 1단계 기술 검증 결과로 최종 확정한다.

## 16. 조사 출처

아래 자료는 2026-10-11에 확인했다. 제품별 사용 패턴의 근거이며, Game Jam!의 우선순위·API·저장 포맷·제한값·성능 목표는 이 문서의 설계 제안이다.

- [S1: Figma — Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- [S2: Figma — Sketch on the canvas with the pencil tool](https://help.figma.com/hc/en-us/articles/4402723791511-Sketch-on-the-canvas-with-the-pencil-tool)
- [S3: Figma — Apply and adjust stroke properties](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
- [S4: Microsoft — Add shapes](https://support.microsoft.com/en-us/powerpoint/add-shapes)
- [S5: Microsoft — Draw or edit a freeform shape](https://support.microsoft.com/en-us/office/draw-or-edit-a-freeform-shape-44d7bb9d-c05c-4e1c-a486-e35fc322299b)
- [S6: Microsoft — Draw and write with ink in Office](https://support.microsoft.com/en-us/office/draw-and-write-with-ink-in-office)
- [S7: Microsoft — Change handwritten ink to shapes, text, or math in PowerPoint for Microsoft 365](https://support.microsoft.com/en-us/powerpoint/change-handwritten-ink-to-shapes-text-or-math-in-powerpoint-for-microsoft-365)
- [S8: Microsoft — Align or arrange objects](https://support.microsoft.com/en-us/office/graphics-visuals/align-or-arrange-objects)
- [S9: React Flow — ReactFlowInstance](https://reactflow.dev/api-reference/types/react-flow-instance)
- [S10: React Flow — ViewportPortal](https://reactflow.dev/api-reference/components/viewport-portal)
- [S11: React Flow — NodeResizer](https://reactflow.dev/api-reference/components/node-resizer)
- [S12: MDN — PointerEvent.getCoalescedEvents](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)
- [S13: MDN — SVG pointer-events](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/pointer-events)
- [S14: perfect-freehand — 공식 저장소·사용법·라이선스](https://github.com/steveruizok/perfect-freehand)
- [S15: MDN — Using Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events)

저장소 근거는 3절의 코드와 `CANVAS_SHEETS.md`, `COLLABORATION_SYNC.md`, `AUTOSAVE_QUEUE.md`를 사용했다.

[S1]: https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools
[S2]: https://help.figma.com/hc/en-us/articles/4402723791511-Sketch-on-the-canvas-with-the-pencil-tool
[S3]: https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties
[S4]: https://support.microsoft.com/en-us/powerpoint/add-shapes
[S5]: https://support.microsoft.com/en-us/office/graphics-visuals/draw-or-edit-a-freeform-shape
[S6]: https://support.microsoft.com/en-us/office/draw-and-write-with-ink-in-office
[S7]: https://support.microsoft.com/en-us/powerpoint/change-handwritten-ink-to-shapes-text-or-math-in-powerpoint-for-microsoft-365
[S8]: https://support.microsoft.com/en-us/office/graphics-visuals/align-or-arrange-objects
[S9]: https://reactflow.dev/api-reference/types/react-flow-instance
[S10]: https://reactflow.dev/api-reference/components/viewport-portal
[S11]: https://reactflow.dev/api-reference/components/node-resizer
[S12]: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
[S13]: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/pointer-events
[S14]: https://github.com/steveruizok/perfect-freehand
[S15]: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events

## 실제 구현 기록 — 2026-10-12, v0.14.0

기본 도형 7종·펜·형광펜·획 지우개, 생성/변형/스타일, 혼합 선택 거래와 히스토리, 개인 초안, 객체별 병합, 협업 델타, 캔버스 이동/삭제, AI 보호, 웹 게시용 SVG와 F12를 구현했다. 전달한 API·파일 형식·사용법·현재 한계는 [구현 및 사용 안내](SHAPES_DRAWING.md)를 기준으로 확인한다.

명세의 전용 tombstone/속성 버전 테이블 대신 기존 명령 ID·generation·조건부 병합을 사용한다. 오프라인 충돌의 선택 단위는 캔버스 파일이며 독립 객체/속성 변경은 양쪽 선택에 함께 유지한다. 최대 용량 성능 보증, 영속 사용자 프리셋, 객체별 충돌 개별 선택과 후속 도구는 아직 포함하지 않았다.
