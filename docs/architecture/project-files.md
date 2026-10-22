# 공동 파일 사본과 로컬 편집 반영

공동 프로젝트의 서버 snapshot과 PC의 작업용 파일 사본은 별개다. 서버 명령의 인증·revision·receipt·히스토리는 CollaborationClient/server가 계속 소유한다. PC 사본을 준비하는 데 실패했다고 서버 명령을 로컬 편집으로 우회하거나, 이미 성공한 서버 명령을 취소하지 않는다. 기존 SharedEditingService의 journal 인정 순서도 유지한다.

`SharedProjectMirror`는 시작 시 복사한 대상 snapshot에 대해 layout 준비 → 현재 파일 읽기 → 결과 폴더 이동 → 기존 원자적 파일 반영 → OS 휴지통 처리 → 빈 이전 상위 폴더 정리를 실행한다. `filesystemSharedProjectFiles`는 생성 시 받은 root만 사용하며 rollback에서도 현재 workspace를 다시 조회하지 않는다. main은 시작 session/ref·client·root와 native adapter를 연결한다.

- 결과 이동은 기존 `moveResultFiles`/`resultFileBaseline`을 재사용한다. HTML·추적된 자료·추적되지 않은 보조 파일과 개인 preview window 설정을 같은 결과 폴더와 함께 이동한다. 물리 이동부터 metadata 반영까지 감시를 일시 정지한다.
- metadata 반영 실패나 반영 전 session 변경은 이동한 폴더와 preview 설정을 **원래 root**로 복구한다. 기존 applyChanges의 외부 변경 검사/되돌리기와 파일 형식을 유지한다. metadata 반영이 성공한 뒤의 취소·휴지통 오류는 폴더만 역이동하지 않고 오류를 돌려준다.
- snapshot 전체 반영은 기존과 같이 추적 파일을 먼저 갱신/제거하고 남은 결과 폴더·개인 설정을 휴지통 처리한다. 서버 snapshot에서 제거한 추적 파일까지 모두 OS 휴지통에 남는다고 주장하지 않는다. 추적되지 않은 보조 파일의 OS 휴지통 반영은 그대로 유지한다. 직접 삭제 명령의 trash-only 경로는 기존 결과 폴더 전체 처리 방식을 사용한다.
- Undo/Redo는 공동 서버 히스토리를 변경한다. 다음 mirror 준비 시 그 최신 snapshot으로 PC 사본을 구성한다. 서버 Undo만으로 개인 파일이나 OS 휴지통 전체가 즉시 복원되는 새로운 정책은 추가하지 않았다.
- shared path reveal/open-folder의 파일 사본 준비도 기존 mutation 큐를 통과한다. 그 사이 프로젝트 전환과 저장·결과 이동이 끼어들지 않도록 하며 IPC channel/preload/sender 정책은 바꾸지 않는다.

`sessionProjectFileEffects`는 로컬 편집/Undo·history 복원과 공동 사본 준비가 사용하는 감시 중단/재개·OS trash port다. 종료 콜백은 한 번만 재개하며, 이전 session의 종료 콜백이 새 감시기를 지우거나 시작하지 않는다. `startSessionProjectWatcher`는 비동기 close 뒤에도 session을 다시 검사하고 시작 root만 감시한다. 늦은 이전 파일 이벤트도 새 프로젝트 화면에 알리지 않는다. chokidar의 ignore/안정화 설정은 유지한다.

`LocalMutationService`는 기존 desktop local handler 전후의 비교·workflow 초기값 반영·히스토리 인정·화면 갱신을 소유한다. 단일 Markdown 저장/배치/접기는 해당 파일만 capture해 변경 없는 HTML을 전체 기록하지 않는다. clipboard import와 manual command의 전용 히스토리를 중복 생성하지 않는다. AI 요청/작업 접기의 기존 Undo 제외 조건은 시작 session에 고정된 journal을 사용하는 기존 기록 adapter가 계속 처리한다. 전문 저장 서비스 자체의 원자성이나 모든 native 효과를 새로운 단일 트랜잭션으로 바꾸지 않는다.

`ensureProjectLayout`은 기존 폴더·project.md 초기화 marker와 output/README.md 형식을 유지한다. 로컬 작업과 공동 mirror에 모두 캡처된 경로/세션으로 연결한다. 공동 캐시/outgoing·offline JSON 저장 큐, 프로젝트 생성/참여/복구·충돌 해결 IPC는 이번 단위에서 새 서비스로 옮기지 않았다.

검증: `tests/project-files.test.mjs`의 오류/세션 주입과 실제 임시 파일, `tests/local-mutation.test.mjs`의 partial capture/단일 인정/실패 경계, production session/AI 예약·통합 검사, `tests/project-mirror-packaged.mjs`의 실제 Windows 패키지 결과 이동/삭제/Undo/재구성/프로젝트 전환을 연결한다. 임시 root와 UUID 프로필만 사용하고 실제 AI 공급자·운영 서버는 사용하지 않는다.
