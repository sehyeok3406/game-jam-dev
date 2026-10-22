import fs from 'node:fs/promises';
import path from 'node:path';
import { isPreviewPath } from '../preview-output.ts';
import { collaborationPath } from '../collaboration-model.ts';
import { localFileAuthorship } from '../project-store.ts';

type Shell = {
  reveal(absolute: string): void;
  open(absolute: string): Promise<unknown>;
};
/** Native file reads/opens use only the originating workspace and reject late responses. */
export class DesktopProjectPaths {
  private root: string;
  private assertCurrent: () => void;
  private shell: Shell;
  constructor(root: string, assertCurrent: () => void, shell: Shell) {
    this.root = root;
    this.assertCurrent = assertCurrent;
    this.shell = shell;
  }
  private async resolve(relativePath: string) {
    this.assertCurrent();
    const absolute = path.resolve(this.root, relativePath);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw Error('프로젝트 폴더 밖에는 접근할 수 없습니다.');
    const realRoot = await fs.realpath(this.root),
      realTarget = await fs.realpath(absolute);
    this.assertCurrent();
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative))
      throw Error('심볼릭 링크를 통한 외부 접근은 허용되지 않습니다.');
    return absolute;
  }
  async readPreview(relative: string) {
    if (typeof relative !== 'string' || !isPreviewPath(relative))
      return undefined;
    try {
      const content = await fs.readFile(await this.resolve(relative), 'utf8');
      this.assertCurrent();
      return content;
    } catch {
      return undefined;
    }
  }
  async reveal(relative: string) {
    const absolute = await this.resolve(relative);
    await fs.access(absolute);
    this.assertCurrent();
    this.shell.reveal(absolute);
  }
  async open() {
    this.assertCurrent();
    await this.shell.open(this.root);
    this.assertCurrent();
  }
  async authorship(relative: string) {
    this.assertCurrent();
    const authorship = await localFileAuthorship(
      this.root,
      collaborationPath(relative),
    );
    this.assertCurrent();
    return authorship;
  }
}
