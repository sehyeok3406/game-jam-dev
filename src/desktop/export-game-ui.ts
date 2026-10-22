import fs from 'node:fs/promises';
import { dialog, nativeImage, type BrowserWindow } from 'electron';

export async function exportGameUiPng(
  input: { name: string; data: string },
  window: BrowserWindow,
  assertCurrent: () => void,
) {
  const bytes = Buffer.from(input.data.split(',')[1], 'base64'),
    image = nativeImage.createFromBuffer(bytes),
    size = image.getSize();
  if (image.isEmpty() || size.width * size.height > 16_777_216)
    throw new Error('게임 UI 이미지를 읽을 수 없습니다.');
  const result = await dialog.showSaveDialog(window, {
    defaultPath: input.name.replace(/[<>:"/\\|?*]/g, '_') + '.png',
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return false;
  assertCurrent();
  await fs.writeFile(result.filePath, bytes);
  return true;
}
