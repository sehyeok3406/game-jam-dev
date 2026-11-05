# 캔버스 표시 성능

2026-11-05에 별도 성능 작업을 v0.44.1 이후 소스에 통합했다. 위치/문단 링크, HTML 원본 제작·내보내기와 수동 링크 UI 제거를 유지한다. 파일·권한·히스토리 계약은 바꾸지 않는다.

## 소유 경계

- React Flow가 연속 카메라를 소유한다. WorkspaceScreen과 노드 전체 조립은 배율을 상태/입력으로 받지 않는다. 숫자와 선택 핸들은 `useCanvasZoom`, hit path는 `CanvasZoomStyle`의 제한된 CSS 규칙을 사용한다.
- `CanvasNodeModels`는 작은 필드와 참조를 비교하고 안정된 콜백이 현재 방문·generation·권한을 사용하도록 한다. editor/gesture cleanup은 기존 소유자를 정리한다. 변경 없는 DTO는 core의 `retainUnchangedRecords`로 참조를 유지한다.
- core/canvas는 격자와 실제 사각형 조회, 준비/유지 범위, 상세도/우선순위를 계산한다. DOM·타이머·React Flow는 UI가 소유한다. 섹션 자식은 절대 좌표를 사용한다.
- `CanvasViewportStore`는 camera-only 변경에서 geometry/본문 전수를 다시 읽지 않는다. 현재 화면, 주변 512px, 더 넓은 1024px/750ms 유지 범위를 사용하고 방문을 기존 SelectionScope/useViewLifetime으로 구분한다.
- 준비 큐는 대기 32개·비동기 2개로 제한한다. 이동 중 1 slice/2ms, 정지 시 4 slices/4ms 예산을 사용하되 시작한 동기 파싱을 강제로 선점하지 않는다. 이전 scope·revision·등록 소유자·더 이상 필요한 대상이 아닌 결과를 버린다.
- 방문별 LRU 캐시는 128개/추정 32MiB다. Markdown tree, 읽기 텍스트 HTML, 정확한 SVG 경로와 최대 768px 이미지 preview를 재사용한다. 원본·활성 DOM·편집기·GPU는 별도이며 총 앱 메모리 상한이나 파일 페이징이 아니다.
- 편집·초안·IME·포커스·제스처·단일 선택을 보호한다. 다중 선택만으로 대기 텍스트 편집기나 먼 상세 DOM을 전부 생성하지 않는다. DOM 기반 전체 찾기가 열린 동안은 본문을 준비한다.
- 문단 앵커 플러그인과 공유 링크 URL 처리는 캐시 processor에도 동일하게 적용한다. 본문 문맥 메뉴와 복사 명령은 현재 context를 사용한다. 위치 링크의 카메라 intent/취소와 LocationSharingContext를 유지한다.
- HTML iframe은 범위/배율 때문에 다시 만들지 않는다. memo frame과 document별 source/controls-ID 이벤트 라우팅을 사용하고 고정 전체화면에서만 크기를 관찰한다. GameBuildSummary·내보내기 상태는 유지하며 역링크 구독만 작은 자식으로 분리한다. 임의 게임의 실행 자동 정지는 제공하지 않는다.
- HTML 창 설정의 이름 이력은 기존 ProjectTextFiles로 필요한 파일만 읽는다. 창마다 전체 프로젝트/이미지를 capture하지 않으며 ID/legacy fallback·잠금·mutation 큐·세션 검증은 유지한다.

## 검증 연결

공간·범위·스케줄·캐시·노드 identity·callback·iframe 이벤트 단위 검사와 `test:camera:ui`를 사용한다. 통합 시 대표 Markdown/혼합 장면만 측정하고 `test:location-links:ui`로 앵커·직접 이동·복사·수동 UI 부재를 확인한다. 실제 패키지에서는 기존 `test:location-links:packaged`로 종료/실행 중 OS 링크 수신·문단/텍스트/HTML 이동을 확인하고, app.asar에 상세 표시 코드가 포함됐는지 빌드 소스와 대조한다.

새 공유 계약과 아키텍처 예외는 없다. 대량 실행 HTML과 최초 동기 파싱·전체 원본 메모리 비용은 남는다. RAF 간격은 물리 화면 표시 지연이나 모든 PC의 FPS 보장이 아니다. 커밋·배포 전에는 별도 작업 브랜치의 결과와 실제 배포 결과물의 포함 여부를 구분한다.
