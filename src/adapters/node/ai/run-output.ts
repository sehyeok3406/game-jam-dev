import type { AiProcessEvent } from '../../../application/ai/ai-executor.ts';
import type { AiProviderId, AiRunEvent } from '../../../contracts/ai.ts';
import { providerEvent } from './providers.ts';
import { describeCodexJsonEvent } from './codex.ts';

import type { AiRunOutput } from '../../../application/ai/run-output.ts';
/** Provider JSON/line framing is independent from process lifetime and publication. */
export class ProviderRunOutput implements AiRunOutput {
  private provider: AiProviderId;
  private emit: (kind: AiRunEvent['kind'], message: string) => void;
  private stdout = '';
  private stderrBuffer = '';
  private grokText = '';
  private grokEnded = false;
  lastMessage = '';
  failure = '';
  constructor(
    provider: AiProviderId,
    emit: (kind: AiRunEvent['kind'], message: string) => void,
  ) {
    this.provider = provider;
    this.emit = emit;
  }
  get stderr() {
    return this.stderrBuffer.trim();
  }
  private line(line: string) {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (this.provider !== 'codex-cli') {
        const info = providerEvent(this.provider, parsed);
        if (this.provider === 'grok-cli') {
          if (info && 'delta' in info && info.delta) {
            this.grokText = (this.grokText + info.message).slice(-16_000);
            return;
          }
          if ((parsed as Record<string, unknown>)?.type === 'end')
            this.grokEnded = true;
        }
        if (info?.error) this.failure = info.message;
        if (info?.result)
          this.lastMessage = this.grokText.trim() || info.message;
        if (info?.message)
          this.emit(
            info.error ? 'error' : info.result ? 'result' : 'log',
            info.result ? this.lastMessage : info.message,
          );
        return;
      }
      const message = describeCodexJsonEvent(parsed);
      if (!message) return;
      const record = parsed as Record<string, unknown>;
      if (record.type === 'turn.failed' || record.type === 'error')
        this.failure = message;
      const item =
        record.item && typeof record.item === 'object'
          ? (record.item as Record<string, unknown>)
          : null;
      if (item?.type === 'agent_message') this.lastMessage = message;
      this.emit(
        record.type === 'error' || item?.type === 'error'
          ? 'error'
          : item?.type === 'agent_message'
            ? 'result'
            : 'log',
        message,
      );
    } catch {
      this.emit('log', line.trim());
    }
  }
  consume(event: AiProcessEvent) {
    if (event.stream === 'stdout') {
      this.stdout += event.text;
      const lines = this.stdout.split(/\r?\n/);
      this.stdout = lines.pop() ?? '';
      lines.forEach((line) => this.line(line));
    } else {
      this.stderrBuffer += event.text;
      const lines = this.stderrBuffer.split(/\r?\n/);
      this.stderrBuffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.emit('log', line.trim());
    }
  }
  flush() {
    if (this.stdout.trim()) this.line(this.stdout);
    this.stdout = '';
    if (this.provider === 'grok-cli' && !this.grokEnded && !this.failure)
      this.failure = 'Grok의 실행 완료 이벤트를 받지 못했습니다.';
  }
  reset() {
    this.stdout = '';
    this.stderrBuffer = '';
    this.lastMessage = '';
    this.failure = '';
    this.grokText = '';
    this.grokEnded = false;
  }
}
