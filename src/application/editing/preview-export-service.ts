import type { Snapshot } from '../../contracts/project.ts';

/** Exports the saved HTML only; dialog latency cannot select a different project/revision. */
type ExportPorts = {
  capture(): Promise<Snapshot>;
  assertCurrent(): void;
  validate(path: string, content: string): void;
  save(
    input: { name: string; content: string },
    check: () => Promise<void>,
  ): Promise<boolean>;
};
export class PreviewExportService {
  private readonly ports: ExportPorts;
  constructor(ports: ExportPorts) {
    this.ports = ports;
  }
  async export(path: string) {
    this.ports.assertCurrent();
    const files = await this.ports.capture(),
      content = files[path];
    if (typeof content !== 'string')
      throw Error('내보낼 HTML을 찾을 수 없습니다.');
    this.ports.validate(path, content);
    const check = async () => {
      this.ports.assertCurrent();
      const current = await this.ports.capture();
      this.ports.assertCurrent();
      if (current[path] !== content)
        throw Error(
          '저장 창을 연 뒤 게임이 변경되었습니다. 최신 게임을 다시 내보내주세요.',
        );
    };
    await check();
    return this.ports.save(
      { name: path.split('/').slice(-3, -1).join('-') || 'game', content },
      check,
    );
  }
}
