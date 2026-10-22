import { useLayoutEffect, useMemo, useState, type SetStateAction } from 'react';
import { useCanvasPanel } from '../CanvasChrome';
import { installWorkspaceModalFocus } from './modal-focus';

const initialPanels = {
  selfHostOpen: false,
  findOpen: false,
  collaborationOpen: false,
  navigatorOpen: false,
  commandOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  updateOpen: false,
  approvalInboxOpen: false,
  statusManagerOpen: false,
  kanbanAppearanceOpen: false,
  pluginPanelOpen: false,
  historyOpen: false,
  codexStatusOpen: false,
};

type PanelName = keyof typeof initialPanels;

/** Owns panel visibility without owning documents, drafts or project data. */
export function usePanelState() {
  const dock = useCanvasPanel();
  const [panels, setPanels] = useState(initialPanels);
  const actions = useMemo(() => {
    const setter = (name: PanelName) => (value: SetStateAction<boolean>) =>
      setPanels((current) => {
        const next = typeof value === 'function' ? value(current[name]) : value;
        return current[name] === next ? current : { ...current, [name]: next };
      });
    return {
      setSelfHostOpen: setter('selfHostOpen'),
      setFindOpen: setter('findOpen'),
      setCollaborationOpen: setter('collaborationOpen'),
      setNavigatorOpen: setter('navigatorOpen'),
      setCommandOpen: setter('commandOpen'),
      setShortcutsOpen: setter('shortcutsOpen'),
      setSettingsOpen: setter('settingsOpen'),
      setUpdateOpen: setter('updateOpen'),
      setApprovalInboxOpen: setter('approvalInboxOpen'),
      setStatusManagerOpen: setter('statusManagerOpen'),
      setKanbanAppearanceOpen: setter('kanbanAppearanceOpen'),
      setPluginPanelOpen: setter('pluginPanelOpen'),
      setHistoryOpen: setter('historyOpen'),
      setCodexStatusOpen: setter('codexStatusOpen'),
    };
  }, []);
  return {
    ...panels,
    ...actions,
    dockPanel: dock.panel,
    setDockPanel: dock.setPanel,
    restorePanelScope: dock.restoreScope,
    historyOpen: dock.panel === 'activity',
    settingsOpen: dock.panel === 'settings',
    pluginPanelOpen: dock.panel === 'plugins',
    setHistoryOpen: dock.setHistoryOpen,
    setSettingsOpen: dock.setSettingsOpen,
    setPluginPanelOpen: dock.setPluginPanelOpen,
  };
}

export type WorkspacePanelState = ReturnType<typeof usePanelState>;

/** Own subscriptions for this shell's lifetime, including dialogs mounted by its features. */
export function useWorkspaceModalFocus() {
  useLayoutEffect(() => installWorkspaceModalFocus(document), []);
}
