import type { UiDebugSelection } from './uiDebugRegistry';

// Set only by the isolated preview bootstrap, never by the live app.
export function uiPreview(): UiDebugSelection | undefined {
  return (window as typeof window & { uiDebugPreview?: UiDebugSelection })
    .uiDebugPreview;
}
export function previewState(id: string) {
  const preview = uiPreview();
  return preview?.id === id ? preview.state : undefined;
}
