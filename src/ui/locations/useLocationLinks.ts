import { useEffect, useRef, useState } from 'react';
import type { AppApi } from '../../contracts/app-api.ts';
import type { WorkspaceState } from '../../contracts/project.ts';
import type {
  LocationOpenResult,
  LocationTarget,
} from '../../contracts/location-links.ts';

type Ports = {
  api: AppApi;
  workspace: WorkspaceState;
  ready: boolean;
  flush(): Promise<void>;
  enter(): Promise<void>;
  navigate(result: LocationOpenResult): void;
  composing(): boolean;
  report(message: string): void;
};
export function useLocationLinks(ports: () => Ports) {
  const latest = useRef(ports);
  latest.current = ports;
  const [error, setError] = useState('');
  const running = useRef(false),
    generation = useRef(0),
    mounted = useRef(true);
  const p = ports(),
    api = p.api.desktop?.locationLinks;
  const perform = async (text: string) => {
    if (!api || running.current) return;
    if (latest.current().composing()) {
      latest.current().report('한글 입력을 마친 뒤 링크를 다시 눌러주세요.');
      return;
    }
    running.current = true;
    setError('');
    const ticket = generation.current;
    const startSession = latest.current().workspace.session?.sessionId;
    try {
      await latest.current().flush();
      if (
        !mounted.current ||
        ticket !== generation.current ||
        latest.current().workspace.session?.sessionId !== startSession
      )
        return;
      const expected = latest.current().workspace.session ?? null;
      const result = await api.open(text, expected);
      if (!mounted.current || ticket !== generation.current) return;
      const current = await latest.current().api.projects.getWorkspace();
      if (current.session?.sessionId !== result.workspace.session?.sessionId)
        return;
      await latest.current().enter();
      if (!mounted.current || ticket !== generation.current) return;
      const after = await latest.current().api.projects.getWorkspace();
      if (after.session?.sessionId !== result.workspace.session?.sessionId)
        return;
      latest.current().navigate(result);
    } catch (error) {
      if (
        mounted.current &&
        ticket === generation.current &&
        latest.current().workspace.session?.sessionId === startSession
      ) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      running.current = false;
      if (mounted.current)
        queueMicrotask(() => {
          void receiveRef.current().catch(() => {});
        });
    }
  };
  const performRef = useRef(perform);
  performRef.current = perform;
  const receiving = useRef(false);
  const receive = async () => {
    if (!api || !latest.current().ready || receiving.current || running.current)
      return;
    receiving.current = true;
    try {
      for (let count = 0; count < 16 && mounted.current; count++) {
        const next = await api.pending();
        if (!next) break;
        await performRef.current(next.href);
        await api.acknowledge(next.id);
      }
    } finally {
      receiving.current = false;
    }
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    mounted.current = true;
    const stop = api?.onReceived(() => {
      void receiveRef.current().catch((error) => {
        if (mounted.current) setError(String(error));
      });
    });
    return () => {
      mounted.current = false;
      generation.current++;
      stop?.();
    };
  }, [api]);
  useEffect(() => {
    if (p.ready)
      void receiveRef.current().catch((error) => {
        if (mounted.current) setError(String(error));
      });
  }, [p.ready, api]);
  const copy = async (target: LocationTarget) => {
    if (!api || running.current) return;
    const session = latest.current().workspace.session;
    if (!session) return;
    running.current = true;
    try {
      await latest.current().flush();
      if (latest.current().workspace.session?.sessionId !== session.sessionId)
        return;
      const text = await api.create(target, session);
      if (latest.current().workspace.session?.sessionId !== session.sessionId)
        return;
      await latest.current().api.desktop!.copyText(text);
      if (
        mounted.current &&
        latest.current().workspace.session?.sessionId === session.sessionId
      )
        latest
          .current()
          .report('위치 링크를 복사했습니다. 프로젝트 참여자에게 보내주세요.');
    } catch (error) {
      if (
        mounted.current &&
        latest.current().workspace.session?.sessionId === session.sessionId
      ) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      running.current = false;
      void receiveRef.current().catch(() => {});
    }
  };
  return {
    available: !!api,
    error,
    dismissError: () => setError(''),
    openHref: perform,
    copy,
  };
}
