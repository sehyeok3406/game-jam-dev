/** Formatting stays at the adapter boundary; metadata is round-tripped unchanged. */
export interface MarkdownCodec {
  parse(raw: string): { data: Record<string, unknown>; content: string };
  stringify(content: string, data: Record<string, unknown>): string;
}
