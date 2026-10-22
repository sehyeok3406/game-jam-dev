import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../contracts/project.ts';
import type { AiRunRecords } from '../../application/ai/run-records.ts';
import type { AiStageWorkspace } from '../../application/ai/stage-workspace.ts';
import { projectPath, saveHistory } from '../../project-store.ts';
import { redactDiagnostic } from '../../app-errors.ts';
import matter from '../../markdown.ts';

export async function writeRunDiagnostic(
  root: string,
  runId: string,
  report: unknown,
) {
  const directory = await projectPath(root, `.history/${runId}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'diagnostic.json'),
    redactDiagnostic(JSON.stringify(report, null, 2)),
    'utf8',
  );
}

/** Paths are bound once. Late completion never consults the current desktop session. */
export function fileAiRunRecords(
  root: string,
  runId: string,
  taskPath: string,
  stage?: AiStageWorkspace,
): AiRunRecords {
  return {
    async diagnostic(report) {
      if (!report.outputs) return writeRunDiagnostic(root, runId, report);
      const candidate: Snapshot =
        (await stage?.capture().catch(() => ({}))) ?? {};
      await writeRunDiagnostic(root, runId, {
        ...report,
        outputs: report.outputs.map((relativePath) => ({
          relativePath,
          bytes: candidate[relativePath]
            ? Buffer.byteLength(candidate[relativePath])
            : 0,
          sha256: candidate[relativePath]
            ? createHash('sha256').update(candidate[relativePath]).digest('hex')
            : null,
        })),
      });
    },
    history: (entry) => saveHistory(root, {}, {}, entry),
    async task(status, fields) {
      const absolute = await projectPath(root, taskPath);
      const parsed = matter(await fs.readFile(absolute, 'utf8'));
      if (parsed.data.type !== 'ai-task')
        throw new Error('AI 작업 Markdown 파일만 실행할 수 있습니다.');
      Object.assign(parsed.data, { status, ...fields });
      await fs.writeFile(
        absolute,
        matter.stringify(parsed.content, parsed.data),
        'utf8',
      );
    },
    async specification() {
      return fs
        .readFile(await projectPath(root, taskPath), 'utf8')
        .catch(() => undefined);
    },
  };
}
