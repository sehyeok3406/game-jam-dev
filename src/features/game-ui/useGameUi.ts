import { useRuntime } from '../../ui/runtime/runtime-context.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyGameUi,
  gameUiPath,
  serializeGameUi,
  snapshotGameUi,
} from '../../game-ui-model';
import type { GameUiCommand, GameUiFrame } from '../../game-ui-types';
function optimistic(frames: GameUiFrame[], commands: GameUiCommand[]) {
  const canvases = new Set([
    ...frames.map((f) => f.canvasId),
    ...commands
      .flatMap((c) => [c.frame?.canvasId, c.targetCanvasId])
      .filter((v): v is string => !!v),
  ]);
  let files: Record<string, string> = {
    '.canvas/canvases.json': JSON.stringify({
      version: 1,
      canvases: [...canvases].map((id) => ({ id, name: id })),
    }),
    ...Object.fromEntries(
      frames.map((f) => [gameUiPath(f.id), serializeGameUi(f)]),
    ),
  };
  for (const c of commands) files = applyGameUi(files, c);
  return snapshotGameUi(files);
}
export function useGameUi(scope: string | undefined) {
  const { api } = useRuntime();

  const [confirmed, setConfirmed] = useState<GameUiFrame[]>([]),
    [pending, setPending] = useState<GameUiCommand[]>([]),
    [error, setError] = useState('');
  const state = useRef({
    scope,
    frames: [] as GameUiFrame[],
    queue: [] as GameUiCommand[],
    epoch: 0,
    persisted: false,
  });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const sequence = useRef(Date.now());
  const backup = useCallback(async () => {
    const s = state.current;
    if (!s.scope || (!s.queue.length && !s.persisted)) return;
    const persisted = s.queue.length > 0;
    const seq = ++sequence.current;
    await api.saves.setEditorDraft(
      `game-ui:${s.scope}`,
      s.queue.length
        ? {
            title: '게임 UI 복구',
            body: JSON.stringify(s.queue),
            sequence: seq,
          }
        : null,
      seq,
    );
    s.persisted = persisted;
  }, []);
  const reload = useCallback(async () => {
    const s = state.current,
      e = s.epoch;
    if (!s.scope || !api.editor.listGameUi) return;
    const frames = await api.editor.listGameUi();
    if (state.current !== s || e !== s.epoch) return;
    s.frames = frames;
    setConfirmed(frames);
  }, []);
  const drain = useCallback(async () => {
    const s = state.current;
    while (s.queue.length) {
      await backup();
      const frames = await api.editor.applyGameUiCommand(s.queue[0]);
      if (state.current !== s) return;
      s.epoch++;
      s.frames = frames;
      s.queue.shift();
      setConfirmed(frames);
      setPending([...s.queue]);
      setError('');
      await backup();
    }
  }, [backup]);
  useEffect(() => {
    state.current = {
      scope,
      frames: [],
      queue: [],
      epoch: 0,
      persisted: false,
    };
    chain.current = Promise.resolve();
    setConfirmed([]);
    setPending([]);
    setError('');
    if (!scope) return;
    const s = state.current;
    void (async () => {
      await reload();
      const draft = await api.saves.getEditorDraft(`game-ui:${scope}`);
      if (state.current !== s) return;
      if (draft) sequence.current = Math.max(sequence.current, draft.sequence);
      if (draft) {
        s.persisted = true;
        const queue = JSON.parse(draft.body) as GameUiCommand[];
        if (Array.isArray(queue) && queue.length) {
          s.queue = queue;
          setPending(queue);
          setError('저장하지 못한 게임 UI가 있습니다. 저장을 재시도해주세요.');
        }
      }
    })().catch((e) => state.current === s && setError(String(e)));
    const stop = api.projects.onWorkspaceChanged(
      () => void reload().catch((e) => setError(String(e))),
    );
    return stop;
  }, [scope, reload]);
  const submit = useCallback(
    async (c: GameUiCommand) => {
      const s = state.current;
      if (!s.scope) throw new Error('프로젝트를 먼저 열어주세요.');
      if (s.queue.length && error)
        throw new Error('보관된 게임 UI 변경을 먼저 저장해주세요.');
      const command = {
        ...structuredClone(c),
        scope: s.scope,
        requestId: c.requestId ?? crypto.randomUUID(),
      };
      optimistic(s.frames, [...s.queue, command]);
      s.queue.push(command);
      s.epoch++;
      setPending([...s.queue]);
      const result = chain.current.catch(() => undefined).then(drain);
      chain.current = result;
      try {
        await result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [drain, error],
  );
  const frames = useMemo(() => {
    try {
      return optimistic(confirmed, pending);
    } catch {
      return confirmed;
    }
  }, [confirmed, pending]);
  const retry = () => {
    chain.current = chain.current
      .catch(() => undefined)
      .then(drain)
      .catch((e) => setError(String(e)));
  };
  const flush = useCallback(async () => {
    await backup();
    await chain.current;
    if (state.current.queue.length)
      throw new Error('게임 UI 저장을 완료한 뒤 이동해주세요.');
  }, [backup]);
  return {
    frames,
    submit,
    error,
    retry,
    flush,
    saving: pending.length > 0 && !error,
  };
}
