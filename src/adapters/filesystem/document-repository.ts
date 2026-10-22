import { encodeAsset } from '../../file-assets.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from '../../markdown.ts';
import { projectPath } from '../../project-store.ts';
import type { DocumentRepository } from '../../application/ports/local-project-repository.ts';
import { readDocument } from './documents.ts';

/** A one-document atomic replacement; never captures the whole project. */
export function filesystemDocumentRepository(
  root: string,
  assertCurrent: () => void,
): DocumentRepository {
  const writeRaw = async (relative: string, expected: string, raw: string) => {
    assertCurrent();
    const absolute = await projectPath(root, relative);
    const temporary = path.join(
      path.dirname(absolute),
      `.document-${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(temporary, raw, { encoding: 'utf8', flush: true });
      assertCurrent();
      if ((await fs.readFile(absolute, 'utf8')) !== expected)
        throw Error('문서가 외부에서 변경되었습니다. 초안은 보관됩니다.');
      await projectPath(root, relative);
      assertCurrent();
      await fs.rename(temporary, absolute);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return readDocument(root, absolute);
  };
  return {
    asset: async (relative) => {
      assertCurrent();
      const bytes = await fs.readFile(await projectPath(root, relative));
      assertCurrent();
      return encodeAsset(relative, bytes);
    },
    read: async (relative) => {
      assertCurrent();
      const absolute = await projectPath(root, relative);
      const raw = await fs.readFile(absolute, 'utf8');
      const document = await readDocument(root, absolute, raw);
      assertCurrent();
      return { raw, document, storedTitle: matter(raw).data.title };
    },
    patchMetadata: async (relative, expected, changes) => {
      const parsed = matter(expected);
      return writeRaw(
        relative,
        expected,
        matter.stringify(parsed.content, { ...parsed.data, ...changes }),
      );
    },
    replace: async (relative, expected, content) => {
      assertCurrent();
      const parsed = matter(expected);
      parsed.data.title = content.title;
      return writeRaw(
        relative,
        expected,
        matter.stringify(`\n${content.body}\n`, parsed.data),
      );
    },
  };
}
