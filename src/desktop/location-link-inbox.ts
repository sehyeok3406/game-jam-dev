import { parseLocationLink } from '../core/projects/location-links.ts';

/** Keep the most recent intent until the renderer acknowledges it; notifications carry no secrets. */
export class LocationLinkInbox {
  private value: { id: number; href: string } | null = null;
  private sequence = 0;
  private notify: () => void;
  constructor(notify: () => void) {
    this.notify = notify;
  }
  receive(href: string) {
    parseLocationLink(href);
    if (this.value?.href === href) return;
    this.value = { id: ++this.sequence, href };
    this.notify();
  }
  pending() {
    return this.value ? { ...this.value } : null;
  }
  invalid() {
    this.value = { id: ++this.sequence, href: '' };
    this.notify();
  }
  acknowledge(id: number) {
    if (this.value?.id === id) this.value = null;
  }
}
