import type { Snapshot } from '../../contracts/project.ts';
import type { GameBuildStatus } from '../../contracts/game-build-status.ts';
import {
  readGameBuild,
  readGameBuildIndex,
  selectGameBuilds,
  type GameBuildCodec,
} from './game-build.ts';

type Parse = (raw: string) => {
  data: Record<string, unknown>;
  content: string;
};
const presentation = new Set([
  'x',
  'y',
  'width',
  'height',
  'collapsed',
  'canvas_id',
  'canvas_placement_id',
  'background_color',
  'updated_at',
  'creation_origin',
  'ai_task_path',
  'workflow_status_id',
  'workflow_order',
  'status_property_enabled',
]);
/** Compare design content independently of YAML key order and app presentation metadata. */
export function gameDesignDigest(
  raw: string,
  parse: Parse,
  digest: (raw: string) => string,
) {
  const p = parse(raw);
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return digest(
    JSON.stringify(
      canonical(
        JSON.parse(
          JSON.stringify({
            body: p.content.trim(),
            data: Object.fromEntries(
              Object.entries(p.data).filter(([k]) => !presentation.has(k)),
            ),
          }),
        ),
      ),
    ),
  );
}
export function gameBuildStatus(
  files: Snapshot,
  path: string,
  codec: GameBuildCodec,
  parse: Parse,
): GameBuildStatus {
  try {
    const artifact = readGameBuildIndex(files).artifacts.find(
      (a) => a.path === path,
    );
    if (!artifact) return { kind: 'html', libraries: [], documents: [] };
    const saved = readGameBuild(
      { ...selectGameBuilds(files, new Set([path])), [path]: files[path] },
      artifact.buildId,
      codec,
    );
    return {
      kind: saved.manifest.htmlTemplate ? 'source' : 'html',
      buildId: artifact.buildId,
      libraries: Object.entries(saved.lock.roots).flatMap(([name, key]) => {
        const p = saved.lock.packages.find((p) => p.key === key);
        return p ? [{ name, version: p.version }] : [];
      }),
      documents: saved.manifest.documents.map((d) => {
        const raw = files[d.path],
          current = raw === undefined ? undefined : parse(raw);
        return {
          path: d.path,
          title:
            typeof current?.data.title === 'string'
              ? current.data.title
              : d.path,
          state: !current
            ? 'missing'
            : current.data.id !== d.id
              ? 'replaced'
              : d.designSha256
                ? gameDesignDigest(raw, parse, codec.digest) === d.designSha256
                  ? 'unchanged'
                  : 'changed'
                : codec.digest(raw) === d.sha256
                  ? 'unchanged'
                  : 'unknown',
        };
      }),
    };
  } catch (error) {
    return {
      kind: 'unavailable',
      libraries: [],
      documents: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
