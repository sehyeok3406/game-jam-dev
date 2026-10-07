import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import {
  AI_PROVIDERS,
  isAiProvider,
  aiArguments,
  providerEvent,
  GEMINI_RUN_SETTINGS,
} from '../src/ai-providers.ts';
import { otherCliStatus, findOtherCli } from '../src/ai-cli.ts';
import { embedSelectedAssets } from '../src/ai-asset-links.ts';
import { encodeAsset } from '../src/file-assets.ts';

test('exactly GPT, Claude and Gemini are supported; file-only adapters never enable shell or permission bypass', () => {
  assert.deepEqual(
    AI_PROVIDERS.map((p) => p.id),
    ['codex-cli', 'claude-cli', 'gemini-cli'],
  );
  for (const id of ['other-cli', 'openrouter', '', null])
    assert.equal(isAiProvider(id), false);
  for (const provider of AI_PROVIDERS) {
    const args = aiArguments(
      provider.id,
      'fixture-model',
      'C:/fixture with spaces',
    );
    assert.equal(args[args.indexOf('--model') + 1], 'fixture-model');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--yolo'));
  }
  const claude = aiArguments('claude-cli', null, '/stage');
  assert.ok(claude.includes('--restricted'));
  assert.equal(
    claude[claude.indexOf('--tools') + 1],
    'Read,Glob,Grep,Edit,Write',
  );
  assert.equal(claude[claude.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(!GEMINI_RUN_SETTINGS.tools.core.includes('run_shell_command'));
  assert.equal(GEMINI_RUN_SETTINGS.hooksConfig.enabled, false);
  assert.equal(GEMINI_RUN_SETTINGS.admin.mcp.enabled, false);
  assert.equal(GEMINI_RUN_SETTINGS.admin.extensions.enabled, false);
  assert.deepEqual(GEMINI_RUN_SETTINGS.context.includeDirectories, []);
});

test('switching Codex models keeps isolated configuration and workspace write permissions', () => {
  for (const model of [null, 'gpt-6-luna', 'gpt-6.1-sol', 'custom-model']) {
    const stage = 'C:/fixture with spaces';
    const args = aiArguments('codex-cli', model, stage);
    const overrides = args.flatMap((arg, index) =>
      arg === '--config' ? [args[index + 1]] : [],
    );
    assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.includes('--approve-for-me'));
    assert.ok(overrides.includes('default_permissions=":workspace"'));
    assert.equal(args[args.indexOf('--cd') + 1], stage);
    assert.equal(args.includes('--model'), model !== null);
    if (model) assert.equal(args[args.indexOf('--model') + 1], model);
    // Legacy sandbox flags conflict with the approval preset and do not select
    // the permission profile when the user configuration is ignored.
    assert.ok(!args.includes('--sandbox'));
    assert.ok(!overrides.some((value) => value.startsWith('sandbox_mode=')));
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  }
});

test('Claude and Gemini structured failures are detected even when the process returns zero', () => {
  assert.equal(
    providerEvent('claude-cli', {
      type: 'result',
      is_error: true,
      result: 'permission denied',
    }).error,
    true,
  );
  assert.equal(
    providerEvent('claude-cli', {
      type: 'result',
      is_error: false,
      result: 'done',
    }).result,
    true,
  );
  assert.match(
    providerEvent('claude-cli', {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '한글' },
          { type: 'tool_use', name: 'Write' },
        ],
      },
    }).message,
    /한글.*\n도구 실행/,
  );
  assert.equal(
    providerEvent('gemini-cli', {
      type: 'result',
      status: 'error',
      error: { message: 'quota' },
    }).error,
    true,
  );
  assert.equal(
    providerEvent('gemini-cli', {
      type: 'error',
      severity: 'warning',
      message: 'warning',
    }).error,
    false,
  );
  assert.equal(
    providerEvent('gemini-cli', { type: 'result', status: 'success' }).result,
    true,
  );
  assert.equal(providerEvent('claude-cli', null), null);
});

test('CLI detection runs read-only probes; missing restricted-mode support fails closed and auth tokens are not returned', async () => {
  const calls = [];
  const collect = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'claude')
      return { code: 0, stdout: process.execPath + '\n', stderr: '' };
    if (args[0] === '--version')
      return { code: 0, stdout: 'fixture-version', stderr: '' };
    if (args[0] === '--help')
      return {
        code: 0,
        stdout: '--restricted --strict-mcp-config --tools --output-format',
        stderr: '',
      };
    return { code: 0, stdout: '{"token":"must-not-leak"}', stderr: '' };
  };
  assert.ok(await findOtherCli('claude-cli', collect));
  const status = await otherCliStatus('claude-cli', collect);
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);
  assert.ok(!JSON.stringify(status).includes('must-not-leak'));
  assert.ok(calls.some((args) => args.join(' ') === 'auth status'));
  const outdated = await otherCliStatus('claude-cli', async (command, args) =>
    args[0] === '--help'
      ? { code: 0, stdout: 'old-cli', stderr: '' }
      : collect(command, args),
  );
  assert.equal(outdated.available, false);
  assert.match(outdated.message, /업데이트/);
});

test('selected image placeholders embed validated bytes without granting CLI shell access; unselected and unsafe paths fail', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
    'base64',
  );
  const imagePath = 'assets/images/player.png';
  const uri = encodeAsset(imagePath, png);
  const files = {
    'ideas/player.md': matter.stringify('player', {
      asset: {
        path: imagePath,
        purpose: 'asset',
        originalName: 'player.png',
        mime: 'image/png',
        bytes: png.length,
      },
    }),
    [imagePath]: uri,
  };
  const spec = matter.stringify('task', { inputs: ['ideas/player.md'] });
  assert.equal(
    embedSelectedAssets(
      '<img src="gamecanvas-asset:' + imagePath + '">',
      spec,
      files,
    ),
    '<img src="' + uri + '">',
  );
  for (const path of ['assets/images/unselected.png', '../secret.png'])
    assert.throws(
      () =>
        embedSelectedAssets(
          '<img src="gamecanvas-asset:' + path + '">',
          spec,
          files,
        ),
      /선택되지 않은/,
    );
  assert.throws(
    () =>
      embedSelectedAssets(
        '<img src="gamecanvas-asset:' + imagePath + '">',
        matter.stringify('task', { inputs: [] }),
        files,
      ),
    /선택되지 않은/,
  );
});
