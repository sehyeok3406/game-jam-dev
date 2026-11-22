import { useEffect, useRef } from 'react';
import {
  canvasShortcut,
  type CanvasToolKeys,
  type Shortcut,
} from '../../canvas-ux';

type CanvasCommands = {
  toolKeys: CanvasToolKeys;
  home: boolean;
  findOpen: boolean;
  find: () => void;
  action: (action: Shortcut, event: KeyboardEvent) => void;
  escape: () => void;
  releasePan: () => void;
  releaseLinks?: () => void;
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
      const target = event.target instanceof Element ? event.target : null;
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
      const space = event.key === ' ';
      const action = canvasShortcut(
        event,
        {
          editable:
            !!target?.closest(
              'input, textarea, select, [role="listbox"], .plugin-control-panel, [contenteditable="true"], [data-editor-owner]',
            ) ||
            (!!target?.closest('button:not(.file-node-surface)') &&
              !(space && target.closest('.canvas-file-header__title'))) ||
            (space && !!target?.closest('summary')),
          dialog,
          playing: document.activeElement?.tagName === 'IFRAME',
        },
        current.toolKeys,
      );
      if (action) {
        event.preventDefault();
        if (action === 'pan') {
          event.stopPropagation();
          if (event.repeat) return;
        }
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
    // Claim Space before React Flow can change selection or a node can activate.
    const panKeydown = (event: KeyboardEvent) => {
      if (event.key === ' ') keydown(event);
      if (
        !event.repeat &&
        !event.isComposing &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's' &&
        event.target instanceof Element &&
        event.target.closest('.canvas-text-node--editing') &&
        !latest.current.home &&
        !document.querySelector('[aria-modal="true"], .ui-debug-console[open]')
      ) {
        event.stopPropagation();
        latest.current.action('save', event);
      }
    };
    const otherKeydown = (event: KeyboardEvent) => {
      if (event.key !== ' ') keydown(event);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === ' ') latest.current.releasePan();
      if (event.key.toLowerCase() === 'g') latest.current.releaseLinks?.();
    };
    const blur = () => {
      latest.current.releasePan();
      latest.current.releaseLinks?.();
      latest.current.blur();
    };
    document.addEventListener('keydown', panKeydown, true);
    window.addEventListener('keydown', otherKeydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', panKeydown, true);
      window.removeEventListener('keydown', otherKeydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
