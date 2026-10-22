import { useEffect, useMemo, useRef } from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import { WorkspaceDataLoader } from './workspace-data';

export function useWorkspaceData(onChanged: () => void) {
  const { api } = useRuntime();
  const latest = useRef(onChanged);
  latest.current = onChanged;
  const loader = useMemo(() => new WorkspaceDataLoader(api), [api]);
  useEffect(() => loader.watch(() => latest.current()), [loader]);
  return loader;
}
