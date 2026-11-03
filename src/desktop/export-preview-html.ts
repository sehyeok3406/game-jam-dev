import { dialog, type BrowserWindow } from 'electron';
import { writeExportedHtml } from '../adapters/filesystem/html-export';

/** Dialog chooses a file, application rechecks the source, adapter replaces atomically. */
export async function savePreviewHtml(
  input: { name: string; content: string },
  window: BrowserWindow,
  root: string,
  check: () => Promise<void>,
  choose = (name: string) =>
    dialog.showSaveDialog(window, {
      title: '게임 HTML 내보내기',
      defaultPath: name,
      filters: [{ name: 'HTML 게임', extensions: ['html'] }],
    }),
) {
  const selected = await choose(
    input.name.replace(/[<>:"/\\|?*]/g, '_') + '.html',
  );
  if (selected.canceled || !selected.filePath) return false;
  await writeExportedHtml(input.content, selected.filePath, root, check);
  return true;
}
