import type { ComponentProps, ElementType } from 'react';
import {
  useWorkspaceModalFocus,
  type WorkspacePanelState,
} from './usePanelState';
import { SelfHostDialog } from '../../features/self-host/SelfHostDialog';
import { SELF_HOST_ENABLED } from '../../features/self-host/enabled';
import { CollaborationPanel } from '../CollaborationPanel';
import { UpdatePanel } from '../UpdatePanel';
import { OfflineStatus } from '../OfflineStatus';
import { CanvasFind } from '../CanvasFind';
import {
  CanvasNavigator,
  CommandPalette,
  ShortcutDialog,
  CompareDialog,
} from '../CanvasOverlays';
import { PluginControlPanel } from '../../features/plugins/PluginControlPanel';
import { KanbanAppearanceManager } from '../../features/kanban/KanbanAppearanceManager';
import { DocumentStatusManager } from '../DocumentStatusManager';

type Content<T extends ElementType> = Omit<ComponentProps<T>, 'close'>;
export type WorkspacePanelsProps = {
  state: WorkspacePanelState;
  collaboration: Content<typeof CollaborationPanel>;
  selfHost?: Content<typeof SelfHostDialog>;
  workspace?: {
    restarting: boolean;
    offline: ComponentProps<typeof OfflineStatus>;
    find: Omit<Content<typeof CanvasFind>, 'jump'>;
    navigation: Content<typeof CanvasNavigator>;
    commands: ComponentProps<typeof CommandPalette>['commands'];
    compare: Content<typeof CompareDialog> | null;
    plugins: Content<typeof PluginControlPanel>;
    appearance: Content<typeof KanbanAppearanceManager>;
    statuses: Content<typeof DocumentStatusManager>;
    closeCompare: () => void;
  };
};

/** Shell visibility/lifecycle only; project edits and async workflows remain in their features. */
export function WorkspacePanels({
  state,
  collaboration,
  selfHost,
  workspace,
}: WorkspacePanelsProps) {
  useWorkspaceModalFocus();
  const updates = (
    <UpdatePanel
      open={state.updateOpen}
      close={() => state.setUpdateOpen(false)}
      show={() => state.setUpdateOpen(true)}
    />
  );
  const shared = state.collaborationOpen ? (
    <CollaborationPanel
      {...collaboration}
      close={() => state.setCollaborationOpen(false)}
    />
  ) : null;
  const host =
    SELF_HOST_ENABLED && selfHost && state.selfHostOpen ? (
      <SelfHostDialog
        {...selfHost}
        close={() => state.setSelfHostOpen(false)}
      />
    ) : null;
  if (!workspace)
    return (
      <>
        {updates}
        {shared}
        {host}
      </>
    );
  return (
    <>
      {host}
      {updates}
      {workspace.restarting && (
        <div className="update-restarting" role="alert" aria-busy="true">
          작업 보호 확인 완료 · 업데이트 후 재시작 중…
        </div>
      )}
      <OfflineStatus {...workspace.offline} />
      {state.findOpen && (
        <CanvasFind
          {...workspace.find}
          jump={workspace.navigation.jump}
          close={() => state.setFindOpen(false)}
        />
      )}
      {shared}
      {state.navigatorOpen && (
        <CanvasNavigator
          {...workspace.navigation}
          close={() => state.setNavigatorOpen(false)}
        />
      )}
      {state.commandOpen && (
        <CommandPalette
          items={workspace.navigation.items}
          commands={workspace.commands}
          jump={workspace.navigation.jump}
          close={() => state.setCommandOpen(false)}
        />
      )}
      {state.shortcutsOpen && (
        <ShortcutDialog close={() => state.setShortcutsOpen(false)} />
      )}
      {workspace.compare && (
        <CompareDialog {...workspace.compare} close={workspace.closeCompare} />
      )}
      {state.pluginPanelOpen && (
        <PluginControlPanel
          {...workspace.plugins}
          close={() => state.setPluginPanelOpen(false)}
        />
      )}
      {state.kanbanAppearanceOpen && (
        <KanbanAppearanceManager
          {...workspace.appearance}
          close={() => state.setKanbanAppearanceOpen(false)}
        />
      )}
      {state.statusManagerOpen && (
        <DocumentStatusManager
          {...workspace.statuses}
          close={() => state.setStatusManagerOpen(false)}
        />
      )}
    </>
  );
}
