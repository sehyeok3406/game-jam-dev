# 다중 드래그 성능 개선 검증

2026-10-29. 배포 기준 v0.38.4, 원격 v0.38.3 이후 코드에서 구현했다. 기존 C:/git/game-jam-dev의 별도 미커밋 작업은 변경하지 않았다.

## 구현

- 각 노드의 좌표 props와 내용 렌더를 분리했다. 문서/섹션/HTML/그림/텍스트/게임 UI/칸반의 실제 내용은 사용하는 입력만 받는다. 내부 상태와 Context는 계속 갱신된다.
- 리사이즈/게임 UI inspector Context와 개인 설정 갱신 콜백을 안정화했다. 선택 ID/data 파생 값 및 빈 가이드 갱신도 재사용한다.
- HTML 드롭은 기존 일괄 helper로 처리하고 늦은 응답은 창별 sequence로 거른다. 기존 저장·충돌·Undo·프로젝트 수명 경계를 유지한다. 이동 중 저장·복구 초안은 추가하지 않았다.

## 확인한 결과

- 20/100/300개 실제 마우스 이동을 각 3회 검사했다. 이동 중 Markdown 렌더 0회, 저장 0회, 드롭 배치 1회 및 전체 선택의 동일 이동량을 확인했다.
- 개발/offscreen 환경의 임시 memo 해제 비교에서 100개 p95 프레임 간격은 183~200ms, 개선 버전은 17~67ms였다. 300개는 200~283ms에서 83~200ms였다. 짧은 구간/표본 수 차이가 있으므로 배포 FPS나 속도 배수 보장으로 해석하지 않는다. 300개에서는 상위 화면·노드 처리 비용이 남는다.
- root/contracts/core 타입 검사 통과. 전체 lint/서식 검사 통과(기존 mock의 no-this-alias 경고 1개).
- 전체 자동 검사 1,023개 중 1,022개 통과, 호스트 테스트 1개는 신규 체크아웃의 서버 번들 부재로 실패했다. package가 런타임을 준비한 뒤 해당 suite 5/5가 통과했다. 최종 Context 변경 관련 단위 회귀 51/51도 통과했다.
- 실제 Electron 선택 취소, 게임 UI 조작/범위/Undo/inspector, 도형 입력/resize/rotate/취소/실패재시도, 문서 링크, 실제 HTTP/SSE 저장과 연속 입력·포커스 검사를 통과했다.
- 최종 Windows package에서 문서 100개 포인터 드래그, 5초 이상 이동 중 파일/히스토리 무변경, 드롭 한 history 배치, Undo/Redo, 완전 재시작 후 좌표, 본문/custom metadata 보존을 확인했다.
- 최종 package의 기존 R04 검사는 섹션/문서 revision 거절, 본문·metadata·복사 ID·membership·native 휴지통·Undo·재시작을 통과했다. 통합 검사는 실제 파일 충돌·히스토리·HTML 버전별 저장/복원·실패 격리를 통과했다.

## 기존 제약과 검사 한계

- 기존 HTML preview UI 검사는 수정 요청의 원본 경로 텍스트 단언에서, 기존 section UI 검사는 section-menu 대기에서 실패했다. 변경을 적용하지 않은 origin/main archive에서도 같은 줄/조건으로 재현했다. 규칙/단언을 완화하지 않았다. 관련 실제 패키지와 변경 회귀의 통과를 위와 구분한다.
- 원래 폴더의 미커밋 architecture 검사기를 이용해 origin/main과 현재 소스를 비교했고 새 경계 위반은 0개였다. 원래 예외 목록의 home-service→project-name 항목은 원격의 선행 수정으로 이미 해소되어 엄격한 원본 목록 비교는 정리 요청 1개를 보고한다. 이번 변경에서 예외를 추가/재생성하지 않았다. 현재 원격에는 해당 검사기/예외 목록이 아직 커밋되어 있지 않아 배포 변경으로 함께 가져오지 않았다.
- 기존 layout metadata가 없는 legacy project.md를 전체 선택한 합성 fixture는 layoutValues의 크기 검증에서 거절됐다. 패키지 검사는 명시적인 유효 geometry를 가진 fixture를 사용했다. 이 기존 동작의 변경은 포함하지 않았다.
- 성능 계측은 mock 저장 fixture이고 파일 쓰기 성능을 증명하지 않는다. 파일/재시작/히스토리는 별도 최종 package 검사로 확인했다. 기존 혼합 항목이 하나의 원자적 저장/Undo가 되는 새 정책은 없다.

로컬 근거는 out/drag-performance/{baseline,optimized}.json, out/\*-final.log, out/drag-packaged-final.log, out/editing-packaged-final.log, out/internet-host-retry.log, out/{html-preview,section}-baseline.log에 보존한다. 실제 유료 AI·운영 서버·사용자 프로젝트를 사용하지 않았다.

## 최종 게시 및 추가 검사 기록

v0.38.4 정식 게시와 공개 3개 자산의 SHA-256/크기/접근, RELEASES 바이트 해시 및 nupkg SHA-1/크기, 업데이트 JSON과 Squirrel feed의 0.38.4 반영을 확인했다. 원격 Windows 전체 검사·Linux 서버/Windows 백업 호환 검사·타입·린트 CI가 모두 성공했다: https://github.com/sehyeok3406/game-jam-dev/actions/runs/40789068723 . 검증한 package와 make 후 및 nupkg 내부 app.asar 해시가 일치한다. 세부 파일 해시는 UPDATES.md에 기록했다.

통합 명령 전체는 캔버스 전환 UI의 ResizeObserver 알림 단언 때문에 실패했다. 같은 하위 UI 검사를 재실행하면 문서 컨텍스트 메뉴 대기에서 실패했고, 변경 전 origin/main archive도 같은 컨텍스트 메뉴 대기로 실패했다. 앞서 열거한 native/backend 통합 부분의 통과와 명령 전체 통과를 구분한다. 기존 HTML/section UI 2개와 함께 해결되지 않은 검사 제약으로 남긴다. 규칙·시간 제한·예외를 완화하지 않았다.
