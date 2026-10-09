# PC 협업 서버 모듈

Windows 설치 앱에서 홈의 **협업 서버 열기**로 준비·실행·상태 확인·종료·재시작을 제공한다. Cloudflare Quick Tunnel은 가입·도메인 없이 사용한다. 참가자는 **초대 코드로 참여**하며, 주소 변경 시 홈의 **연결 정보 붙여넣기**를 사용한다.

## 책임과 연결 지점

- `register.ts`: 메인 프로세스 등록과 IPC 발신자 검사. `src/main.ts`의 등록 호출, 창 종료 연결, 생성 키 내부 전달이 연결 지점이다.
- `service.ts`: 번들 런타임 준비, 공식 연결 도구 다운로드·SHA-256 검사, 프로세스 검사·실행, 해당 호스트의 주소 갱신, 정제된 AI 요청문.
- `bridge.ps1`: 기존 Windows 호스트 도구와 연결한다. 키는 메인 프로세스에서만 읽고 렌더러나 진단 파일에 전달하지 않는다.
- `lifecycle.ts`: 창 닫기 선택과 기억, 숨겨진 아이콘으로 백그라운드 관리, 종료 취소·실패 시 창 유지. 앱 업데이트를 위한 승인된 종료에서는 활성 별도 서버를 재시작하지 않는다.
- `preload.ts`, `types.ts`: 선택적으로 노출되는 `gameCanvas.selfHost` API.
- `SelfHostDialog.tsx`, `help.ts`, `self-host.css`: 설정·관리·유지 안내 UI. 앱 `App.tsx`와 홈 `ProjectHome.tsx`에서만 진입한다.
- `src/connection-info.ts`, `src/ui/ConnectionInfoDialog.tsx`: 일반 협업 연결 정보 처리. PC 호스트 모듈을 제거해도 유지한다.

자동 주소 갱신은 같은 URL을 가진 모든 프로젝트에 적용하지 않는다. 이 호스트의 SQLite 저장소에서 현재 참여 토큰의 해시가 유효한지 확인한 프로젝트만 갱신한다. 현재 열려 있는 프로젝트는 홈으로 돌아온 후 다시 검사해야 한다. 참여 세션·복구 키·로컬 작업 사본은 재발급하거나 삭제하지 않는다.

참가자용 연결 정보에는 프로젝트 ID와 새 HTTPS 주소만 담는다. 적용 전에 대상 프로젝트와 이전·새 주소를 표시하고 호스트에게 받은 정보인지 확인한다. 이 정보는 디지털 서명이 있는 자동 주소 발견 시스템이 아니다. 임의의 출처에서 받은 주소를 자동으로 신뢰하지 않으며, 적용 자체로 세션 토큰을 전송하지 않는다.

## 배포

`npm start`, `npm run package`, `npm run make`의 Forge 훅이 `scripts/build-self-host-runtime.mjs`를 실행한다. Windows Node.js 24 이상에서 빌드하며, 현재 빌드 프로세스의 Node 실행 파일·해당 버전 라이선스·서버 번들·PowerShell 도구를 `out/self-host-runtime`에 준비한다. 설치 앱에는 `resources/self-host-runtime`으로 포함한다. 기본 빌드와 동일한 CPU 아키텍처의 런타임이다.

사용자 PC에는 Node.js나 개발 저장소가 필요하지 않다. 연결 도구는 GitHub의 공식 `cloudflare/cloudflared` 릴리스 메타데이터와 SHA-256 digest를 확인해 앱 전용 위치에 다운로드한다. digest가 없는 릴리스나 검사 실패 파일은 실행하지 않는다. 시스템 PATH를 바꾸지 않는다.

서버는 `%LOCALAPPDATA%/GameCanvas-InternetHost`를 사용해 기존 도구의 데이터와 DPAPI 키를 보존한다. 런타임을 이 데이터 폴더의 버전별 하위 폴더로 복사하므로 앱 업데이트가 실행 중인 Node 실행 파일을 교체하지 않는다. 기존 서버·터널 프로세스는 PID·생성 시각·실행 파일·명령줄 표식으로 소유권을 확인한 뒤에만 관리한다. 서버 데이터는 평문 저장이며 키는 해당 Windows 계정으로 암호화된다.

## 기능 제외와 추후 제거

PowerShell에서 다음과 같이 빌드하면 PC 인터넷 서버 모듈의 IPC·화면과 전용 런타임 리소스를 제외한다.

```powershell
$env:GAME_CANVAS_SELF_HOST = '0'
npm run make
Remove-Item Env:GAME_CANVAS_SELF_HOST
```

`enabled.ts`의 빌드 상수를 main·preload·renderer 설정과 Forge 리소스 설정에서 일관되게 사용한다. 기존 개발용 로컬 테스트 서버는 별도 기능이며 이 모듈의 인터넷 서버와 다르다.

물리적으로 제거할 때는 main의 등록·종료·내부 키 연결, preload의 선택 API, App·홈 진입점, shared의 선택 타입과 Forge·Vite 빌드 지점을 정리한 뒤 이 폴더와 런타임 빌더를 제거한다. 공통 연결 정보 처리와 협업 클라이언트는 남긴다. 구형 데이터에 호스트 모듈 식별자를 필수로 추가하지 않았으므로 기존 공동 프로젝트 목록은 계속 읽을 수 있다.

운영 서비스 전환 전에는 기존 PC 서버를 종료하고 관리 경로를 보장해야 한다. 프로젝트를 운영 서버로 옮기는 절차는 별도 작업이다. 서버 주소 변경만으로 프로젝트 데이터가 이전되지 않으며, 기능 제외·제거가 호스트 데이터 삭제를 수행하지 않는다.

## 검증

- `npm test`: 연결 정보 검증, 유효 세션에만 주소 갱신, 비밀 값 제외, 다운로드 검증 실패, 중복 동작, 종료·트레이·취소·AI 보호 회귀 테스트.
- `npm run test:integration`: 기존 IPC·공동 편집·AI·독립 사용자 창 회귀.
- `node tests/run-self-host-ui.mjs`: 별도 픽스처에서 홈·설정·관리·도움말·복사·종료 확인·주소 신뢰 확인과 다크·라이트 레이아웃.
- `node scripts/verify-self-host-disabled.mjs`: 기능 제외 시 main·preload·renderer에서 관리 기능 제거와 공통 재연결 유지.
- `node scripts/verify-self-host.mjs`: 명시적인 온라인 검사. 별도 임시 데이터와 임의 포트에서 실제 터널 생성, 참여·편집·재시작·동일 세션 재연결·종료를 검증한다. 사용자 서버와 데이터는 사용하지 않는다. 결과는 `out/qa/self-host-online.json`에 비밀 값 없이 저장한다. 물리적으로 다른 PC·다른 네트워크를 사용한 검증은 별도로 필요하다.
