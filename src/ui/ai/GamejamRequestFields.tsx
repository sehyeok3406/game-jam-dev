import { gamejamErrorId } from '../../gamejam-validation';
import { isTextMaterial } from '../../canvas-text-materials';
import type { Dispatch, SetStateAction } from 'react';
import type * as C from '../../shared';
import type * as V from '../../gamejam-validation';
import type { GamejamRequest as Request } from '../../contracts/gamejam-request';
import type { DocumentResultChoice } from '../../contracts/document-output';
import type { CanvasItem } from '../CanvasOverlays';
import type { GamejamPage } from '../../gamejam-wizard';
import type { documentSets } from '../../document-output';
import type { useGamejamRequest } from './useGamejamRequest';
import { getAiProvider, getAiModelLabel } from './presentation';
import { canvasId } from '../../canvas-sheets';
import {
  FileText,
  Code2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AI_PROVIDERS, reasoningLabel } from '../../core/ai/catalog.ts';
import { AiReasoningSelect } from '../AiReasoningSelect';
import { isPreviewPath, previewGameLabel } from '../../preview-output';
import {
  defaultDocumentTemplates,
  MAX_FORMAT_DOCUMENTS,
  type DocumentOutputTemplate,
} from '../../document-format';
import { GamejamReview } from '../GamejamWizard';
import { GameFeatureLibrary } from '../GameFeatureLibrary';
import { GamejamFieldErrors } from '../GamejamValidation';
import { MAX_RESULT_NAME } from '../../result-name';
import {
  defaultTaskInstructions,
  MAX_TASK_INSTRUCTIONS,
} from '../../task-instructions';
import type { AiProviderId } from '../../shared';

type RequestState = ReturnType<typeof useGamejamRequest>;
type RequestFieldsProps = Pick<
  RequestState,
  | 'aiRequestPage'
  | 'setAiRequest'
  | 'selectedAiProvider'
  | 'selectedAiModel'
  | 'selectedAiReasoning'
  | 'setSelectedAiProvider'
  | 'setSelectedAiModel'
  | 'setSelectedAiReasoning'
  | 'changeAiModel'
> & {
  selectMaterials: () => void;
  materialName: (path: string) => string;
  documentSetName: (baseDir?: string) => string;
  aiRequest: Request;
  aiRequestIssues: V.GamejamIssue[];
  documents: C.CanvasDocument[];
  sections: C.CanvasSection[];
  previews: C.PreviewResult[];
  creatingTask: boolean;
  canvasSheets: C.CanvasSheets;
  canvasItems: CanvasItem[];
  jumpTo: (id: string) => void;
  organizedSets: ReturnType<typeof documentSets>;
  documentChoiceForUpdate: (baseDir: string) => DocumentResultChoice;
  activeAiInstruction: 'organize' | 'implement';
  navigateAiPage: (
    page: GamejamPage,
    instruction?: 'organize' | 'implement',
  ) => void;
  focusAiIssue: (issue: V.GamejamIssue) => void;
  multiplayerChoiceRequired: boolean;
  effectiveAiRequest: Request | null;
  submittingApproval: boolean;
  codexStatus: C.CodexConnectionStatus | null;
  setCodexStatus: Dispatch<SetStateAction<C.CodexConnectionStatus | null>>;
  checkingCodex: boolean;
  refreshCodexStatus: () => Promise<C.CodexConnectionStatus | null>;
};

/** Five request pages consume the explicit request/dataset contracts; saving belongs to the request hook. */
export function GamejamRequestFields({
  selectMaterials,
  materialName,
  documentSetName,
  aiRequestPage,
  aiRequestIssues,
  aiRequest,
  documents,
  sections,
  previews,
  setAiRequest,
  creatingTask,
  canvasSheets,
  canvasItems,
  jumpTo,
  organizedSets,
  documentChoiceForUpdate,
  activeAiInstruction,
  navigateAiPage,
  focusAiIssue,
  multiplayerChoiceRequired,
  effectiveAiRequest,
  submittingApproval,
  selectedAiProvider,
  selectedAiModel,
  selectedAiReasoning,
  codexStatus,
  setSelectedAiProvider,
  setCodexStatus,
  setSelectedAiModel,
  setSelectedAiReasoning,
  changeAiModel,
  checkingCodex,
  refreshCodexStatus,
}: RequestFieldsProps) {
  const aiFieldProps = (field: V.GamejamField) => ({
    'aria-invalid':
      aiRequestIssues.some((issue) => issue.field === field) || undefined,
    'aria-describedby': aiRequestIssues.some((issue) => issue.field === field)
      ? gamejamErrorId(field)
      : undefined,
  });
  return (
    <div className="ai-request-fields">
      <section
        className="gamejam-page"
        data-gamejam-page="1"
        hidden={aiRequestPage !== 1}
      >
        <h3 className="ai-step-heading" tabIndex={-1}>
          <span>1</span> 무엇을 만들까요?
        </h3>
        {aiRequestIssues.filter(
          (issue) =>
            issue.field === 'steps' && issue.message.includes('이전 입력'),
        ).length > 0 && (
          <div className="gamejam-missing-inputs">
            <p>
              찾을 수 없는 이전 입력을 제외한 뒤 필요한 자료를 다시
              선택해주세요.
            </p>
            {aiRequest.inputPaths
              .filter(
                (path) =>
                  !documents.some((doc) => doc.relativePath === path) &&
                  !sections.some((section) => section.relativePath === path) &&
                  !previews.some((preview) => preview.relativePath === path),
              )
              .map((path) => (
                <button
                  type="button"
                  key={path}
                  onClick={() =>
                    setAiRequest({
                      ...aiRequest,
                      inputPaths: aiRequest.inputPaths.filter(
                        (input) => input !== path,
                      ),
                    })
                  }
                >
                  {materialName(path)} · 자료에서 제외
                </button>
              ))}
          </div>
        )}
        <div
          id="ai-request-steps"
          tabIndex={-1}
          {...aiFieldProps('steps')}
          className="gamejam-steps"
          role="group"
          aria-label="실행할 작업 선택"
        >
          <label className={aiRequest.organize ? 'selected' : ''}>
            <input
              type="checkbox"
              checked={aiRequest.organize}
              disabled={creatingTask}
              onChange={(event) =>
                setAiRequest({
                  ...aiRequest,
                  organize: event.target.checked,
                })
              }
            />
            <Sparkles size={18} />
            <span>
              <strong>문서 정리</strong>
              <small>
                {aiRequest.sourceMode
                  ? '선택한 게임을 분석해 문서로 정리'
                  : '선택한 메모와 자료를 문서로 정리'}
              </small>
            </span>
          </label>
          <label className={aiRequest.implement ? 'selected' : ''}>
            <input
              type="checkbox"
              checked={aiRequest.implement}
              disabled={creatingTask}
              onChange={(event) =>
                setAiRequest({
                  ...aiRequest,
                  implement: event.target.checked,
                })
              }
            />
            <Code2 size={18} />
            <span>
              <strong>게임 만들기</strong>
              <small>선택한 자료를 바탕으로 플레이할 수 있는 게임 만들기</small>
            </span>
          </label>
        </div>
        <GamejamFieldErrors field="steps" issues={aiRequestIssues} />
        <section className="ai-material-actions" aria-label="AI가 참고할 자료">
          <strong>AI가 참고할 자료</strong>
          <button
            id="ai-select-on-canvas"
            type="button"
            disabled={creatingTask}
            onClick={selectMaterials}
          >
            캔버스에서 선택하기
          </button>
        </section>
        <details className="canvas-material-picker">
          <summary>목록에서 자료 추가하기</summary>
          {canvasSheets.canvases.map((sheet) => (
            <fieldset key={sheet.id}>
              <legend>{sheet.name}</legend>
              {canvasItems
                .filter(
                  (item) => item.canvasId === sheet.id && item.kind !== 'task',
                )
                .map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={aiRequest.inputPaths.includes(item.path)}
                      onChange={(event) =>
                        setAiRequest((current) => {
                          if (!current) return current;
                          const paths = event.target.checked
                            ? [
                                ...new Set([
                                  ...current.inputPaths,
                                  item.path,
                                  ...(item.kind === 'section'
                                    ? (sections
                                        .find(
                                          (section) =>
                                            section.relativePath === item.path,
                                        )
                                        ?.members.map(
                                          (member) => member.path,
                                        ) ?? [])
                                    : []),
                                ]),
                              ]
                            : current.inputPaths.filter(
                                (path) => path !== item.path,
                              );
                          const htmlCount = paths.filter(isPreviewPath).length;
                          return {
                            ...current,
                            inputPaths: paths,
                            sourceMode: htmlCount ? 'html-compose' : undefined,
                          };
                        })
                      }
                    />
                    {item.title}
                  </label>
                ))}
            </fieldset>
          ))}
        </details>
        <p className="gamejam-flow-summary" role="status">
          {aiRequest.organize && aiRequest.implement
            ? '1. 문서 정리 및 검증 → 2. 이번에 정리한 문서로 게임 만들기 → 전체 결과 반영'
            : aiRequest.organize
              ? aiRequest.sourceMode
                ? '선택한 게임을 분석해 게임 개요와 플레이 흐름을 문서로 정리합니다. 원본 게임은 유지됩니다.'
                : '선택한 메모·파일을 문서로 정리합니다.'
              : aiRequest.implement
                ? '선택한 자료와 요청 내용을 바탕으로 게임을 만듭니다.'
                : '실행할 작업을 하나 이상 선택해주세요.'}
        </p>
        {aiRequest.implement && (
          <small>
            새 버전을 만들면 기존 게임은 유지됩니다. 기존 게임을 수정하면 이전
            내용은 작업 기록에 남깁니다.
          </small>
        )}
        {aiRequest.sourceMode && (
          <small>
            AI는 게임 코드를 읽어 분석하며 직접 플레이하지는 않습니다. 확인된
            내용과 추정한 내용을 구분해 정리합니다.
          </small>
        )}
        {aiRequest.sourceMode === 'html-compose' && (
          <small>
            여러 게임을 골랐다면 기능을 어떻게 합칠지 요청 내용에 적어주세요.
            메모 없이 게임만 선택해도 됩니다.
          </small>
        )}
        <details open className="ai-input-scope">
          <summary>
            선택한 자료 · 문서{' '}
            {
              aiRequest.inputPaths.filter(
                (path) =>
                  !path.startsWith('sections/') &&
                  !isPreviewPath(path) &&
                  !isTextMaterial(path),
              ).length
            }
            개 · 텍스트 {aiRequest.inputPaths.filter(isTextMaterial).length}개 ·
            HTML {aiRequest.inputPaths.filter(isPreviewPath).length}개 · 섹션{' '}
            {
              aiRequest.inputPaths.filter((path) =>
                path.startsWith('sections/'),
              ).length
            }
            개
          </summary>
          <div>
            {aiRequest.inputPaths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => {
                  const item = canvasItems.find((item) => item.path === path);
                  if (item) jumpTo(item.id);
                }}
              >
                <FileText size={14} />
                <span>{materialName(path)}</span>
              </button>
            ))}
          </div>
        </details>
        <section className="ai-destination" aria-label="결과를 놓을 캔버스">
          <label htmlFor="ai-destination-canvas">결과를 놓을 캔버스</label>
          <select
            id="ai-destination-canvas"
            value={canvasId(aiRequest.canvasId)}
            disabled={creatingTask}
            onChange={(event) =>
              setAiRequest({
                ...aiRequest,
                canvasId: event.target.value,
                x: 120,
                y: 120,
              })
            }
          >
            {canvasSheets.canvases.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name}
              </option>
            ))}
          </select>
          <small>
            새 결과는 선택한 캔버스에 놓습니다. 기존 결과를 수정하면 원래
            캔버스와 위치를 유지합니다.
          </small>
        </section>
      </section>
      <section
        className="gamejam-page"
        data-gamejam-page="2"
        hidden={aiRequestPage !== 2}
      >
        <h3 className="ai-step-heading" tabIndex={-1}>
          <span>2</span> 결과물 설정
        </h3>
        {aiRequest.organize && (
          <>
            <div
              className="ai-output-choices"
              role="group"
              aria-label="정리 문서 생성 방식"
            >
              <button
                aria-pressed={aiRequest.documentResult?.mode === 'new'}
                disabled={creatingTask}
                onClick={() =>
                  setAiRequest({
                    ...aiRequest,
                    documentResult: {
                      ...aiRequest.documentResult,
                      mode: 'new',
                      baseDir: undefined,
                      structure:
                        aiRequest.documentResult?.structure ?? 'custom',
                      documents:
                        aiRequest.documentResult?.documents ??
                        defaultDocumentTemplates(),
                    },
                  })
                }
              >
                <Plus size={17} />
                <strong>새 문서 만들기</strong>
                <small>기존 문서는 유지하고 새 문서를 만듭니다</small>
              </button>
              <button
                aria-pressed={aiRequest.documentResult?.mode === 'update'}
                disabled={creatingTask || !organizedSets.length}
                onClick={() =>
                  setAiRequest({
                    ...aiRequest,
                    documentResult: documentChoiceForUpdate(
                      organizedSets.at(-1)!.baseDir,
                    ),
                  })
                }
              >
                <RefreshCw size={17} />
                <strong>기존 문서 수정하기</strong>
                <small>
                  선택한 문서를 수정하고 이전 내용은 기록에 남깁니다
                </small>
              </button>
            </div>
            {aiRequest.documentResult?.mode === 'update' ? (
              <label>
                수정할 문서 묶음
                <select
                  aria-label="수정할 문서 묶음"
                  value={aiRequest.documentResult.baseDir}
                  disabled={creatingTask}
                  onChange={(event) =>
                    setAiRequest({
                      ...aiRequest,
                      documentResult: documentChoiceForUpdate(
                        event.target.value,
                      ),
                    })
                  }
                >
                  {organizedSets.map((set) => (
                    <option key={set.baseDir} value={set.baseDir}>
                      {documentSetName(set.baseDir)}
                    </option>
                  ))}
                </select>
                <small>
                  기존 문서를 수정하고 이전 내용은 기록에 남깁니다. 시스템별
                  문서 묶음은 새 시스템 문서를 추가할 수 있으며, 이전 세 문서
                  묶음은 기존 구성을 유지합니다.
                </small>
              </label>
            ) : (
              <p className="ai-output-hint">
                {aiRequest.documentResult?.structure === 'systems'
                  ? '게임 개요 1개와 시스템별 문서 1~20개를 생성합니다. 시스템 수는 AI가 입력을 분석해 결정합니다.'
                  : `설정한 문서 ${aiRequest.documentResult?.documents?.length ?? 3}개를 생성합니다. 제목과 포함할 내용을 자유롭게 편집할 수 있습니다.`}
              </p>
            )}
            <section
              id="ai-document-format"
              className="document-output-format"
              tabIndex={-1}
              {...aiFieldProps('document-format')}
            >
              <div className="document-output-format__heading">
                <strong>만들 문서</strong>
                <span>
                  {aiRequest.documentResult?.structure === 'systems'
                    ? '게임 시스템별로 나누기'
                    : aiRequest.documentResult?.structure === 'custom'
                      ? `${aiRequest.documentResult.documents?.length ?? 0}개 문서`
                      : '기존 세 문서'}
                </span>
              </div>
              {aiRequest.documentResult?.mode !== 'update' && (
                <div className="document-output-presets">
                  <button
                    type="button"
                    disabled={creatingTask}
                    onClick={() =>
                      setAiRequest({
                        ...aiRequest,
                        documentResult: {
                          mode: 'new',
                          structure: 'custom',
                          documents: defaultDocumentTemplates(),
                        },
                      })
                    }
                  >
                    기본 문서 3개로 되돌리기
                  </button>
                  <button
                    type="button"
                    aria-pressed={
                      aiRequest.documentResult?.structure === 'systems'
                    }
                    disabled={creatingTask}
                    onClick={() =>
                      setAiRequest({
                        ...aiRequest,
                        documentResult: {
                          ...aiRequest.documentResult,
                          mode: 'new',
                          structure: 'systems',
                        },
                      })
                    }
                  >
                    게임 시스템별로 나누기
                  </button>
                  {aiRequest.documentResult?.structure === 'systems' && (
                    <button
                      type="button"
                      disabled={creatingTask}
                      onClick={() =>
                        setAiRequest({
                          ...aiRequest,
                          documentResult: {
                            ...aiRequest.documentResult,
                            mode: 'new',
                            structure: 'custom',
                            documents:
                              aiRequest.documentResult?.documents ??
                              defaultDocumentTemplates(),
                          },
                        })
                      }
                    >
                      문서 직접 구성하기
                    </button>
                  )}
                </div>
              )}
              {aiRequest.documentResult?.structure === 'custom' && (
                <>
                  {(aiRequest.documentResult.documents ?? []).map(
                    (template, index) => (
                      <div
                        key={template.key}
                        className="document-output-template"
                      >
                        <div className="document-output-template__header">
                          <strong>문서 {index + 1}</strong>
                          <button
                            type="button"
                            aria-label={`문서 ${index + 1} 제거`}
                            disabled={
                              creatingTask ||
                              aiRequest.documentResult?.mode === 'update' ||
                              (aiRequest.documentResult?.documents?.length ??
                                0) <= 1
                            }
                            onClick={() =>
                              setAiRequest({
                                ...aiRequest,
                                documentResult: {
                                  ...aiRequest.documentResult!,
                                  documents:
                                    aiRequest.documentResult!.documents!.filter(
                                      (doc) => doc.key !== template.key,
                                    ),
                                },
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <label>
                          문서 제목
                          <input
                            aria-label={`문서 ${index + 1} 제목`}
                            aria-invalid={!template.title.trim() || undefined}
                            value={template.title}
                            maxLength={120}
                            disabled={creatingTask}
                            onChange={(event) =>
                              setAiRequest({
                                ...aiRequest,
                                documentResult: {
                                  ...aiRequest.documentResult!,
                                  documents:
                                    aiRequest.documentResult!.documents!.map(
                                      (doc) =>
                                        doc.key === template.key
                                          ? {
                                              ...doc,
                                              title: event.target.value,
                                            }
                                          : doc,
                                    ),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          문서 종류
                          <select
                            aria-label={`문서 ${index + 1} 종류`}
                            value={template.type}
                            disabled={creatingTask}
                            onChange={(event) =>
                              setAiRequest({
                                ...aiRequest,
                                documentResult: {
                                  ...aiRequest.documentResult!,
                                  documents:
                                    aiRequest.documentResult!.documents!.map(
                                      (doc) =>
                                        doc.key === template.key
                                          ? {
                                              ...doc,
                                              type: event.target
                                                .value as DocumentOutputTemplate['type'],
                                            }
                                          : doc,
                                    ),
                                },
                              })
                            }
                          >
                            <option value="overview">개요</option>
                            <option value="system">시스템</option>
                            <option value="question">질문·확인 사항</option>
                          </select>
                        </label>
                        <label>
                          포함할 내용
                          <textarea
                            aria-label={`문서 ${index + 1} 포함할 내용`}
                            value={template.instructions}
                            maxLength={4000}
                            rows={3}
                            disabled={creatingTask}
                            placeholder="원하는 내용, Markdown 제목·목차, 표·목록 등의 양식을 적어주세요."
                            onChange={(event) =>
                              setAiRequest({
                                ...aiRequest,
                                documentResult: {
                                  ...aiRequest.documentResult!,
                                  documents:
                                    aiRequest.documentResult!.documents!.map(
                                      (doc) =>
                                        doc.key === template.key
                                          ? {
                                              ...doc,
                                              instructions: event.target.value,
                                            }
                                          : doc,
                                    ),
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    ),
                  )}
                  <button
                    type="button"
                    disabled={
                      creatingTask ||
                      (aiRequest.documentResult.documents?.length ?? 0) >=
                        MAX_FORMAT_DOCUMENTS
                    }
                    onClick={() => {
                      const templates =
                        aiRequest.documentResult?.documents ?? [];
                      const key = `d${Math.max(0, ...templates.map((doc) => Number(doc.key.slice(1)))) + 1}`;
                      setAiRequest({
                        ...aiRequest,
                        documentResult: {
                          ...aiRequest.documentResult!,
                          documents: [
                            ...templates,
                            {
                              key,
                              title: '새 문서',
                              type: 'system',
                              instructions: '',
                            },
                          ],
                        },
                      });
                    }}
                  >
                    <Plus size={16} /> 문서 추가
                  </button>
                  <small>
                    최대 21개까지 설정하며 제목과 포함할 내용이 생성 지침에
                    반영됩니다. 기존 묶음의 문서를 줄이거나 다른 구성으로
                    바꾸려면 새 버전을 만드세요.
                  </small>
                </>
              )}
              <GamejamFieldErrors
                field="document-format"
                issues={aiRequestIssues}
              />
            </section>
          </>
        )}
        {aiRequest.implement && previews.length > 0 && (
          <>
            <div
              className="ai-output-choices"
              role="group"
              aria-label="HTML 결과 생성 방식"
            >
              <button
                aria-pressed={aiRequest.htmlResult?.mode === 'new'}
                disabled={creatingTask}
                onClick={() =>
                  setAiRequest({
                    ...aiRequest,
                    htmlResult: {
                      ...aiRequest.htmlResult,
                      mode: 'new',
                    },
                  })
                }
              >
                <Plus size={17} />
                <strong>새 버전 만들기</strong>
                <small>기존 게임은 유지하고 새 버전을 만듭니다</small>
              </button>
              <button
                aria-pressed={aiRequest.htmlResult?.mode === 'update'}
                disabled={creatingTask}
                onClick={() =>
                  setAiRequest({
                    ...aiRequest,
                    htmlResult: {
                      ...aiRequest.htmlResult,
                      mode: 'update',
                      basePath:
                        aiRequest.htmlResult?.basePath ??
                        previews.at(-1)!.relativePath,
                    },
                  })
                }
              >
                <RefreshCw size={17} />
                <strong>기존 게임 수정하기</strong>
                <small>
                  선택한 게임을 수정하고 이전 내용은 기록에 남깁니다
                </small>
              </button>
            </div>
            <label>
              {aiRequest.htmlResult?.mode === 'update'
                ? '수정할 게임'
                : '어떤 게임을 바탕으로 만들까요?'}
              <select
                id="ai-html-result"
                {...aiFieldProps('html-result')}
                aria-label="바탕이 될 게임"
                value={aiRequest.htmlResult?.basePath ?? ''}
                disabled={creatingTask}
                onChange={(event) =>
                  setAiRequest({
                    ...aiRequest,
                    htmlResult: {
                      ...aiRequest.htmlResult,
                      mode: aiRequest.htmlResult?.mode ?? 'new',
                      basePath: event.target.value || undefined,
                    },
                  })
                }
              >
                {aiRequest.htmlResult?.mode !== 'update' && (
                  <option value="">기존 게임 없이 새로 만들기</option>
                )}
                {previews.map((preview) => (
                  <option
                    value={preview.relativePath}
                    key={preview.relativePath}
                  >
                    {previewGameLabel(preview)}
                  </option>
                ))}
              </select>
              {aiRequest.htmlResult?.mode !== 'update' && (
                <small className="ai-request-help">
                  선택한 게임을 바탕으로 새 버전을 만듭니다. 기존 버전은
                  유지됩니다. 선택하지 않으면 참고 자료로 새 게임을 만듭니다.
                </small>
              )}
            </label>
            <GamejamFieldErrors field="html-result" issues={aiRequestIssues} />
          </>
        )}
        <section className="ai-instructions-field">
          <label htmlFor="ai-result-name">
            {aiRequest.implement
              ? aiRequest.organize
                ? '이름 · 문서와 게임에 함께 사용'
                : '게임 이름'
              : '문서 묶음 이름'}
          </label>
          <input
            id="ai-result-name"
            {...aiFieldProps('name')}
            value={aiRequest.resultName}
            maxLength={MAX_RESULT_NAME}
            disabled={creatingTask}
            placeholder={
              aiRequest.implement ? '예: 한밤의 카페' : '예: 플레이어 시스템'
            }
            onChange={(event) =>
              setAiRequest({
                ...aiRequest,
                resultName: event.target.value,
              })
            }
          />
          <small>
            결과물에 사용할 이름입니다. 비워두면 기본 이름을 사용합니다.
            {aiRequest.organize &&
              ' 문서 정리는 선택한 출력 구성의 제목과 포함할 내용을 따릅니다.'}
          </small>
          <GamejamFieldErrors field="name" issues={aiRequestIssues} />
        </section>
      </section>
      <section
        className="gamejam-page ai-instructions-field"
        data-gamejam-page="3"
        hidden={aiRequestPage !== 3}
      >
        <h3 className="ai-step-heading" tabIndex={-1}>
          <span>3</span> AI에게 요청할 내용
        </h3>
        {aiRequest.organize && aiRequest.implement && (
          <div
            className="gamejam-instruction-progress"
            role="group"
            aria-label="AI에게 요청할 내용 페이지"
          >
            <button
              type="button"
              disabled={creatingTask}
              aria-pressed={activeAiInstruction === 'organize'}
              onClick={() => navigateAiPage(3, 'organize')}
            >
              1. 문서 정리 요청
            </button>
            <button
              type="button"
              disabled={creatingTask}
              aria-pressed={activeAiInstruction === 'implement'}
              onClick={() => {
                const issue = aiRequestIssues.find(
                  (issue) => issue.field === 'organize',
                );
                if (issue) focusAiIssue(issue);
                else navigateAiPage(3, 'implement');
              }}
            >
              2. 게임 만들기 요청
            </button>
          </div>
        )}
        {(['organize', 'implement'] as const)
          .filter((kind) => aiRequest[kind])
          .map((kind) => (
            <div
              className="gamejam-instructions"
              key={kind}
              hidden={kind !== activeAiInstruction}
            >
              <div className="ai-instructions-heading">
                <label htmlFor={`ai-task-instructions-${kind}`}>
                  {kind === 'organize'
                    ? '문서를 어떻게 정리할까요?'
                    : '게임을 어떻게 만들까요?'}
                </label>
                <button
                  type="button"
                  disabled={
                    creatingTask ||
                    aiRequest.instructions[kind] ===
                      defaultTaskInstructions(kind, aiRequest.sourceMode)
                  }
                  title="입력한 내용을 기본 작업 지시로 대체합니다"
                  onClick={() =>
                    setAiRequest({
                      ...aiRequest,
                      instructions: {
                        ...aiRequest.instructions,
                        [kind]: defaultTaskInstructions(
                          kind,
                          aiRequest.sourceMode,
                        ),
                      },
                    })
                  }
                >
                  <RefreshCw size={13} /> 기본값으로 복원
                </button>
              </div>
              <textarea
                id={`ai-task-instructions-${kind}`}
                {...aiFieldProps(kind)}
                aria-describedby={[
                  `ai-instructions-help-${kind}`,
                  aiFieldProps(kind)['aria-describedby'],
                ]
                  .filter(Boolean)
                  .join(' ')}
                required
                value={aiRequest.instructions[kind]}
                disabled={creatingTask}
                maxLength={MAX_TASK_INSTRUCTIONS}
                rows={aiRequest.organize && aiRequest.implement ? 7 : 10}
                onChange={(event) =>
                  setAiRequest({
                    ...aiRequest,
                    instructions: {
                      ...aiRequest.instructions,
                      [kind]: event.target.value,
                    },
                  })
                }
              />
              <div className="ai-instructions-meta">
                <small id={`ai-instructions-help-${kind}`}>
                  원하는 내용을 자유롭게 수정하거나 추가하세요. 요청 내용은 작업
                  기록에 남습니다.
                </small>
                <small>
                  {aiRequest.instructions[kind].length.toLocaleString()} /{' '}
                  {MAX_TASK_INSTRUCTIONS.toLocaleString()}자
                </small>
              </div>
              <GamejamFieldErrors field={kind} issues={aiRequestIssues} />
            </div>
          ))}
        <p className="ai-instructions-protection">
          선택한 자료는 원본을 유지합니다. AI는 정해진 결과물만 만들거나
          수정하며, 프로젝트 권한은 그대로 적용됩니다.
        </p>
      </section>
      <section
        className="gamejam-page"
        data-gamejam-page="4"
        hidden={aiRequestPage !== 4}
      >
        <h3 className="ai-step-heading" tabIndex={-1}>
          <span>4</span> 게임에 넣을 기능{' '}
          <small className="gamejam-preview-badge">
            추가할 기능과 참고 예시
          </small>
        </h3>
        <GameFeatureLibrary
          requiresChoice={multiplayerChoiceRequired}
          multiplayer={effectiveAiRequest?.multiplayer}
          implementing={aiRequest.implement}
          onMultiplayerChange={(multiplayer) =>
            setAiRequest({ ...aiRequest, multiplayer })
          }
        />
        <GamejamFieldErrors field="multiplayer" issues={aiRequestIssues} />
      </section>
      <section
        className="gamejam-page"
        data-gamejam-page="5"
        hidden={aiRequestPage !== 5}
      >
        <h3 className="ai-step-heading" tabIndex={-1}>
          <span>5</span>{' '}
          {submittingApproval ? '최종 확인·요청' : '최종 확인·실행'}
        </h3>
        <GamejamReview
          request={effectiveAiRequest!}
          nameForPath={materialName}
          documentName={documentSetName(
            effectiveAiRequest?.documentResult?.baseDir,
          )}
          canvasName={
            canvasSheets.canvases.find(
              (sheet) => sheet.id === canvasId(effectiveAiRequest?.canvasId),
            )?.name ?? '캔버스를 선택해주세요'
          }
          busy={creatingTask}
          navigate={navigateAiPage}
        />
        <p className="ai-reasoning-summary">
          추론 강도 · {reasoningLabel(selectedAiReasoning)}
        </p>
        <p id="ai-request-status" tabIndex={-1} {...aiFieldProps('status')}>
          {submittingApproval
            ? '저장된 요청을 기준으로 관리자가 검토·실행합니다. 수정 저장 전 내용은 이 기기에만 보관되며, 구현 시작 전까지 수정·취소할 수 있습니다.'
            : '실행 전 편집 내용을 저장하며, 작업 중에는 관련 파일만 수정·삭제·이동을 제한합니다.'}
        </p>
        <GamejamFieldErrors field="status" issues={aiRequestIssues} />
        <details
          id="ai-request-connection"
          tabIndex={-1}
          className="ai-advanced-settings"
          hidden={submittingApproval}
          {...aiFieldProps('connection')}
        >
          <summary>
            AI 설정 · {getAiProvider(selectedAiProvider).label} ·{' '}
            {getAiModelLabel(selectedAiProvider, selectedAiModel || null)}
            <small>
              {codexStatus?.available && codexStatus.authenticated
                ? '연결 확인됨'
                : '연결 확인 필요'}
            </small>
          </summary>
          <GamejamFieldErrors field="connection" issues={aiRequestIssues} />
          <div className="ai-model-fields">
            <label>
              AI 제공자
              <select
                aria-label="AI 제공자"
                value={selectedAiProvider}
                disabled={creatingTask}
                onChange={(event) => {
                  setSelectedAiProvider(event.target.value as AiProviderId);
                  setCodexStatus(null);
                  setSelectedAiModel('');
                  setSelectedAiReasoning(null);
                }}
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              모델 버전
              <select
                aria-label="모델 버전"
                value={selectedAiModel}
                disabled={creatingTask}
                onChange={(event) => changeAiModel(event.target.value)}
              >
                {getAiProvider(selectedAiProvider).models.map((model) => (
                  <option key={model.id || 'default'} value={model.id}>
                    {model.label}
                  </option>
                ))}
                {selectedAiModel &&
                  !getAiProvider(selectedAiProvider).models.some(
                    (model) => model.id === selectedAiModel,
                  ) && (
                    <option value={selectedAiModel}>
                      직접 입력 · {selectedAiModel}
                    </option>
                  )}
              </select>
            </label>
          </div>
          <label className="ai-model-custom">
            모델 ID 직접 입력 (선택)
            <input
              id="ai-model-custom"
              {...aiFieldProps('model')}
              aria-label="모델 ID 직접 입력"
              value={selectedAiModel}
              disabled={creatingTask}
              maxLength={128}
              placeholder="비우면 CLI 기본 모델 사용"
              onChange={(event) => changeAiModel(event.target.value)}
            />
          </label>
          <GamejamFieldErrors field="model" issues={aiRequestIssues} />
          <AiReasoningSelect
            id="ai-reasoning-effort"
            provider={selectedAiProvider}
            model={selectedAiModel}
            value={selectedAiReasoning}
            onChange={setSelectedAiReasoning}
            disabled={creatingTask}
          />
          <GamejamFieldErrors field="reasoning" issues={aiRequestIssues} />

          <p>
            {getAiProvider(selectedAiProvider).description} 설치·로그인은 ‘AI
            연결 설정’에서 확인하세요.
          </p>
          <div className="ai-connection-summary">
            <span
              className={
                codexStatus?.available && codexStatus.authenticated
                  ? 'connection-ok'
                  : 'connection-error'
              }
            >
              {codexStatus?.available && codexStatus.authenticated
                ? `● ${getAiProvider(selectedAiProvider).label} 인증 정보 확인`
                : `● ${getAiProvider(selectedAiProvider).label} 연결 필요`}
            </span>
            <button
              disabled={creatingTask || checkingCodex}
              onClick={() => void refreshCodexStatus()}
            >
              {checkingCodex ? '확인 중…' : '연결 확인'}
            </button>
            <small>
              지시서는 내부에 보관하고 히스토리의 AI 작업 기록에서 확인합니다.
              검증에 성공한 결과만 적용하며, 실패·중지 시 기존 결과를
              유지합니다.
            </small>
          </div>
        </details>
      </section>
    </div>
  );
}
