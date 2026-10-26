# 인터넷 협업 도구

- **`Copy-Admin-Recovery-Key.cmd`**: 프로젝트 ID와 현재 서버 주소를 표시하고, 저장된 유효한 관리자 복구 키를 클립보드에 복사한다. 앱에서 관리자 메뉴를 열 수 없어도 사용할 수 있다. 프로젝트가 여러 개면 번호로 선택한다. 복구 키가 없거나 만료되어도 ID·주소는 표시하고 복사할 수 있다.
- **`Copy-Server-Key.cmd`**: 새 공동 프로젝트를 만드는 서버 생성 키를 복사한다. 기존 프로젝트의 관리자 복구 키와 다르다.
- `Start.cmd`, `Status.cmd`, `Stop.cmd`: 협업 서버 시작, 상태 확인, 종료.

복구 키 도구는 현재 Windows 계정으로 `%APPDATA%/Game Canvas`의 암호화된 세션, 프로젝트 목록, 관리자 복구 백업을 읽는다. 이 PC의 호스트 체크포인트에 저장된 복구 키 해시와 일치하는 키만 복사한다. 서버가 꺼져 있어도 저장 데이터로 확인할 수 있다. 키는 콘솔이나 로그에 표시하지 않으며, 서버·앱을 재시작하거나 인증을 재발급하지 않는다. 다른 PC의 서버나 암호화 백업에 남아 있지 않은 키는 찾을 수 없다. 복구 키로 실제 관리자 복구를 수행하면 이전 관리자 인증과 복구 키가 무효화되므로, 이후 다시 실행해 최신 키를 복사한다.

일반 사용은 CMD를 더블클릭하면 된다. 자동 실행 예:

복사 메뉴: `1` 복구 키, `2` 프로젝트 ID, `3` ID+키, `4` 현재 서버 주소, `5` ID+주소, `6` ID+주소+키 전체. 서버 주소는 실행할 때마다 호스트의 `runtime.json`에서 읽으며, 앱에 저장된 이전 주소로 대체하지 않는다. 서버 주소가 없으면 안내를 표시한다. 저장된 주소를 표시하는 기능이며 외부 연결의 정상 여부는 `Status.cmd`로 확인한다.

```powershell
./Copy-Admin-Recovery-Key.cmd -NoPrompt
./Copy-Admin-Recovery-Key.cmd -ProjectId <프로젝트-UUID> -Copy ProjectId -NoPrompt
./Copy-Admin-Recovery-Key.cmd -Copy Info -NoPrompt
./Copy-Admin-Recovery-Key.cmd -Copy All -NoPrompt
./Copy-Admin-Recovery-Key.cmd -CheckOnly -NoPrompt
```

## 종료 전 작업 검사

Stop·RestartServer와 앱의 서버 종료·재시작은 동일한 읽기 전용 작업 검사를 사용한다. `projects/sync.sqlite`가 있으면 SQLite/WAL을 기준으로 검사하며 이전 JSON 폴더는 읽지 않는다. 이전 저장 형식에서는 `.project-trash`·`.project-lifecycle` 관리 폴더를 제외한다. 실행 lease 또는 queued/starting/running/validating 대기열이 있으면 GC-HOST-AI로 중단한다. 저장소 손상·미지원 스키마·검사 도구 오류는 GC-HOST-016으로 중단하고 실행 중인 프로세스를 유지한다. 검사 도구는 프로젝트 원문과 예외를 출력하지 않는다.
