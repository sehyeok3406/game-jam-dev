import { useRef, useState, useId, useEffect, useCallback } from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import { previewState } from '../debug/uiDebugPreviewState';
import type { DocumentSaveState } from '../../contracts/document-save-queue';
import { editorDraftMatches } from '../../editor-ux';
import { setMarkdownTaskChecked } from '../../markdown-editing';
import type { DocumentNodeData } from './types';

export type DocumentEditingInput = Pick<
  DocumentNodeData,
  | 'document'
  | 'draftRegistry'
  | 'draftKey'
  | 'saveScope'
  | 'sessionId'
  | 'locked'
  | 'onBlocked'
  | 'beginEdit'
  | 'endEdit'
  | 'onSave'
  | 'registerEditor'
  | 'reportEdit'
  | 'collaborative'
>;

/** Owns one editor's IME, draft recovery, lock and save-queue subscriptions. */
export function useDocumentEditing(data: DocumentEditingInput) {
  const { api, preferences } = useRuntime();

  const { document } = data;
  const cardRef = useRef<HTMLElement>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const finishingRef = useRef(false);
  const acknowledgedSequence = useRef(0);
  const composingRef = useRef(false);
  const compositionWaiters = useRef<(() => void)[]>([]);
  const draftSequence = useRef(Date.now() * 1000);
  const editSession = useRef(crypto.randomUUID());
  const taskBusy = useRef(false);
  const [taskError, setTaskError] = useState('');
  const [editing, setEditing] = useState(
    !!previewState('editor') && document.id === 'ui-sample-note',
  );
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [queueState, setQueueState] = useState<DocumentSaveState | null>(null);
  const lastSaveState = useRef<DocumentSaveState | null>(null);
  const [startingEdit, setStartingEdit] = useState(false);
  const [editFocus, setEditFocus] = useState<{
    title: boolean;
    point?: { x: number; y: number };
  }>({ title: false });
  const editorOwner = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const latestRef = useRef({ title, body });
  latestRef.current = { title, body };
  const savedRef = useRef({ title: document.title, body: document.body });
  const archivedDraft = useRef<{ title: string; body: string } | null>(null);
  const updateTitle = (next: string) => {
    draftSequence.current++;
    latestRef.current = { ...latestRef.current, title: next };
    setTitle(next);
  };
  const updateBody = (next: string) => {
    draftSequence.current++;
    latestRef.current = { ...latestRef.current, body: next };
    setBody(next);
  };
  const [cachedDraft, setCachedDraft] = useState<{
    title: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const raw = preferences.getItem(data.draftKey);
        const old = raw ? JSON.parse(raw) : null;
        const draft = (await api.saves.getEditorDraft(data.draftKey)) ?? old;
        const archive = await api.saves.getEditorDraft(
          `${data.draftKey}:conflict`,
        );
        if (active) {
          archivedDraft.current = archive;
          setCachedDraft(
            typeof draft?.title === 'string' && typeof draft?.body === 'string'
              ? draft
              : archive,
          );
        }
      } catch {
        if (active) setCachedDraft(null);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [data.draftKey]);

  const backupDraft = useCallback(async () => {
    const current = latestRef.current;
    const sequence = draftSequence.current;
    if (!editorDraftMatches(current, savedRef.current)) {
      await api.saves.setEditorDraft(
        dataRef.current.draftKey,
        { ...current, sequence },
        sequence,
      );
    }
  }, []);
  const acceptSave = useCallback((state: DocumentSaveState) => {
    const current = dataRef.current;
    if (
      state.scope !== current.saveScope ||
      (state.projectSession &&
        state.projectSession.sessionId !== current.sessionId) ||
      state.key !== current.draftKey ||
      state.documentId !== current.document.id
    )
      return;
    const previous = lastSaveState.current;
    if (
      previous &&
      (previous.sequence > state.sequence ||
        (previous.sequence === state.sequence &&
          previous.savedSequence > state.savedSequence))
    )
      return;
    lastSaveState.current = state;
    if (state.phase === 'discarded') {
      lastSaveState.current = null;
      setQueueState(null);
      setSaving(false);
      setSaveFailed(false);
      return;
    }
    setQueueState((previous) =>
      previous &&
      (previous.sequence > state.sequence ||
        (previous.sequence === state.sequence &&
          previous.savedSequence > state.savedSequence))
        ? previous
        : state,
    );
    setSaving(['queued', 'saving'].includes(state.phase));
    setSaveFailed(['failed', 'conflict'].includes(state.phase));
    if (
      state.savedSequence > 0 &&
      state.savedSequence >= acknowledgedSequence.current
    ) {
      acknowledgedSequence.current = state.savedSequence;
      savedRef.current = state.saved;
    }
    if (
      state.phase === 'saved' &&
      state.savedSequence >= draftSequence.current &&
      editorDraftMatches(latestRef.current, state.saved)
    ) {
      setCachedDraft(archivedDraft.current);
      void api.saves
        .setEditorDraft(current.draftKey, null, state.savedSequence)
        .catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const stop = api.saves.onDocumentSaveChanged(acceptSave);
    let active = true;
    void api.saves
      .getDocumentSaveStates()
      .then((states) => {
        if (active)
          for (const state of states) {
            if (
              state.scope === dataRef.current.saveScope &&
              state.key === dataRef.current.draftKey
            )
              draftSequence.current = Math.max(
                draftSequence.current,
                state.sequence,
              );
            acceptSave(state);
          }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop();
    };
  }, [acceptSave, data.draftKey, data.saveScope, data.sessionId]);
  useEffect(() => {
    return data.draftRegistry.register(data.draftKey, backupDraft);
  }, [data.draftRegistry, data.draftKey, backupDraft]);

  useEffect(() => {
    if (!editing) {
      setTitle(document.title);
      setBody(document.body);
      savedRef.current = { title: document.title, body: document.body };
    }
  }, [document.body, document.title, editing]);

  const persist = useCallback(
    async (finish: boolean, retry = false) => {
      if (finishingRef.current) {
        await savingRef.current;
        return;
      }
      if (finish) finishingRef.current = true;
      const operation = (async () => {
        setSaveFailed(false);
        try {
          let submitted: number;
          let released = false;
          do {
            while (composingRef.current)
              await new Promise<void>((resolve) =>
                compositionWaiters.current.push(resolve),
              );
            await backupDraft();
            const current = dataRef.current;
            submitted = draftSequence.current;
            const state = await api.saves.enqueueDocumentSave({
              scope: current.saveScope,
              key: current.draftKey,
              documentId: current.document.id,
              relativePath: current.document.relativePath,
              sequence: submitted,
              sessionId: editSession.current,
              ...latestRef.current,
              base: { ...savedRef.current },
            });
            acceptSave(state);
            if (finish || retry) {
              const states = await api.saves.flushDocumentSaves(
                current.saveScope,
                current.draftKey,
              );
              for (const ack of states) acceptSave(ack);
            }
            if (
              finish &&
              !composingRef.current &&
              submitted === draftSequence.current
            ) {
              await dataRef.current.endEdit(dataRef.current.document);
              if (composingRef.current || submitted !== draftSequence.current)
                await dataRef.current.beginEdit(dataRef.current.document);
              else released = true;
            }
          } while (finish && !released);
          if (finish) {
            setEditing(false);
          }
        } catch (error) {
          await backupDraft().catch(() => undefined);
          setTaskError(
            error instanceof Error
              ? error.message
              : '문서를 저장하지 못했습니다.',
          );
          setSaveFailed(true);
          throw error;
        }
      })();
      savingRef.current = operation;
      try {
        await operation;
      } finally {
        if (savingRef.current === operation) savingRef.current = null;
        if (finish) finishingRef.current = false;
      }
    },
    [backupDraft, acceptSave],
  );
  const save = useCallback(() => persist(false, true), [persist]);
  const finishEdit = useCallback(() => persist(true), [persist]);
  const flushRegistered = useCallback(
    (finish = true) => persist(finish, !finish),
    [persist],
  );
  const loadLatest = async () => {
    if (!queueState || !['conflict', 'failed'].includes(queueState.phase))
      return;
    await backupDraft();
    const current = await api.editor.getDocument(document.relativePath);
    if (!current || current.id !== document.id)
      throw new Error(
        '문서가 이동되거나 삭제되었습니다. 초안을 복사해 보관해주세요.',
      );
    const archive = { ...latestRef.current, sequence: draftSequence.current };
    await api.saves.setEditorDraft(
      `${data.draftKey}:conflict`,
      archive,
      draftSequence.current,
    );
    archivedDraft.current = archive;
    await api.saves.discardDocumentSave(
      data.saveScope,
      data.draftKey,
      queueState.sequence,
    );
    setCachedDraft({ ...latestRef.current });
    savedRef.current = { title: current.title, body: current.body };
    acknowledgedSequence.current = 0;
    lastSaveState.current = null;
    draftSequence.current++;
    latestRef.current = { title: current.title, body: current.body };
    setTitle(current.title);
    setBody(current.body);
    setQueueState(null);
    setSaveFailed(false);
    setSaving(false);
  };
  const dirty =
    editing && !editorDraftMatches({ title, body }, savedRef.current);
  useEffect(() => {
    data.reportEdit(document.id, { dirty, saving, failed: saveFailed });
  }, [data.reportEdit, document.id, dirty, saving, saveFailed]);
  const toggleTask = async (offset: number, checked: boolean) => {
    if (taskBusy.current || startingEdit || editing) return;
    if (data.locked) {
      data.onBlocked();
      return;
    }
    taskBusy.current = true;
    setSaving(true);
    setTaskError('');
    let acquired = false;
    try {
      await data.beginEdit(document);
      acquired = true;
      const current = (await api.editor.listDocuments()).find(
        (item) => item.relativePath === document.relativePath,
      );
      if (!current || current.body !== document.body)
        throw new Error(
          '문서가 변경되었습니다. 다시 표시된 체크리스트에서 눌러주세요.',
        );
      const next = setMarkdownTaskChecked(current.body, offset, checked);
      await data.onSave(current, current.title, next);
    } catch (error) {
      setTaskError(
        error instanceof Error
          ? error.message
          : '체크리스트를 저장하지 못했습니다. 다시 시도해주세요.',
      );
    } finally {
      if (acquired) {
        try {
          await data.endEdit(document);
        } catch {
          setTaskError(
            '체크리스트 편집 잠금을 해제하지 못했습니다. 연결 상태를 확인해주세요.',
          );
        }
      }
      taskBusy.current = false;
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!editing || editorDraftMatches({ title, body }, savedRef.current))
      return;
    const timer = setTimeout(
      () => void backupDraft().catch(() => setSaveFailed(true)),
      300,
    );
    return () => clearTimeout(timer);
  }, [editing, title, body, backupDraft]);
  useEffect(() => {
    if (
      !editing ||
      editorDraftMatches({ title, body }, savedRef.current) ||
      data.locked ||
      saveFailed
    )
      return;
    const timer = setTimeout(() => {
      if (!composingRef.current && !finishingRef.current)
        void persist(false).catch(() => undefined);
    }, 1000);
    return () => clearTimeout(timer);
  }, [editing, title, body, data.locked, saveFailed, persist]);
  useEffect(() => {
    if (!editing || data.locked || saveFailed) return;
    const timer = setInterval(() => {
      if (
        !composingRef.current &&
        !finishingRef.current &&
        !editorDraftMatches(latestRef.current, savedRef.current)
      )
        void persist(false).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [editing, data.locked, saveFailed, persist]);
  const setComposing = (value: boolean) => {
    composingRef.current = value;
    if (!value)
      requestAnimationFrame(() => {
        for (const resolve of compositionWaiters.current.splice(0)) resolve();
      });
  };

  const startEdit = async (focus: typeof editFocus = { title: false }) => {
    if (startingEdit || taskBusy.current) return;
    if (data.locked) {
      data.onBlocked();
      return;
    }
    setStartingEdit(true);
    try {
      await data.beginEdit(document);
      editSession.current = crypto.randomUUID();
      draftSequence.current++;
      if (!lastSaveState.current || lastSaveState.current.phase === 'saved')
        savedRef.current = { title: document.title, body: document.body };
      setTaskError('');
      setEditFocus(focus);
      setEditing(true);
    } catch {
      /* parent displays the lock/connection error */
    } finally {
      setStartingEdit(false);
    }
  };

  useEffect(() => {
    if (editing && editFocus.title) titleRef.current?.focus();
  }, [editing, editFocus.title]);

  useEffect(() => {
    data.registerEditor(document.id, editing ? flushRegistered : null);
    return () => data.registerEditor(document.id, null);
  }, [data.registerEditor, document.id, editing, flushRegistered]);

  useEffect(() => {
    if (!editing) return;
    const finishEditingOutside = (event: PointerEvent) => {
      if (window.document.querySelector('.ui-debug-console[open]')) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target
          .closest('[data-editor-owner]')
          ?.getAttribute('data-editor-owner') === editorOwner
      )
        return;
      if (
        target instanceof Element &&
        target.closest('.react-flow__node') ===
          cardRef.current?.closest('.react-flow__node')
      )
        return;
      if (target instanceof Node && !cardRef.current?.contains(target)) {
        void finishEdit().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', finishEditingOutside, true);
    return () =>
      window.removeEventListener('pointerdown', finishEditingOutside, true);
  }, [editing, finishEdit, editorOwner]);

  const editStatus = data.locked
    ? '편집 잠김 · 초안은 유지됩니다'
    : queueState?.phase === 'conflict'
      ? '충돌 · 초안은 이 PC에 보관됨'
      : queueState?.phase === 'offline'
        ? '이 PC에 보관됨 · 연결 후 전송'
        : saveFailed
          ? '저장 실패 · 초안 보관됨'
          : saving
            ? '저장 중…'
            : dirty
              ? '자동 저장 대기…'
              : data.collaborative
                ? '서버에 저장됨'
                : '저장됨';

  const restoreDraft = () => {
    if (!cachedDraft) return;

    draftSequence.current++;
    setTitle(cachedDraft.title);
    setBody(cachedDraft.body);
    latestRef.current = {
      title: cachedDraft.title,
      body: cachedDraft.body,
    };
    archivedDraft.current = null;
    const sequence = draftSequence.current;
    void api.saves
      .setEditorDraft(data.draftKey, { ...cachedDraft, sequence }, sequence)
      .then(() =>
        api.saves.setEditorDraft(`${data.draftKey}:conflict`, null, sequence),
      )
      .catch(() => setSaveFailed(true));
    setCachedDraft(null);
  };

  return {
    cardRef,
    titleRef,
    editing,
    title,
    body,
    saving,
    startingEdit,
    editFocus,
    editorOwner,
    taskError,
    cachedDraft,
    queueState,
    saveFailed,
    editStatus,
    setComposing,
    updateTitle,
    updateBody,
    finishEdit,
    save,
    loadLatest,
    setTaskError,
    startEdit,
    toggleTask,
    restoreDraft,
    finishing: finishingRef.current,
  };
}
