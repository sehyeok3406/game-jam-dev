import type { AiRunInput } from '../../contracts/ai.ts';

export type ApprovalExecutionPorts<T> = {
  assertAuthorized(): void;
  prepare(): Promise<unknown>;
  serial(operation: () => Promise<T>): Promise<T>;
  queueSupported(): boolean;
  updating(): boolean;
  busy(): boolean;
  reserve(input: AiRunInput): Promise<T>;
  execute(input: AiRunInput, authorized: () => void): Promise<T>;
};

/** UI and Discord use the same execution gate; only the desktop adapter flushes native editors. */
export class ApprovalService<T> {
  private ports: ApprovalExecutionPorts<T>;
  constructor(ports: ApprovalExecutionPorts<T>) {
    this.ports = ports;
  }
  async start(input: AiRunInput, authorized: () => void = () => {}) {
    const p = this.ports;
    p.assertAuthorized();
    authorized();
    if (p.updating() || (!p.queueSupported() && p.busy()))
      throw Error(
        '다른 AI 작업 또는 업데이트가 진행 중입니다. 완료 후 다시 승인해주세요.',
      );
    await p.prepare();
    return p.serial(async () => {
      p.assertAuthorized();
      authorized();
      if (p.updating()) throw Error('업데이트 재시작을 준비하고 있습니다.');
      return p.queueSupported()
        ? p.reserve({ ...input, queueVersion: 1 })
        : p.execute(input, authorized);
    });
  }
}
