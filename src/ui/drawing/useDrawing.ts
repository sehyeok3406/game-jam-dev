import { useRuntime } from '../runtime/runtime-context.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  return Object.entries(next).flatMap(([p, raw]) => {
    const c = p.slice('.canvas/drawings/'.length, -5);
    return (JSON.parse(raw).objects as DrawingObject[]).map((o) => ({
      ...o,
      canvasId: c,
    }));
  });
};
export function useDrawing(scope: string | undefined, canvasId: string) {
  const { api } = useRuntime();

  const signatures = useRef<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<DrawingItem[]>([]),
    [pending, setPending] = useState<DrawingCommand[]>([]),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState<DrawingCommand[] | null>(null);
  const state = useRef({
    scope,
    commands: [] as DrawingCommand[],
    confirmed: [] as DrawingItem[],
    partial: null as DrawingCommand | null,
    recovery: [] as DrawingCommand[],
    persisted: false,
    sequence: Date.now(),
    epoch: 0,
  });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const key = (s: string) => `drawing:${s}`;
  const backup = useCallback(async () => {
    const s = state.current;
    if (!s.scope) return;
    const commands = [
        ...s.recovery,
        ...s.commands,
        ...(s.partial ? [s.partial] : []),
      ],
      sequence = ++s.sequence;
    if (!commands.length && !s.persisted) return;
    await api.saves.setEditorDraft(
      key(s.scope),
      commands.length
        ? { title: '그림 복구', body: JSON.stringify(commands), sequence }
        : null,
      sequence,
    );
    if (s.sequence === sequence) s.persisted = commands.length > 0;
  }, []);
  const reload = useCallback(async () => {
    const s = state.current,
      epoch = s.epoch,
      root = s.scope;
    if (!root || !api.editor.listDrawings) return;
    const changes = await api.editor.getDrawingChanges?.(signatures.current);
    const objects = changes
      ? (() => {
          const values = new Map(
            s.confirmed
              .filter((o) => !changes.removed.includes(o.id))
              .map((o) => [o.id, o]),
          );
          for (const o of changes.changed) values.set(o.id, o);
          return [...values.values()];
        })()
      : await api.editor.listDrawings();
    if (state.current.scope !== root || state.current.epoch !== epoch) return;
    if (changes) signatures.current = changes.signatures;
    s.confirmed = objects;
    setConfirmed(objects);
  }, []);
  useEffect(() => {
    state.current = {
      scope,
      commands: [],
      confirmed: [],
      partial: null,
      recovery: [],
      persisted: false,
      sequence: Date.now(),
      epoch: 0,
    };
    signatures.current = {};
    chain.current = Promise.resolve();
    setPending([]);
    setConfirmed([]);
    setRecovery(null);
    setError('');
    if (!scope) return;
    let active = true;
    void reload().catch((e) => active && setError(String(e)));
    void api.saves
      .getEditorDraft(key(scope))
      .then((d) => {
        if (!active || !d) return;
        state.current.persisted = true;
        state.current.sequence = Math.max(state.current.sequence, d.sequence);
        const commands = JSON.parse(d.body) as DrawingCommand[];
        if (Array.isArray(commands) && commands.length) {
          state.current.recovery = commands;
          setRecovery(commands);
        }
      })
      .catch((e) => active && setError(`그림 초안 읽기 실패: ${String(e)}`));
    const stop = api.projects.onWorkspaceChanged(
      () => void reload().catch((e) => active && setError(String(e))),
    );
    return () => {
      active = false;
      stop();
    };
  }, [scope, reload]);
  const drain = useCallback(async () => {
    const s = state.current;
    while (s.commands.length) {
      const cmd = s.commands[0];
      try {
        await backup();
        const result = await api.editor.applyDrawingCommand(cmd);
        if (state.current !== s) return;
        s.epoch++;
        const previous = new Map(s.confirmed.map((o) => [o.id, o]));
        const stable = result.map((o) =>
          JSON.stringify(previous.get(o.id)) === JSON.stringify(o)
            ? previous.get(o.id)!
            : o,
        );
        s.confirmed = stable;
        s.commands.shift();
        setConfirmed(stable);
        setPending([...s.commands]);
        setError('');
        await backup();
      } catch (e) {
        setError(
          `그림 저장 실패: ${e instanceof Error ? e.message : String(e)}`,
        );
        throw e;
      }
    }
  }, [backup]);
  const submit = useCallback(
    async (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => {
      const s = state.current;
      if (!s.scope)
        return Promise.reject(new Error('프로젝트를 먼저 열어주세요.'));
      const cmd: DrawingCommand = {
        ...structuredClone(command),
        canvasId: command.canvasId ?? canvasId,
        scope: s.scope,
        requestId: command.requestId ?? crypto.randomUUID(),
      };
      try {
        let current = s.confirmed;
        for (const p of s.commands) current = optimistic(current, p);
        optimistic(current, cmd);
      } catch (error) {
        // Local quota/conflict failures must be recoverable too; never throw
        // synchronously out of a pointer event or lose the completed gesture.
        s.partial = null;
        s.recovery.unshift(cmd);
        setRecovery([...s.recovery]);
        setError(
          `그림 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
        await backup();
        throw error;
      }
      s.commands.push(cmd);
      s.epoch++;
      setPending([...s.commands]);
      s.partial = null;
      const next = chain.current.catch(() => undefined).then(drain);
      chain.current = next;
      return next;
    },
    [canvasId, drain, backup],
  );
  const flush = useCallback(async () => {
    await backup();
    await chain.current;
    if (state.current.commands.length)
      throw new Error('그림 저장을 완료한 뒤 다시 시도해주세요.');
  }, [backup]);
  const retry = () => {
    const next = chain.current.catch(() => undefined).then(drain);
    chain.current = next;
    void next.catch(() => undefined);
  };
  const recover = async () => {
    if (!recovery) return;
    const existing = new Set(state.current.confirmed.map((o) => o.id));
    const commands = recovery.flatMap((cmd) =>
      cmd.action === 'create'
        ? cmd.objects?.filter((o) => !existing.has(o.id)).length
          ? [
              {
                ...cmd,
                objects: cmd.objects?.filter((o) => !existing.has(o.id)),
              },
            ]
          : []
        : [cmd],
    );
    setRecovery(null);
    state.current.recovery = commands;
    for (const cmd of commands) {
      state.current.recovery = state.current.recovery.filter((c) => c !== cmd);
      try {
        await submit(cmd);
      } catch (error) {
        // submit keeps failed commands in the pending queue; remaining recovery survives.
        setRecovery(
          state.current.recovery.length ? [...state.current.recovery] : null,
        );
        throw error;
      }
    }
    await backup();
  };
  const discardRecovery = async () => {
    setRecovery(null);
    state.current.recovery = [];
    state.current.partial = null;
    if (!state.current.commands.length) setError('');
    await backup();
  };
  const hold = async () => {
    await chain.current.catch(() => undefined);
    const s = state.current;
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
      state.current.partial = object
        ? {
            canvasId,
            scope: state.current.scope,
            action: 'create',
            objects: [object],
            requestId: crypto.randomUUID(),
          }
        : null;
      void backup().catch((e) => setError(`그림 초안 보관 실패: ${String(e)}`));
    },
    [canvasId, backup],
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
    recovery,
    recover,
    discardRecovery,
    retry,
    hold,
    saving: pending.length > 0,
  };
}
