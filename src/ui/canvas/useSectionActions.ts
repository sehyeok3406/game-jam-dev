import { useEffect, useMemo, useRef, useState } from 'react';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';
import { useScopedPrompt } from './useSelectionActions.ts';
import {
  CanvasSectionActions,
  type SectionActionPorts,
  type SectionActionPrompt,
  type SectionCreatePrompt,
  type MembershipPrompt,
  type SectionRenamePrompt,
} from './section-actions.ts';

export function useSectionPrompts(scope: SelectionScope) {
  const key = selectionScopeKey(scope);
  const [createPrompt, setCreatePrompt] =
    useScopedPrompt<SectionCreatePrompt | null>(key, null);
  const [sectionActionPrompt, setSectionActionPrompt] =
    useScopedPrompt<SectionActionPrompt | null>(key, null);
  const [membershipPrompt, setMembershipPrompt] =
    useScopedPrompt<MembershipPrompt | null>(key, null);
  const [sectionRename, setSectionRename] =
    useScopedPrompt<SectionRenamePrompt | null>(key, null);
  return {
    createPrompt,
    setCreatePrompt,
    sectionActionPrompt,
    setSectionActionPrompt,
    membershipPrompt,
    setMembershipPrompt,
    sectionRename,
    setSectionRename,
  };
}

export function useSectionActions(
  scope: SelectionScope,
  ports: () => Omit<SectionActionPorts, 'scope'>,
) {
  const current = useRef({ scope, ports });
  current.current = { scope, ports };
  const [state, setState] = useState({ key: '', busy: false });
  const mounted = useRef(true);
  const actions = useMemo(
    () =>
      new CanvasSectionActions(
        () => ({ ...current.current.ports(), scope: current.current.scope }),
        (origin, busy) => {
          const key = selectionScopeKey(origin);
          if (
            mounted.current &&
            selectionScopeKey(current.current.scope) === key
          )
            setState({ key, busy });
        },
      ),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    actions.activate();
    return () => {
      mounted.current = false;
      actions.dispose();
    };
  }, [actions]);
  return {
    actions,
    busy: state.key === selectionScopeKey(scope) && state.busy,
  };
}
