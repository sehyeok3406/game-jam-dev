import { useEffect, useRef } from 'react';
import { canvasShortcut, type Shortcut } from '../../canvas-ux';

type CanvasCommands = {
  home: boolean;
  findOpen: boolean;
  find: () => void;
  action: (action: Shortcut, event: KeyboardEvent) => void;
  escape: () => void;
  releasePan: () => void;
  blur: () => void;
};

/** One keyboard subscription per canvas; callbacks always use the current render. */
export function useCanvasCommands(commands: CanvasCommands) {
  const latest = useRef(commands);
  latest.current = commands;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (document.querySelector('.ui-debug-console[open]')) return;
      if (document.fullscreenElement?.classList.contains('preview-card'))
        return;
      if (document.activeElement?.tagName === 'IFRAME') return;
      const target = event.target as HTMLElement | null;
      const dialog = !!document.querySelector('[aria-modal="true"]');
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !dialog &&
        !current.home
      ) {
        event.preventDefault();
        current.find();
        return;
      }
      if (
        current.home ||
        (current.findOpen && !!target?.closest('.canvas-find'))
      )
        return;
      const action = canvasShortcut(event, {
        editable: !!target?.closest(
          'input, textarea, select, button, [role="listbox"], .plugin-control-panel, [contenteditable="true"], [data-editor-owner]',
        ),
        dialog,
        playing: document.activeElement?.tagName === 'IFRAME',
      });
      if (action) {
        event.preventDefault();
        current.action(action, event);
        return;
      }
      if (
        event.key === 'Escape' &&
        !dialog &&
        !target?.closest('input,textarea,select,[contenteditable="true"]')
      )
        current.escape();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === ' ') latest.current.releasePan();
    };
    const blur = () => {
      latest.current.releasePan();
      latest.current.blur();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
