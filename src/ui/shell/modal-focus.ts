const MODALS = '[aria-modal="true"], dialog[open]';
const CONTROLS =
  'input,textarea,select,button,a[href],[tabindex],[contenteditable="true"]';
const diagnosticFocus = (element: Element | null) =>
  !!element?.closest('.ui-debug-console[open]');

const visible = (element: HTMLElement) =>
  !!element.getClientRects().length &&
  !element.closest('[hidden],[inert]') &&
  element.ownerDocument.defaultView!.getComputedStyle(element).visibility !==
    'hidden';

function modalStack(document: Document) {
  const window = document.defaultView!;
  const layer = (element: HTMLElement) => {
    const levels: number[] = [];
    for (
      let parent: HTMLElement | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = window.getComputedStyle(parent);
      if (
        style.zIndex &&
        style.zIndex !== 'auto' &&
        Number.isFinite(Number(style.zIndex))
      )
        levels.unshift(Number(style.zIndex));
    }
    return levels;
  };
  return [...document.querySelectorAll<HTMLElement>(MODALS)]
    .filter(visible)
    .map((element, index) => ({ element, index, layer: layer(element) }))
    .sort((a, b) => {
      // Native showModal dialogs occupy the browser's top layer, above CSS z-index.
      const native =
        Number(a.element.matches('dialog[open]')) -
        Number(b.element.matches('dialog[open]'));
      if (native) return native;
      for (let i = 0; i < Math.max(a.layer.length, b.layer.length); i++) {
        const difference = (a.layer[i] ?? 0) - (b.layer[i] ?? 0);
        if (difference) return difference;
      }
      return a.index - b.index;
    })
    .map(({ element }) => element);
}

/** Follows existing CSS/DOM paint order; never changes the product's z-index values. */
export function topWorkspaceModal(document: Document) {
  return modalStack(document).at(-1);
}

/** One shell lifecycle for dynamically mounted dialogs, including legacy editing dialogs. */
export function installWorkspaceModalFocus(document: Document) {
  const window = document.defaultView!;
  const openers = new Map<HTMLElement, HTMLElement | null>();
  let stack: HTMLElement[] = [],
    focusing = false;
  let previous =
    document.activeElement instanceof window.HTMLElement
      ? document.activeElement
      : null;
  const controls = (dialog: HTMLElement) =>
    [...dialog.querySelectorAll<HTMLElement>(CONTROLS)].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        visible(element),
    );
  const focus = (dialog: HTMLElement, target?: HTMLElement | null) => {
    if (dialog.matches('dialog[open]')) return; // Native dialog owns its focus/cancel lifecycle.
    focusing = true;
    try {
      const first = target ?? controls(dialog)[0];
      if (first) first.focus();
      else {
        if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
        dialog.focus();
      }
    } finally {
      focusing = false;
    }
  };
  const refresh = () => {
    const next = modalStack(document),
      top = next.at(-1),
      oldTop = stack.at(-1);
    for (const dialog of next)
      if (!openers.has(dialog)) {
        const active =
          document.activeElement instanceof window.HTMLElement
            ? document.activeElement
            : null;
        openers.set(
          dialog,
          active && !dialog.contains(active)
            ? active
            : previous && !dialog.contains(previous)
              ? previous
              : null,
        );
      }
    const survivingOpener = (candidate: HTMLElement | null | undefined) => {
      let restore = candidate;
      const visited = new Set<HTMLElement>();
      while (restore) {
        const owner = restore.closest<HTMLElement>(MODALS);
        if (!owner || next.includes(owner) || visited.has(owner)) break;
        visited.add(owner);
        restore = openers.get(owner);
      }
      return restore;
    };
    const restore =
      oldTop && !next.includes(oldTop)
        ? survivingOpener(openers.get(oldTop))
        : undefined;
    // An automatic lower-layer dialog can open behind the active one. Keep its
    // return path even if that original dialog closes before it gets focus.
    for (const dialog of next)
      openers.set(dialog, survivingOpener(openers.get(dialog)) ?? null);
    stack = next;
    for (const dialog of openers.keys())
      if (!next.includes(dialog)) openers.delete(dialog);
    if (top) {
      if (restore?.isConnected && top.contains(restore)) focus(top, restore);
      else if (
        !top.contains(document.activeElement) &&
        !diagnosticFocus(document.activeElement)
      )
        focus(top);
    } else if (restore?.isConnected && visible(restore)) restore.focus();
  };
  const entered = (event: FocusEvent) => {
    if (!(event.target instanceof window.HTMLElement)) return;
    const target = event.target,
      owner = target.closest<HTMLElement>(MODALS);
    if (owner && !openers.has(owner))
      openers.set(
        owner,
        previous && !owner.contains(previous) ? previous : null,
      );
    previous = target;
    if (focusing || diagnosticFocus(target)) return;
    const top = topWorkspaceModal(document);
    if (top && !top.contains(target)) focus(top);
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      diagnosticFocus(document.activeElement)
    )
      return;
    const top = topWorkspaceModal(document);
    if (!top || top.matches('dialog[open]')) return;
    const items = controls(top),
      first = items[0],
      last = items.at(-1);
    if (
      !first ||
      !top.contains(document.activeElement) ||
      (event.shiftKey &&
        (document.activeElement === first || document.activeElement === top)) ||
      (!event.shiftKey &&
        (document.activeElement === last || document.activeElement === top))
    ) {
      event.preventDefault();
      event.stopPropagation(); // Existing per-dialog traps must not wrap a second time.
      focus(top, event.shiftKey ? last : first);
    }
  };
  document.addEventListener('focusin', entered, true);
  document.addEventListener('keydown', keydown, true);
  const observer = new window.MutationObserver((records) => {
    // A canvas drag changes styles every frame. When no modal is open, inspect
    // only changed subtrees instead of rescanning the entire workspace.
    const hasModal = (node: Node) =>
      node instanceof window.HTMLElement &&
      (node.matches(MODALS) || !!node.querySelector(MODALS));
    if (
      stack.length ||
      records.some((record) =>
        record.type === 'attributes'
          ? hasModal(record.target)
          : [...record.addedNodes, ...record.removedNodes].some(hasModal),
      )
    )
      refresh();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'hidden',
      'open',
      'inert',
      'aria-modal',
    ],
  });
  refresh();
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', entered, true);
    document.removeEventListener('keydown', keydown, true);
    openers.clear();
  };
}
