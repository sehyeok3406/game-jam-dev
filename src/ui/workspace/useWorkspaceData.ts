import { useEffect, useMemo, useRef } from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import { WorkspaceDataLoader } from './workspace-data';
import type { WorkspaceDocumentLayoutChange } from '../../contracts/project.ts';

export function useWorkspaceData(
  onChanged: (layouts?: WorkspaceDocumentLayoutChange) => void,
) {
  const { api } = useRuntime();
  const latest = useRef(onChanged);
  latest.current = onChanged;
  const loader = useMemo(() => new WorkspaceDataLoader(api), [api]);
  useEffect(() => loader.watch((layouts) => latest.current(layouts)), [loader]);
  return loader;
}
