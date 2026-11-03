# 게임 제작 요청의 지침·원본 요구·설계 문서

2026-11-02 갱신. 2단계에서 구현한 지침·요구·설계 기준 계약이다. 4단계에서 새 gamejam HTML 요청은 [source/workflow v2 제작](game-build-execution.md)에 연결했고 기존 v1 명세와 session/lease/stage/히스토리 경계를 유지한다.

## 기본 지침과 사용자 지시

`core/ai/instruction-templates.ts`에 공식 1판 보관본과 현재 2판을 둔다. 향후 문구 변경은 새 판을 추가하며 보관본을 덮어쓰지 않는다. organize Markdown/HTML/HTML 통합과 implement의 template ID를 구분한다. 공급자는 구분하지 않는다.

사용자가 편집하는 필드는 기존처럼 전체 지시를 대체한다. 사용자 문장 뒤에 기본 지침을 자동으로 덧붙이지 않는다. `GamejamRequest.instructionOrigins`는 template ID/판/defaultText와 default/custom/legacy 출처를 보관하고, 실제 텍스트는 기존 instructions 필드에 둔다. 사용자 편집과 기본값 복원은 출처도 함께 갱신한다.

새 요청 또는 과거 요청/완료·실패 기록/팀원 요청의 **복사**를 준비할 때만 공식 보관본과 일치하는 기본 지침을 최신판으로 갱신한다. 명시적 custom은 이전 기본 문구와 같아도 보존한다. 출처가 없거나 손상되어 수정 여부를 구별할 수 없는 내용은 legacy로 보존하고 검토 안내를 표시한다. 공식 보관본 외 과거 문구를 유사도·일부 문장 비교로 자동 교체하지 않는다.

작성 중 초안을 다시 열거나 기존 공유 요청을 수정할 때는 지침 텍스트를 갱신하지 않는다. 과거 task·예약·실행·히스토리를 기본값 변경으로 재작성하지 않는다. 요청창의 ‘최신 기본 지침 보기’는 입력을 바꾸지 않는다. ‘기본값으로 복원’은 해당 단계의 입력 전체를 대체한다. 초기화와 새 기본판 선택은 사용자 지시를 보존하는 동작과 구분한다.

## 실행 명세의 고정 기록

`EffectiveInstructionsV2`는 다음 사실을 구분한다.

| 필드                                                 | 의미                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| templateId/templateVersion/defaultText/defaultSha256 | 기준 기본 지침의 판·내용·SHA-256                  |
| source/userText                                      | 기본값/명시적 편집/구분 불가와 사용자 대체 텍스트 |
| effectiveText/effectiveSha256                        | 해당 작업이 실제로 적용할 텍스트와 SHA-256        |

`task-specification.ts`는 새 task의 `effective_instructions`와 `instruction_template_version:2`를 저장한다. 이 판 번호는 workflow v2와 다르다. defaultText는 출처 보관 정보이며 활성 명령이 아니다. 실제 지시는 effectiveText/본문이고 고정 보호 규칙이 출력 범위와 입력 보호를 유지한다.

Node adapter가 SHA-256을 제공하고 core가 출처/내용을 계산·검증한다. 새 명세는 본문의 사용자 지시와 기록의 텍스트·해시가 일치해야 한다. 원본 requestSnapshot과 실제 실행 지시가 다른 경우에도 생성 전에 거절한다. 기존 기록 형식은 재해석해 갱신하지 않으며 기존 v1 실행을 유지한다. 내부 명세의 지시 본문만 직접 편집한 경우에는 새 요청을 준비해야 한다.

`taskInstructionsVersion:2`를 health와 인증 state에 광고한다. 새 provenance가 있는 요청 생성/공유 요청 등록은 미지원 서버에서 전송 전에 중단한다. 새 capability를 gameBuildStorageVersion이나 gameBuildVersion으로 추정하지 않는다. 기존 provenance 없는 요청의 경로는 유지한다.

## 원본 요구와 제작 기준 전달

`TaskDesignContextV1`은 originalInputs, originalInstructions, designDocuments를 기록한다. 문서 정리→HTML 단계의 두 번째 입력에는 **새로 정리한 문서 + 원본 선택 자료 + 기존 선택 시스템 문서 + 이미지/HTML 지원 파일**을 함께 전달한다. 정리 문서의 요약만으로 원본 요구를 대체하지 않는다. 두 단계의 원본 맥락과 적용 지시, 허용 입력/출력이 일치해야 한다.

정리 단계에서 동적으로 확정한 시스템 문서는 기존 resolveTaskArtifacts 검증을 통과한 뒤 다음 단계 입력과 기준 문서 목록에 추가한다. 선언되지 않은 파일이나 다른 프로젝트 자료를 추가하지 않는다. 네 공급자는 같은 AiRunService와 보호된 phase snapshot을 사용한다. 파일만 제공받는 Grok에도 원본 자료가 포함된다.

새 요청의 편집 가능한 기본 문서 구성은 게임 개요·핵심 플레이·비주얼 설계·모호한 점이다. 비주얼 문서는 캐릭터/배경·아트·카메라·HUD/메뉴·피드백/이펙트·이미지 역할과 선택 이유를 구체화한다. 사용자 지정/AI 제안/미정을 구분하도록 안내한다. 기존 또는 사용자 지정 문서의 개수·제목·타입·key·ID를 자동 변경하지 않는다. legacy 세 문서와 동적 시스템 묶음도 유지한다.

기준 문서는 기존 편집기로 수정하고 다음 요청의 자료로 선택한다. task 생성 이후 사용자가 저장한 문서 변경은 실행/예약 시점의 기존 baseline 정책을 따른다. AI 결과 실패 때 이 사용자 변경까지 되돌리지 않는다. 5단계에서는 ‘기존 문서 수정하기’로 명시적으로 선택한 system/overview/question 출력 문서를 `document_updates:{version:1,targets:[{path,id}]}`에 기록한다. 해당 문서만 입력/출력 교집합을 허용하고 원본 아이디어·이미지는 계속 보호한다. 문서 단계에서 갱신한 파일은 다음 source 단계에서는 읽기 전용이며 게임과 함께 요청하면 전체가 성공할 때 반영한다. 문서만 요청하는 기존 산출 경로도 사용한다. 자세한 baseline·충돌·실패 정책은 [게임 원본 수정](game-build-editing.md)을 따른다.

## 이동·보존과 검증 경계

6단계부터 미리보기와 제작 요청의 기준 게임 안내에 제작 당시 입력 문서·현재 변경 상태를 표시한다. 새 baseline은 전체 파일 hash와 표시 metadata를 제외한 선택적 `designSha256`을 함께 저장한다. 상태는 파일 비교 사실이며 요구 구현 완료를 뜻하지 않는다. 과거 비교 정보 부족·삭제/다른 문서 대체는 구분하고 자동 수정하지 않는다. 자세한 계약은 [HTML 입출력·상태 안내](game-build-transfer.md)를 따른다.

문서 구조 전환·HTML 이동·과거 기록 복원 시 `core/ai/task-references.ts`가 새 명세의 실제 경로만 갱신한다. 중첩 workflow_steps와 원본/기준 입력 목록도 함께 처리하고, 사용자 지시·defaultText·effectiveText·해시와 originalInstructions는 보존한다. 고정 context의 JSON은 경로 갱신 결과로 다시 구성한다. 사용자 지시 안에 같은 제목·경로·JSON 표시 문구가 있어도 바꾸지 않는다. 기존 history 파일은 수정하지 않는다.

타입/strict core/contracts, architecture, 전체 회귀와 `tests/task-instruction-context.test.mjs`를 사용한다. 실제 화면은 gamejam-history/gamejam-validation 검사, Windows package는 `tests/game-build-instructions-packaged.mjs`를 사용한다. 실제 AI의 준수·게임 품질은 지시/범위 검증만으로 보장하지 않는다. 유료 AI 호출·이미지 검색/생성·자동 시각 평가와 라이브러리 준비는 이번 단계의 검증 대상이 아니다.
