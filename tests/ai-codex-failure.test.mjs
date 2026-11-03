import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderRunOutput } from '../src/adapters/node/ai/run-output.ts';
import { describeCodexJsonEvent } from '../src/adapters/node/ai/codex.ts';
test('Codex terminal errors keep usage-limit details across chunked frames and final generic failures', () => {
  const reason = 'Usage limit reached; try again at 12:43 PM.';
  assert.equal(
    describeCodexJsonEvent({ type: 'turn.failed', error: { message: reason } }),
    reason,
  );
  const events = [],
    output = new ProviderRunOutput('codex-cli', (kind, message) =>
      events.push({ kind, message }),
    );
  const raw =
    JSON.stringify({ type: 'error', message: reason }) +
    '\n' +
    JSON.stringify({
      type: 'turn.failed',
      error: { message: 'Codex execution failed' },
    }) +
    '\n';
  output.consume({ stream: 'stdout', text: raw.slice(0, 25) });
  output.consume({ stream: 'stdout', text: raw.slice(25) });
  output.flush();
  assert.equal(output.failure, reason);
  assert.ok(events.some((e) => e.kind === 'error' && e.message === reason));
  output.reset();
  output.consume({
    stream: 'stdout',
    text: JSON.stringify({ type: 'turn.failed', error: { message: reason } }),
  });
  output.flush();
  assert.equal(output.failure, reason);
  output.reset();
  output.consume({ stream: 'stdout', text: '{"type":"turn.failed"}\n' });
  assert.equal(output.failure, 'Codex 실행이 실패했습니다.');
});
