import type { WebContents } from 'electron';

/** WebContents receives keys even when a canvas HTML iframe has focus. */
export function installUiDebugShortcut(
  contents: Pick<WebContents, 'on' | 'send'>,
) {
  contents.on('before-input-event', (event, input) => {
    if (input.key !== 'F12') return;
    event.preventDefault();
    if (input.type === 'keyDown' && !input.isAutoRepeat)
      contents.send('ui-debug:toggle');
  });
}
