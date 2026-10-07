type Publisher = {
  settings(): Promise<unknown>;
  publish(): Promise<unknown>;
};

// The installed app is the publisher. No shortcut, external worker or Windows
// startup registration is needed while Game Jam! is open.
export function startWebViewerSync(publisher: Publisher, intervalMs = 15_000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const settings = await publisher.settings();
      if (!stopped && settings) await publisher.publish();
    } catch {
      // A temporary network or settings failure must not stop future attempts.
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), intervalMs);
        timer.unref?.();
      }
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
