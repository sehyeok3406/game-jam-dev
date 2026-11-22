import { useRuntime } from '../runtime/runtime-context.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { retainUnchangedRecords } from '../../core/editing/record-identity.ts';
import {
  applyDrawing,
  drawingPath,
  serializeDrawing,
} from '../../drawing-model';
import type {
  DrawingCommand,
  DrawingItem,
  DrawingObject,
} from '../../drawing-types';
import { DraftCheckpoint } from '../editor/draft-checkpoint';

const draftKey = (scope: string) => `drawing:${scope}`;

const optimistic = (items: DrawingItem[], command: DrawingCommand) => {
  const files: Record<string, string> = {};
  for (const c of new Set(
    [
      ...items.map((o) => o.canvasId),
      command.canvasId,
      command.targetCanvasId,
    ].filter((c): c is string => !!c),
  ))
    files[drawingPath(c)] = serializeDrawing({
      version: 1,
      canvasId: c,
      objects: items
        .filter((o) => o.canvasId === c)
        .map(({ canvasId: _canvasId, ...o }) => o),
    });
  const next = applyDrawing(files, command);
  const affected = new Set([
    ...(command.objects ?? []).map((object) => object.id),
    ...(command.patches ?? []).map((patch) => patch.id),
    ...(command.targets ?? []).map((target) => target.id),
    ...(command.erasures ?? []).map((erasure) => erasure.id),
  ]);
  const previous = new Map(items.map((item) => [item.id, item]));
  return Object.entries(next).flatMap(([p, raw]) => {
    const c = p.slice('.canvas/drawings/'.length, -5);
    return (JSON.parse(raw).objects as DrawingObject[]).map((o) =>
      !affected.has(o.id) && previous.has(o.id)
        ? previous.get(o.id)!
        : {
            ...o,
            canvasId: c,
          },
    );
  });
};
export function useDrawing(
  scope: string | undefined,
  canvasId: string,
  sessionId?: string,
) {
  const { api } = useRuntime();
  const deferred =
    scope?.startsWith('local:') &&
    !!sessionId &&
    !!api.saves.recoverDrawingBatch;
  const [batchRecovery, setBatchRecovery] = useState(false);
  const [drawingPersistence, setDrawingPersistence] = useState<
    'pending' | 'draft' | 'saved'
  >('saved');

  const signatures = useRef<Record<string, string> | null>(null);
  const [confirmed, setConfirmed] = useState<DrawingItem[]>([]),
    [pending, setPending] = useState<DrawingCommand[]>([]),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState<DrawingCommand[] | null>(null);
  const state = useRef({
    scope,
    sessionId,
    commands: [] as DrawingCommand[],
    confirmed: [] as DrawingItem[],
    partial: null as DrawingCommand | null,
    recovery: [] as DrawingCommand[],
    sequence: Date.now() * 1000,
    lastActivity: 0,
    epoch: 0,
  });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const showDraftError = useCallback((error: unknown) => {
    setError(`그림 초안 보관 실패: ${String(error)}`);
  }, []);
  const checkpoint = useMemo(
    () =>
      new DraftCheckpoint(
        (draft, sequence) =>
          api.saves.setEditorDraft(draftKey(scope!), draft, sequence),
        showDraftError,
      ),
    [api, scope, sessionId, showDraftError],
  );
  const readDraft = useCallback(() => {
    const s = state.current;
    if (!scope || s.scope !== scope || s.sessionId !== sessionId) return null;
    const commands = [...s.recovery, ...s.commands];
    if (s.partial) commands.push(s.partial);
    return commands.length
      ? {
          title: '그림 복구',
          body: JSON.stringify(commands),
          sequence: ++s.sequence,
        }
      : null;
  }, [scope, sessionId]);
  const backup = useCallback(
    () => checkpoint.flush(readDraft),
    [checkpoint, readDraft],
  );
  const removeSaved = useCallback(
    (matches: (command: DrawingCommand) => boolean, staged = false) => {
      const s = state.current;
      return checkpoint.reviseSaved(async (saved) => {
        if (
          s !== state.current ||
          s.scope !== scope ||
          s.sessionId !== sessionId
        )
          return;
        const commands = JSON.parse(saved.body) as DrawingCommand[];
        const remaining = commands.filter((cmd) => !matches(cmd));
        if (commands.length === remaining.length) return;
        if (staged && deferred && scope && sessionId)
          await api.saves.checkpointLocalDrawings?.(scope, sessionId);
        if (s !== state.current) return;
        const sequence = ++s.sequence;
        return {
          sequence,
          draft: remaining.length
            ? { ...saved, body: JSON.stringify(remaining), sequence }
            : null,
        };
      });
    },
    [api, checkpoint, deferred, scope, sessionId],
  );
  const reload = useCallback(async () => {
    const s = state.current,
      epoch = ++s.epoch,
      root = s.scope;
    if (!root || !api.editor.listDrawings) return;
    const known = signatures.current;
    const changes = await api.editor.getDrawingChanges?.(known ?? {});
    const objects = changes
      ? (() => {
          const values = new Map(
            (known ? s.confirmed : [])
              .filter((o) => !changes.removed.includes(o.id))
              .map((o) => [o.id, o]),
          );
          for (const o of changes.changed) values.set(o.id, o);
          return [...values.values()];
        })()
      : await api.editor.listDrawings();
    if (state.current !== s || s.epoch !== epoch) return;
    signatures.current = changes?.signatures ?? null;
    const stable = retainUnchangedRecords(s.confirmed, objects);
    s.confirmed = stable;
    setConfirmed(stable);
  }, []);
  useEffect(() => {
    state.current = {
      scope,
      sessionId,
      commands: [],
      confirmed: [],
      partial: null,
      recovery: [],
      sequence: Date.now() * 1000,
      lastActivity: 0,
      epoch: 0,
    };
    signatures.current = null;
    chain.current = Promise.resolve();
    setPending([]);
    setConfirmed([]);
    setRecovery(null);
    setBatchRecovery(false);
    setDrawingPersistence('saved');
    setError('');
    if (!scope) return;
    let active = true;
    void reload().catch((e) => active && setError(String(e)));
    if (deferred)
      void api.saves
        .getEditorDraft(
          `game-canvas-drawing-batch:${scope.slice('local:'.length)}`,
        )
        .then((draft) => {
          if (active) setBatchRecovery(!!draft);
        })
        .catch((error) => active && showDraftError(error));
    void api.saves
      .getEditorDraft(draftKey(scope))
      .then((d) => {
        if (!active || !d) return;
        state.current.sequence = Math.max(state.current.sequence, d.sequence);
        const commands = JSON.parse(d.body) as DrawingCommand[];
        if (Array.isArray(commands)) {
          checkpoint.remember(d);
        }
        if (Array.isArray(commands) && commands.length) {
          state.current.recovery = commands;
          setRecovery(commands);
        }
      })
      .catch((e) => active && setError(`그림 초안 읽기 실패: ${String(e)}`));
    const stop = api.projects.onWorkspaceChanged((change) => {
      if (change?.sessionId === sessionId && change?.drawingPersistence)
        setDrawingPersistence(change.drawingPersistence);
      if (!change || (change.sessionId === sessionId && change.drawings))
        void reload().catch((e) => active && setError(String(e)));
    });
    return () => {
      active = false;
      checkpoint.cancelTimer();
      stop();
    };
  }, [scope, sessionId, reload, checkpoint, deferred, showDraftError]);
  const drain = useCallback(
    async (s: typeof state.current) => {
      while (s === state.current && s.commands.length) {
        const cmd = s.commands[0];
        try {
          const result = await api.editor.applyDrawingCommand(
            cmd,
            deferred ? sessionId : undefined,
          );
          if (state.current !== s) return;
          s.epoch++;
          // The command returns a full list without the signatures for that list.
          signatures.current = null;
          const stable = retainUnchangedRecords(s.confirmed, result);
          s.confirmed = stable;
          s.commands.shift();
          setConfirmed(stable);
          setPending([...s.commands]);
          setError('');
        } catch (e) {
          if (state.current !== s) return;
          await backup().catch(showDraftError);
          if (state.current !== s) return;
          setError(
            `그림 저장 실패: ${e instanceof Error ? e.message : String(e)}`,
          );
          throw e;
        }
        // Prune a checkpoint that included this command without writing a new
        // checkpoint for any newer gesture that may already be in progress.
        await removeSaved(
          (saved) => saved.requestId === cmd.requestId,
          true,
        ).catch((error) => state.current === s && showDraftError(error));
      }
    },
    [api, backup, removeSaved, showDraftError, deferred, sessionId],
  );
  const submit = useCallback(
    async (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => {
      const s = state.current;
      if (!s.scope || s.scope !== scope || s.sessionId !== sessionId)
        return Promise.reject(new Error('프로젝트를 먼저 열어주세요.'));
      const gesture = s.partial;
      const completesGesture =
        command.action === 'create' &&
        gesture !== null &&
        gesture.objects?.[0]?.id === command.objects?.[0]?.id;
      const cmd: DrawingCommand = {
        ...structuredClone(command),
        canvasId: command.canvasId ?? canvasId,
        scope: s.scope,
        requestId:
          command.requestId ??
          (completesGesture ? gesture.requestId : crypto.randomUUID()),
      };
      try {
        let current = s.confirmed;
        for (const p of s.commands) current = optimistic(current, p);
        optimistic(current, cmd);
      } catch (error) {
        // Local quota/conflict failures must be recoverable too; never throw
        // synchronously out of a pointer event or lose the completed gesture.
        if (completesGesture) s.partial = null;
        s.recovery.unshift(cmd);
        setRecovery([...s.recovery]);
        setError(
          `그림 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
        await backup().catch(showDraftError);
        throw error;
      }
      s.commands.push(cmd);
      s.epoch++;
      setPending([...s.commands]);
      if (completesGesture) s.partial = null;
      checkpoint.schedule(readDraft);
      const next = chain.current.catch(() => undefined).then(() => drain(s));
      chain.current = next;
      return next;
    },
    [
      canvasId,
      drain,
      backup,
      checkpoint,
      readDraft,
      showDraftError,
      scope,
      sessionId,
    ],
  );
  const flush = useCallback(async () => {
    const s = state.current;
    await chain.current;
    if (s !== state.current) return;
    await backup();
    if (s.commands.length)
      throw new Error('그림 저장을 완료한 뒤 다시 시도해주세요.');
  }, [backup]);
  const retry = () => {
    const s = state.current;
    const next = chain.current.catch(() => undefined).then(() => drain(s));
    chain.current = next;
    void next.catch(() => undefined);
  };
  const recover = async () => {
    const s = state.current;
    if (batchRecovery && scope && sessionId) {
      await api.saves.recoverDrawingBatch?.(scope, sessionId, 'restore');
      if (state.current !== s) return;
      setBatchRecovery(false);
      await reload();
    }
    if (!recovery) return;
    const existing = new Set(s.confirmed.map((o) => o.id));
    setRecovery(null);
    for (const original of recovery) {
      if (state.current !== s) return;
      s.recovery = s.recovery.filter((cmd) => cmd !== original);
      const cmd =
        original.action === 'create'
          ? {
              ...original,
              objects: original.objects?.filter((o) => !existing.has(o.id)),
            }
          : original;
      try {
        if (cmd.action === 'create' && !cmd.objects?.length) {
          await removeSaved(
            (saved) => JSON.stringify(saved) === JSON.stringify(original),
          );
        } else {
          await submit(cmd);
          if (state.current !== s) return;
          if (!original.requestId)
            await removeSaved(
              (saved) => JSON.stringify(saved) === JSON.stringify(original),
              true,
            );
        }
      } catch (error) {
        // submit keeps failed commands in the pending queue; remaining recovery survives.
        if (state.current === s)
          setRecovery(s.recovery.length ? [...s.recovery] : null);
        throw error;
      }
    }
    if (state.current === s) await backup();
  };
  const discardRecovery = async () => {
    const s = state.current;
    if (batchRecovery && scope && sessionId) {
      await api.saves.recoverDrawingBatch?.(scope, sessionId, 'discard');
      if (state.current !== s) return;
      setBatchRecovery(false);
    }
    const discarded = s.recovery;
    s.recovery = [];
    const payloads = new Set(discarded.map((cmd) => JSON.stringify(cmd)));
    try {
      await removeSaved((saved) => payloads.has(JSON.stringify(saved)));
    } catch (error) {
      if (state.current === s) {
        s.recovery = [...discarded, ...s.recovery];
        showDraftError(error);
      }
      throw error;
    }
    if (state.current !== s) return;
    setRecovery(null);
    if (!s.commands.length) setError('');
  };
  const hold = async () => {
    const s = state.current;
    await chain.current.catch(() => undefined);
    if (state.current !== s) return;
    s.recovery.push(...s.commands);
    s.commands = [];
    s.partial = null;
    s.epoch++;
    setRecovery([...s.recovery]);
    setPending([]);
    setError('');
    chain.current = Promise.resolve();
    await backup();
  };
  const partial = useCallback(
    (object: DrawingObject | null) => {
      const s = state.current;
      const previous = s.partial;
      s.partial = object
        ? {
            canvasId,
            scope: s.scope,
            action: 'create',
            objects: [object],
            requestId: object.id,
          }
        : null;
      if (object) {
        checkpoint.schedule(readDraft);
        const now = Date.now();
        if (deferred && scope && sessionId && now - s.lastActivity >= 150) {
          s.lastActivity = now;
          void api.saves
            .touchLocalEditing?.(scope, sessionId)
            .catch(() => undefined);
        }
      } else if (previous)
        void removeSaved(
          (saved) => saved.requestId === previous.requestId,
        ).catch((error) => state.current === s && showDraftError(error));
    },
    [
      api,
      canvasId,
      checkpoint,
      deferred,
      readDraft,
      removeSaved,
      scope,
      sessionId,
      showDraftError,
    ],
  );
  const items = useMemo(() => {
    let current = confirmed;
    for (const cmd of pending) {
      try {
        current = optimistic(current, cmd);
      } catch {
        /* Retain server objects; failed command remains recoverable. */
      }
    }
    return current;
  }, [confirmed, pending]);
  return {
    items,
    submit,
    flush,
    reload,
    partial,
    error,
    recovery: recovery ?? (batchRecovery ? [] : null),
    recover,
    discardRecovery,
    retry,
    hold,
    saving: pending.length > 0,
    drawingPersistence,
  };
}
