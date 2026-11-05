type PlaybackOwner = {
  id: string;
  card: HTMLElement;
  frame: HTMLIFrameElement;
  fullscreen: (active: boolean) => void;
  diagnostic?: (value: unknown) => void;
};
type Registration = PlaybackOwner & { source: Window };

/** One listener set per document, routed by the actual sandboxed frame window.
 * This owns app controls only; it never pauses, hides or reloads a game. */
export class PreviewPlaybackEvents {
  private document: Document;
  private host: Window;
  private sources = new Map<MessageEventSource, Registration>();
  private cards = new Map<Element, Registration>();
  private active: Registration | undefined;

  constructor(document: Document) {
    this.document = document;
    this.host = document.defaultView!;
  }

  register(owner: PlaybackOwner) {
    const source = owner.frame.contentWindow;
    if (!source) return () => {};
    if (!this.sources.size) this.connect();
    const previous = this.sources.get(source);
    if (previous) {
      if (this.cards.get(previous.card) === previous)
        this.cards.delete(previous.card);
      if (this.active === previous) this.active = undefined;
    }
    const entry = { ...owner, source };
    this.sources.set(source, entry);
    this.cards.set(owner.card, entry);
    if (this.document.fullscreenElement === owner.card) this.active = entry;
    owner.fullscreen(this.active === entry);
    return () => {
      // An old effect must not remove a newer owner of the same WindowProxy.
      if (this.sources.get(source) !== entry) return;
      this.sources.delete(source);
      if (this.cards.get(entry.card) === entry) this.cards.delete(entry.card);
      if (this.active === entry) this.active = undefined;
      if (!this.sources.size) this.disconnect();
    };
  }

  private notify(entry: Registration, active: boolean) {
    entry.source.postMessage(
      { type: 'game-canvas:preview-fullscreen', id: entry.id, active },
      '*',
    );
    entry.fullscreen(active);
  }

  private fullscreen = () => {
    const previous = this.active;
    const current = this.document.fullscreenElement;
    this.active = current ? this.cards.get(current) : undefined;
    if (previous === this.active) return;
    if (previous) this.notify(previous, false);
    if (this.active) this.notify(this.active, true);
  };

  private exit(entry: Registration) {
    if (this.document.fullscreenElement === entry.card)
      void this.document.exitFullscreen().catch(() => {});
  }

  private keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.active) this.exit(this.active);
  };

  private message = (event: MessageEvent) => {
    const data = event.data;
    if (!event.source || !data || typeof data !== 'object') return;
    const entry = this.sources.get(event.source);
    if (!entry || data.id !== entry.id) return;
    if (data.type === 'gamejam:diagnostic') entry.diagnostic?.(data.diagnostic);
    else if (data.type === 'game-canvas:preview-escape') this.exit(entry);
  };

  private connect() {
    this.document.addEventListener('fullscreenchange', this.fullscreen);
    this.host.addEventListener('keydown', this.keydown, true);
    this.host.addEventListener('message', this.message);
  }
  private disconnect() {
    this.document.removeEventListener('fullscreenchange', this.fullscreen);
    this.host.removeEventListener('keydown', this.keydown, true);
    this.host.removeEventListener('message', this.message);
  }
}

const documents = new WeakMap<Document, PreviewPlaybackEvents>();
export function previewPlaybackEvents(document: Document) {
  let events = documents.get(document);
  if (!events)
    documents.set(document, (events = new PreviewPlaybackEvents(document)));
  return events;
}
