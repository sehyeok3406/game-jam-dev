import type { BrowserWindow } from 'electron';

export const PREVIEW_SANDBOX = 'allow-scripts allow-pointer-lock';

export function previewPermissionAllowed(
  permission: string,
  owner: boolean,
  fullscreen: boolean,
  isMainFrame: boolean,
  requestingUrl?: string,
) {
  if (!owner) return false;
  if (permission === 'fullscreen' || permission === 'automatic-fullscreen')
    return isMainFrame;
  return (
    permission === 'pointerLock' &&
    fullscreen &&
    !isMainFrame &&
    requestingUrl === 'about:srcdoc'
  );
}

// Changing an iframe's sandbox attribute does not update its loaded document.
// Keep the sandbox stable and gate the capability in Electron instead, so
// entering/leaving fullscreen never reloads a running game.
export function installPreviewPermissions(window: BrowserWindow) {
  let htmlFullscreen = false;
  const contents = window.webContents;
  const session = contents.session;
  const owns = (requester: Electron.WebContents | null) =>
    !window.isDestroyed() && !contents.isDestroyed() && requester === contents;
  const unlock = () => {
    if (!window.isDestroyed() && !contents.isDestroyed())
      void contents
        .executeJavaScript('document.exitPointerLock?.()')
        .catch(() => {});
  };
  window.on('enter-html-full-screen', () => {
    htmlFullscreen = true;
  });
  window.on('leave-html-full-screen', () => {
    htmlFullscreen = false;
    unlock();
  });
  session.setPermissionCheckHandler(
    (requester, permission, _origin, details) => {
      const allowed = previewPermissionAllowed(
        permission,
        owns(requester),
        htmlFullscreen,
        details.isMainFrame,
        details.requestingUrl,
      );
      return allowed;
    },
  );
  session.setPermissionRequestHandler(
    (requester, permission, callback, details) => {
      if (
        !previewPermissionAllowed(
          permission,
          owns(requester),
          htmlFullscreen,
          details.isMainFrame,
          details.requestingUrl,
        )
      ) {
        callback(false);
        return;
      }
      callback(true);
    },
  );
}
