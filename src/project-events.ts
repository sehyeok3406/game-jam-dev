import type { PlayLobbyEvent } from './multiplayer/types.ts';

/** Bounded SSE decoding, including partial chunks, CRLF and named events. */
export class ProjectEventDecoder {
  private buffer = '';
  push(chunk: string): { type: string; data: string }[] {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) throw Error('Project event too large');
    const events: { type: string; data: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let type = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) events.push({ type, data: data.join('\n') });
    }
    return events;
  }
}

export function readPlayLobbyEvent(data: string): PlayLobbyEvent {
  const value = JSON.parse(data) as PlayLobbyEvent;
  if (
    !value ||
    !/^[a-f0-9-]{36}$/.test(value.serverEpoch) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw Error('Invalid play lobby event');
  return { serverEpoch: value.serverEpoch, revision: value.revision };
}
