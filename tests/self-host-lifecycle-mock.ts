import { EventEmitter } from 'node:events';
export const replies: { response: number; checkboxChecked?: boolean }[] = [];
export const boxes: unknown[] = [];
export const trays: Tray[] = [];
export const dialog = {
  showMessageBox: async (_window: unknown, options: unknown) => {
    boxes.push(options);
    return replies.shift() ?? { response: 0, checkboxChecked: false };
  },
};
export const Menu = {
  buildFromTemplate: (items: { label?: string; click?: () => void }[]) => items,
};
export const nativeImage = { createFromPath: () => ({}) };
export class Tray extends EventEmitter {
  destroyed = false;
  menu: { label?: string; click?: () => void }[] = [];
  constructor(_image: unknown) {
    super();
    trays.push(this);
  }
  setToolTip(_text: string) {}
  setContextMenu(items: Tray['menu']) {
    this.menu = items;
  }
  displayBalloon(_options: unknown) {}
  destroy() {
    this.destroyed = true;
  }
}
