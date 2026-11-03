import fs from 'node:fs/promises';

/** Retry sharing violations without a destructive delete/write fallback. */
export async function replaceFileWithRetry(
  source: string,
  target: string,
  check: () => Promise<void>,
  rename: typeof fs.rename = fs.rename,
) {
  for (let attempt = 0; ; attempt++) {
    await check();
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (
        attempt >= 4 ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
