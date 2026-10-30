import fs from 'node:fs/promises';
import path from 'node:path';
import matter from '../../markdown.ts';
import { canvasId } from '../../canvas-sheets.ts';
import type { CanvasDocument } from '../../contracts/documents.ts';
import type { CanvasSection } from '../../contracts/canvas.ts';
import { normalizeSectionMembers } from '../../core/editing/section-members.ts';
import { projectPath } from '../../project-store.ts';
import { filesystemProjectRepository } from './local-project-repository.ts';
import { readDocument } from './documents.ts';
import { logicalProjectPath } from '../../core/projects/project-layout.ts';

/** Readers and section writes are bound to one private project root. */
export function filesystemProjectReader(
  root: string,
  assertCurrent: () => void = () => {},
) {
  const DOCUMENT_FOLDERS = ['ideas', 'docs', '.ai/tasks', 'docs/html-sources'];
  const SECTION_FOLDER = 'sections';
  const parseDocument = (absolutePath: string) =>
    readDocument(root, absolutePath);

  const parseSection = async (absolutePath: string): Promise<CanvasSection> => {
    const [raw, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ]);
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const relativePath = logicalProjectPath(
      path.relative(root, absolutePath).replaceAll('\\', '/'),
    );
    const fallbackTitle = path.basename(absolutePath, '.md');
    const number = (key: string, fallback: number) =>
      typeof data[key] === 'number' ? data[key] : fallback;

    return {
      canvasId: canvasId(data.canvas_id),
      id: typeof data.id === 'string' ? data.id : relativePath,
      title: typeof data.title === 'string' ? data.title : fallbackTitle,
      relativePath,
      x: number('x', 80),
      y: number('y', 80),
      width: Math.max(number('width', 860), 420),
      height: Math.max(number('height', 620), 280),
      members: normalizeSectionMembers(data.members),
      modifiedAt: stat.mtimeMs,
    };
  };

  const findMarkdownFiles = async (directory: string): Promise<string[]> => {
    const files: string[] = [];
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory())
          files.push(...(await findMarkdownFiles(absolute)));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
          files.push(absolute);
      }
    } catch {
      return [];
    }
    return files;
  };

  const listDocuments = async () => {
    const folders = await Promise.all(
      DOCUMENT_FOLDERS.map(async (folder) =>
        findMarkdownFiles(await projectPath(root, folder)),
      ),
    );
    const all = [
      ...new Set([await projectPath(root, 'project.md'), ...folders.flat()]),
    ];
    const documents = await Promise.all(
      all.map(async (file) => {
        try {
          return await parseDocument(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          console.error(`Failed to parse ${file}`, error);
          return null;
        }
      }),
    );
    return documents.filter(
      (document): document is CanvasDocument =>
        document !== null &&
        !document.relativePath.startsWith('docs/text-sources/'),
    );
  };

  const listSections = async () => {
    const files = await findMarkdownFiles(
      await projectPath(root, SECTION_FOLDER),
    );
    const sections = await Promise.all(
      files.map(async (file) => {
        try {
          return await parseSection(file);
        } catch (error) {
          console.error(`Failed to parse section ${file}`, error);
          return null;
        }
      }),
    );
    return sections.filter(
      (section): section is CanvasSection => section !== null,
    );
  };

  const writeSection = async (
    relativePath: string,
    section: Omit<CanvasSection, 'relativePath' | 'modifiedAt'>,
  ) => {
    assertCurrent();
    const absolute = await projectPath(root, relativePath);
    const old = await fs.readFile(absolute, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const parsed = old === undefined ? undefined : matter(old);
    const next = matter.stringify(
      parsed?.content ??
        `\n# ${section.title}\n\n이 파일은 캔버스 섹션의 멤버십과 위치를 관리합니다.\n`,
      {
        ...parsed?.data,
        canvas_id:
          section.canvasId ??
          (old === undefined
            ? 'default'
            : canvasId(matter(old).data.canvas_id)),
        id: section.id,
        title: section.title,
        type: parsed?.data.type ?? 'section',
        status: parsed?.data.status ?? 'active',
        x: Math.round(section.x),
        y: Math.round(section.y),
        width: Math.round(section.width),
        height: Math.round(section.height),
        members: section.members,
      },
    );
    await filesystemProjectRepository(root, assertCurrent).apply(
      old === undefined ? {} : { [relativePath]: old },
      { [relativePath]: next },
    );
    return parseSection(absolute);
  };
  const checked = async <T>(action: () => Promise<T>) => {
    assertCurrent();
    const value = await action();
    assertCurrent();
    return value;
  };
  return {
    documents: () => checked(listDocuments),
    sections: {
      read: (relative: string) =>
        checked(async () => parseSection(await projectPath(root, relative))),
      list: () => checked(listSections),
      write: (
        relative: string,
        value: Omit<CanvasSection, 'relativePath' | 'modifiedAt'>,
      ) => checked(() => writeSection(relative, value)),
    },
  };
}
