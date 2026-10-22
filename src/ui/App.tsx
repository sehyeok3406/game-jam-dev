import { ReactFlowProvider } from '@xyflow/react';
import { WorkspaceScreen } from './workspace/WorkspaceScreen';
import type { UiDebugSelection } from './debug/uiDebugRegistry';

export function App({ preview }: { preview?: UiDebugSelection } = {}) {
  return (
    <ReactFlowProvider>
      <WorkspaceScreen preview={preview} />
    </ReactFlowProvider>
  );
}
