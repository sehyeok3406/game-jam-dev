import { Columns2, Folder, History, X } from 'lucide-react';
import { entryTaskRecord, relatedAiEntries } from '../../ai-task-records.ts';
import { authorLabel } from '../../author-label.ts';
import type { DocumentStatuses } from '../../document-statuses.ts';
import {
  statusPropertyApplied,
  type FilePropertyViews,
} from '../../file-properties.ts';
import type {
  CanvasDocument,
  CanvasSection,
  FileAuthorship,
  HistoryEntry,
  PreviewResult,
} from '../../shared.ts';
import type { CanvasItem } from '../CanvasOverlays';
import { TYPE_LABELS, statusLabel } from '../documents/presentation.ts';
import { FilePropertiesEditor } from '../FileProperties';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import {
  CODEX_STATUS_LABELS,
  previewNodeId,
  sectionNodeId,
} from '../workspace/workspace-types.ts';
interface Props {
  inspectorId: string | null;
  canvasItems: CanvasItem[];
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  statusSettings: { value: DocumentStatuses; raw: string | null };
  inspectorAuthorship: {
    path: string;
    value?: FileAuthorship;
    error?: boolean;
  } | null;
  propertyVisibilityFor: (
    id: string,
    previousIds?: string[],
  ) => Partial<
    Record<
      'status' | 'createdBy' | 'createdAt' | 'lastEditedBy' | 'lastEditedAt',
      boolean
    >
  >;
  workflowEditable: boolean;
  workflowBusy: boolean;
  pathLocked: (path: string) => boolean;
  workflowReason: string;
  workflowChange: (
    input: import('../../file-properties').StatusPropertyInput,
  ) => Promise<void>;
  updateFilePropertyViews: (value: FilePropertyViews) => void;
  filePropertyViews: FilePropertyViews;
  setStatusManagerOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  focusSource: (id: string) => void;
  locked: boolean;
  setSectionRename: (
    value: import('react').SetStateAction<
      import('../canvas/section-actions').SectionRenamePrompt | null
    >,
  ) => void;
  jumpTo: (id: string) => void;
  inspectorAiRecords: {
    path: string;
    entries?: HistoryEntry[];
    error?: boolean;
  } | null;
  taskDocuments: CanvasDocument[];
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  api: import('../../contracts/app-api').AppApi;
  setCompareFirst: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
}
export function WorkspaceInspector({
  inspectorId,
  canvasItems,
  documents,
  sections,
  previews,
  setInspectorId,
  statusSettings,
  inspectorAuthorship,
  propertyVisibilityFor,
  workflowEditable,
  workflowBusy,
  pathLocked,
  workflowReason,
  workflowChange,
  updateFilePropertyViews,
  filePropertyViews,
  setStatusManagerOpen,
  focusSource,
  locked,
  setSectionRename,
  jumpTo,
  inspectorAiRecords,
  taskDocuments,
  openHistory,
  api,
  setCompareFirst,
}: Props) {
  return (
    <>
      {inspectorId &&
        (() => {
          const item = canvasItems.find((item) => item.id === inspectorId),
            doc = documents.find((doc) => doc.id === inspectorId),
            section = sections.find(
              (section) => sectionNodeId(section.id) === inspectorId,
            ),
            preview = previews.find(
              (preview) => previewNodeId(preview.relativePath) === inspectorId,
            );
          if (!item) return null;
          return (
            <aside
              className="object-inspector floating-surface"
              aria-label="선택 항목 상세 정보"
            >
              <header>
                <strong>상세 정보</strong>
                <button
                  className="icon-button"
                  title="상세 정보 닫기"
                  onClick={() => setInspectorId(null)}
                >
                  <X size={16} />
                </button>
              </header>
              <h3>{item.title}</h3>
              <dl>
                <dt>파일</dt>
                <dd>
                  <code>{item.path}</code>
                </dd>
                {(doc || section || preview?.sourceId) && (
                  <>
                    <dt>ID</dt>
                    <dd>
                      <code>{doc?.id ?? section?.id ?? preview?.sourceId}</code>
                    </dd>
                  </>
                )}
                {doc && (
                  <>
                    <dt>문서 유형</dt>
                    <dd>
                      {TYPE_LABELS[doc.type]} · {statusLabel(doc.status)}
                    </dd>
                    <dt>위치 · 크기</dt>
                    <dd>
                      {doc.x}, {doc.y} · {doc.width} × {doc.height}
                    </dd>
                    <dt>최근 변경</dt>
                    <dd>{new Date(doc.modifiedAt).toLocaleString('ko-KR')}</dd>
                    <dt>소속 섹션</dt>
                    <dd>{item.parent ?? '섹션 없음'}</dd>
                  </>
                )}
              </dl>
              {((doc && doc.type !== 'ai-task') || preview) && (
                <FilePropertiesEditor
                  key={doc?.id ?? preview!.sourceId}
                  document={doc ?? preview!}
                  statuses={statusSettings.value}
                  authorship={
                    inspectorAuthorship?.path === item.path
                      ? inspectorAuthorship.value
                      : undefined
                  }
                  visibility={propertyVisibilityFor(
                    doc?.id ?? preview!.sourceId!,
                    preview?.propertyPreviousIds ?? [],
                  )}
                  disabled={
                    !workflowEditable ||
                    workflowBusy ||
                    pathLocked(item.path) ||
                    pathLocked(preview?.sourcePath ?? '')
                  }
                  reason={
                    workflowReason ||
                    (pathLocked(item.path) ||
                    pathLocked(preview?.sourcePath ?? '')
                      ? 'AI 작업이 이 파일을 보호하고 있습니다.'
                      : undefined)
                  }
                  change={async (value) => {
                    const file = doc ?? preview!;
                    await workflowChange({
                      relativePath: item.path,
                      objectId: doc?.id ?? preview!.sourceId!,
                      expectedEnabled: statusPropertyApplied(file),
                      expectedStatus: file.workflowStatusId,
                      workflowRevision: doc?.workflowRevision,
                      structureRevision: doc?.structureRevision,
                      ...value,
                    });
                  }}
                  display={(id, visible) => {
                    const key = doc?.id ?? preview!.sourceId!;
                    const aliases = preview?.propertyPreviousIds ?? [];
                    const value = {
                      ...propertyVisibilityFor(key, aliases),
                      [id]: visible,
                    };
                    updateFilePropertyViews({
                      version: 1,
                      files: {
                        ...filePropertyViews.files,
                        ...Object.fromEntries(
                          [key, ...aliases].map((alias) => [alias, value]),
                        ),
                      },
                    });
                  }}
                  manage={() => setStatusManagerOpen(true)}
                />
              )}
              {!((doc && doc.type !== 'ai-task') || preview) && (
                <dl className="inspector-authorship">
                  <dt>생성한 사람</dt>
                  <dd>
                    {inspectorAuthorship?.path === item.path &&
                    inspectorAuthorship.value
                      ? authorLabel(inspectorAuthorship.value.createdBy)
                      : inspectorAuthorship?.path === item.path &&
                          inspectorAuthorship.error
                        ? '정보를 불러오지 못했습니다'
                        : '기록 불러오는 중…'}
                    {inspectorAuthorship?.path === item.path &&
                      inspectorAuthorship.value?.createdAt && (
                        <small>
                          {new Date(
                            inspectorAuthorship.value.createdAt,
                          ).toLocaleString('ko-KR')}
                        </small>
                      )}
                  </dd>
                  <dt title="본문·제목·위치·크기·섹션 등 파일 변경을 포함합니다">
                    마지막으로 편집한 사람
                  </dt>
                  <dd>
                    {inspectorAuthorship?.path === item.path &&
                    inspectorAuthorship.value
                      ? authorLabel(inspectorAuthorship.value.lastEditedBy)
                      : inspectorAuthorship?.path === item.path &&
                          inspectorAuthorship.error
                        ? '정보를 불러오지 못했습니다'
                        : '기록 불러오는 중…'}
                    {inspectorAuthorship?.path === item.path &&
                      inspectorAuthorship.value?.lastEditedAt && (
                        <small>
                          {new Date(
                            inspectorAuthorship.value.lastEditedAt,
                          ).toLocaleString('ko-KR')}
                        </small>
                      )}
                  </dd>
                </dl>
              )}
              {doc?.sources.length ? (
                <div className="inspector-sources">
                  <strong>참고한 원본 자료 {doc.sources.length}개</strong>
                  {doc.sources.map((source) => (
                    <button
                      key={source.id}
                      title={source.contribution}
                      onClick={() => focusSource(source.id)}
                    >
                      {documents.find((doc) => doc.id === source.id)?.title ??
                        previews.find(
                          (preview) => preview.sourceId === source.id,
                        )?.title ??
                        source.id}
                      <small>{source.contribution}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {section && (
                <>
                  <button
                    disabled={locked}
                    onClick={() =>
                      setSectionRename({ section, title: section.title })
                    }
                  >
                    섹션 이름 변경
                  </button>
                  <strong>포함 문서 {section.members.length}개</strong>
                  {section.members.map((member) => (
                    <button key={member.id} onClick={() => jumpTo(member.id)}>
                      {documents.find((doc) => doc.id === member.id)?.title ??
                        member.path}
                    </button>
                  ))}
                </>
              )}
              {!section && (
                <div
                  className="inspector-sources"
                  aria-label="관련 AI 작업 기록"
                >
                  <strong>관련 AI 작업 기록</strong>
                  {inspectorAiRecords?.path !== item.path ||
                  !inspectorAiRecords.entries ? (
                    <small>
                      {inspectorAiRecords?.error
                        ? '기록을 불러오지 못했습니다.'
                        : '기록 불러오는 중…'}
                    </small>
                  ) : (
                    (() => {
                      const entries = relatedAiEntries(
                        inspectorAiRecords.entries,
                        item.path,
                        taskDocuments,
                        previews.find(
                          (preview) => preview.relativePath === item.path,
                        )?.previousPaths,
                      );
                      return entries.length ? (
                        <>
                          {entries.slice(0, 3).map((entry) => (
                            <button
                              key={entry.id}
                              onClick={() =>
                                openHistory(item.path, true, entry)
                              }
                            >
                              {entryTaskRecord(entry, taskDocuments)?.title ??
                                entry.label}
                              <small>
                                {new Date(entry.createdAt).toLocaleString(
                                  'ko-KR',
                                )}{' '}
                                · {CODEX_STATUS_LABELS[entry.status]} ·{' '}
                                {entry.actorName ?? '로컬 사용자'}
                              </small>
                            </button>
                          ))}
                          <button onClick={() => openHistory(item.path, true)}>
                            AI 작업 기록 전체 보기 ({entries.length})
                          </button>
                        </>
                      ) : (
                        <small>이 결과와 연결된 AI 실행 기록이 없습니다.</small>
                      );
                    })()
                  )}
                </div>
              )}
              <div className="inspector-actions">
                <button
                  onClick={() =>
                    void requireDesktopApi(api).revealPath(item.path)
                  }
                >
                  <Folder size={14} /> 파일 보기
                </button>
                <button onClick={() => void openHistory(item.path)}>
                  <History size={14} /> 히스토리
                </button>
                {preview && (
                  <button onClick={() => setCompareFirst(preview.relativePath)}>
                    <Columns2 size={14} /> 버전 비교
                  </button>
                )}
              </div>
            </aside>
          );
        })()}
    </>
  );
}
