import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

let nextPid = 1000;
const children = new Map<number, ReturnType<typeof spawn>>();
export const executionStarts: { pid: number; model: string; stage: string }[] =
  [];
export const executionSpecs: {
  model: string;
  inputs: string[];
  outputs: string[];
}[] = [];
export function spawn(
  command: string,
  args: string[],
  options?: { cwd?: string },
) {
  const isExecution =
    args[0] === 'exec' || args.includes('--print') || args.includes('--prompt');
  const provider = args.includes('--print')
    ? 'claude-cli'
    : args.includes('--prompt')
      ? 'gemini-cli'
      : 'codex-cli';
  const child = Object.assign(new EventEmitter(), {
    pid: nextPid++,
    killed: false,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: () => {
      child.killed = true;
      child.emit('close', null);
      return true;
    },
  });
  children.set(child.pid, child);
  if (isExecution)
    executionStarts.push({
      pid: child.pid,
      model: args[args.indexOf('--model') + 1],
      stage: options?.cwd ?? args[args.indexOf('--cd') + 1],
    });
  setTimeout(
    async () => {
      try {
        if (command === 'where.exe' || command === 'which') {
          child.stdout.write(`${process.execPath}\n`);
          child.emit('close', 0);
          return;
        }
        if (command === 'taskkill.exe') {
          children.get(Number(args[args.indexOf('/pid') + 1]))?.kill();
          child.emit('close', 0);
          return;
        }
        if (args[0] === '--help') {
          child.stdout.write(
            '--restricted --strict-mcp-config --tools --output-format --approval-mode --extensions --skip-trust --allowed-mcp-server-names\n',
          );
          child.emit('close', 0);
          return;
        }
        if (
          args[0] === '--version' ||
          args[0] === 'login' ||
          args[0] === 'auth'
        ) {
          child.stdout.write('fixture CLI\n');
          child.emit('close', 0);
          return;
        }
        const stage = options?.cwd ?? args[args.indexOf('--cd') + 1];
        if (provider === 'claude-cli') {
          if (
            !args.includes('--restricted') ||
            args.includes('--dangerously-skip-permissions')
          )
            throw new Error('Claude file restriction missing');
        }
        if (provider === 'gemini-cli') {
          const settings = JSON.parse(
            await fs.readFile(
              path.join(stage, '.gemini/settings.json'),
              'utf8',
            ),
          );
          if (
            settings.tools.core.includes('run_shell_command') ||
            settings.admin.mcp.enabled
          )
            throw new Error('Gemini file restriction missing');
        }
        const mode = args[args.indexOf('--model') + 1];
        const prompt = child.stdin.read()?.toString() ?? '';
        const taskPath = prompt.match(/at (\.ai\/tasks\/[^\n]+\.md)\./)?.[1];
        const taskSpecification = taskPath
          ? matter(await fs.readFile(path.join(stage, taskPath), 'utf8'))
          : { data: {}, content: '' };
        const spec = taskSpecification.data;
        if (
          spec.instructions_source === 'edited' &&
          (!taskSpecification.content.includes('INSTRUCTION-IPC-PROBE') ||
            !prompt.includes('Fixed protection rules'))
        )
          throw new Error(
            'Edited instructions did not reach the CLI workspace or protection prompt.',
          );
        const outputs = spec.expected_outputs ?? ['output/index.html'];
        executionSpecs.push({ model: mode, inputs: spec.inputs, outputs });
        const output = outputs.find((relative: string) =>
          relative.endsWith('.html'),
        );
        child.stdout.write(
          JSON.stringify(
            provider === 'claude-cli'
              ? { type: 'system' }
              : provider === 'gemini-cli'
                ? { type: 'init' }
                : { type: 'turn.started' },
          ) + '\n',
        );
        if (mode !== 'fixture-empty' && output) {
          if (mode.startsWith('fixture-gamejam')) {
            const docs: string[] = [];
            for (const relative of spec.inputs) {
              if (
                matter(await fs.readFile(path.join(stage, relative), 'utf8'))
                  .data.type !== 'image'
              )
                docs.push(relative);
            }
            if (
              docs.length !== 3 ||
              docs.some((relative: string) => !relative.startsWith('docs/'))
            )
              throw new Error(
                'HTML phase did not receive exactly the fresh organized documents',
              );
            for (const relative of docs) {
              const raw = await fs.readFile(path.join(stage, relative), 'utf8');
              if (!raw.includes(`organized ${mode}`))
                throw new Error('HTML phase read stale organized documents');
            }
            if (mode === 'fixture-gamejam-tamper-doc')
              await fs.appendFile(
                path.join(stage, docs[0]),
                '\nILLEGAL-HTML-PHASE-EDIT',
              );
          }
          await fs.mkdir(path.dirname(path.join(stage, output)), {
            recursive: true,
          });
          await fs.writeFile(
            path.join(stage, output),
            mode === 'fixture-invalid' ||
              mode === 'fixture-gamejam-html-invalid'
              ? '```html\n<html><body>not a standalone file</body></html>\n```'
              : mode === 'fixture-implicit-body'
                ? '<!doctype html><html><title>new game</title><style>main{color:green}</style><main><canvas></canvas><button>Play</button></main><script>document.querySelector("button").onclick=()=>document.querySelector("canvas").dataset.playing="yes";</script>'
                : `<html><body>fixture ${mode}</body></html>`,
          );
          if (mode.startsWith('fixture-asset-')) {
            const input = matter(
              await fs.readFile(path.join(stage, spec.inputs[0]), 'utf8'),
            ).data;
            if (!prompt.includes('asset.path') || !input.asset)
              throw new Error('Missing asset instructions');
            const absolute = path.join(stage, input.asset.path);
            const image = await fs.readFile(absolute);
            await fs.writeFile(
              path.join(stage, output),
              `<html><body><img src="${provider === 'codex-cli' ? `data:${input.asset.mime};base64,${image.toString('base64')}` : `gamecanvas-asset:${input.asset.path}`}"></body></html>`,
            );
            if (mode === 'fixture-asset-tamper')
              await fs.appendFile(absolute, Buffer.from([0]));
          }
          if (mode === 'fixture-cross-version')
            await fs.writeFile(
              path.join(stage, 'output/index.html'),
              '<html><body>tampered old version</body></html>',
            );
        }
        if (
          mode !== 'fixture-empty' &&
          mode !== 'fixture-gamejam-organize-invalid' &&
          !output
        ) {
          const sources = await Promise.all(
            spec.inputs
              .filter((relative: string) => relative.endsWith('.md'))
              .map(async (relative: string) => ({
                id: matter(
                  await fs.readFile(path.join(stage, relative), 'utf8'),
                ).data.id,
              })),
          );
          for (const [index, relative] of outputs.entries()) {
            const absolute = path.join(stage, relative);
            const previous = await fs
              .readFile(absolute, 'utf8')
              .then((raw) => matter(raw).data)
              .catch(() => ({}));
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            await fs.writeFile(
              absolute,
              matter.stringify(`## organized ${mode}`, {
                id: previous.id ?? `fixture-${child.pid}-${index}`,
                title: `Game ${index}`,
                type: 'system',
                status: 'draft',
                sources,
                ...(spec.html_analysis_source &&
                mode !== 'fixture-html-analysis-missing-source'
                  ? { analyzed_html: spec.html_analysis_source }
                  : {}),
              }),
            );
          }
          if (mode === 'fixture-html-analysis-tamper')
            await fs.appendFile(
              path.join(stage, spec.html_analysis_source.path),
              '<!-- illegal edit -->',
            );
        }
        if (!child.killed) {
          child.stdout.write(
            JSON.stringify(
              provider === 'claude-cli'
                ? {
                    type: 'result',
                    is_error: mode === 'fixture-provider-error',
                    result:
                      mode === 'fixture-provider-error'
                        ? 'fixture provider failure'
                        : '완료',
                  }
                : provider === 'gemini-cli'
                  ? {
                      type: 'result',
                      status:
                        mode === 'fixture-provider-error' ? 'error' : 'success',
                      error: { message: 'fixture provider failure' },
                    }
                  : { type: 'turn.completed' },
            ) + '\n',
          );
          child.emit('close', 0);
        }
      } catch (error) {
        child.emit('error', error);
      }
    },
    isExecution ? 400 : 5,
  );
  return child;
}
