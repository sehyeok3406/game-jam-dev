import type { App } from 'electron';
import type { LocationLinkInbox } from './location-link-inbox.ts';

/** Test-user profiles keep their own instance lock; only the installed default profile registers the scheme. */
export function installLocationLinkProtocol(options: {
  app: App;
  inbox: LocationLinkInbox;
  argv: string[];
  register: boolean;
  enabled?: boolean;
  focus(): void;
  invalid(): void;
}) {
  const { app, inbox } = options;
  const receive = (href: string) => {
    if (options.enabled === false) return;
    try {
      inbox.receive(href);
    } catch {
      options.invalid();
    }
  };
  const argumentsLink = (argv: string[]) => {
    const links = argv.filter((value) => /^gamejam:/i.test(value));
    if (links.length) receive(links[links.length - 1]);
  };
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', (_event, argv) => {
    argumentsLink(argv);
    options.focus();
  });
  app.on('open-url', (event, href) => {
    event.preventDefault();
    receive(href);
    options.focus();
  });
  argumentsLink(options.argv);
  if (options.register) app.setAsDefaultProtocolClient('gamejam');
  return true;
}
