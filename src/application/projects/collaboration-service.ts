import type { GameCanvasApi } from '../../contracts/app-api.ts';
import type { CollaborationRole } from '../../contracts/collaboration.ts';
import type {
  CollaborationSessionPort,
  ConnectionScope,
  ConnectionOffer,
} from '../ports/collaboration-session.ts';

export class CollaborationService {
  private ports: CollaborationSessionPort;
  constructor(ports: CollaborationSessionPort) {
    this.ports = ports;
  }
  get() {
    return this.ports.state();
  }
  private async checkOffer(scope: ConnectionScope, offer: ConnectionOffer) {
    try {
      scope.assertCurrent();
    } catch (error) {
      // A successful remote join/create must not lose its only encrypted local credential copy.
      await offer.retain(scope.shared ? scope.localRoot : scope.root);
      throw error;
    }
  }
  private async activate(offer: ConnectionOffer, localRoot: string | null) {
    try {
      return await offer.activate(localRoot);
    } catch (error) {
      await offer.retain(localRoot);
      throw error;
    }
  }
  async create(input: Parameters<GameCanvasApi['createCollaboration']>[0]) {
    const p = this.ports,
      scope = p.scope();
    if (scope.shared || p.busy())
      throw Error('현재 공동 프로젝트나 AI 작업을 먼저 종료해주세요.');
    p.assertSecure();
    if (!scope.root) throw Error('프로젝트 폴더를 먼저 열어주세요.');
    const source = await p.source(scope.root, scope.assertCurrent);
    scope.assertCurrent();
    const offer = await p.create(input, source);
    await this.checkOffer(scope, offer);
    return this.activate(offer, scope.root);
  }
  async join(input: Parameters<GameCanvasApi['joinCollaboration']>[0]) {
    return this.connect(() => this.ports.join(input));
  }
  async recover(input: Parameters<GameCanvasApi['recoverCollaboration']>[0]) {
    return this.connect(() => this.ports.recover(input));
  }
  private async connect(request: () => Promise<ConnectionOffer>) {
    const p = this.ports,
      scope = p.scope();
    if (p.busy()) throw Error('AI 작업을 먼저 종료해주세요.');
    p.assertSecure();
    const offer = await request();
    await this.checkOffer(scope, offer);
    if (scope.shared) {
      try {
        await p.suspend();
      } catch (error) {
        await offer.retain(scope.localRoot);
        throw error;
      }
    }
    const current = p.scope();
    return this.activate(offer, current.localRoot ?? current.root);
  }
  toLocal(
    input: import('../../contracts/project-mode.ts').LocalConversionInput,
  ) {
    if (!this.ports.toLocal) throw Error('프로젝트 전환을 지원하지 않습니다.');
    return this.ports.toLocal(input);
  }
  handover(action: 'prepare' | 'accept' | 'cancel', successorId?: string) {
    if (!this.ports.handover) throw Error('소유권 인계를 지원하지 않습니다.');
    return this.ports.handover(action, successorId);
  }
  leave() {
    return this.ports.leave();
  }
  async resolve(id: string, choice: 'local' | 'server') {
    const active = this.ports.active();
    if (!active) throw Error('공동 프로젝트를 먼저 열어주세요.');
    active.assertCurrent();
    await active.backupOffline();
    active.assertCurrent();
    await active.resolve(id, choice);
    active.assertCurrent();
  }
  async resume() {
    const active = this.ports.active();
    if (active) {
      await active.resume();
      active.assertCurrent();
    }
    return this.ports.state();
  }
  async invite() {
    const active = this.ports.active();
    if (!active) throw Error('공동 프로젝트에 먼저 참여해주세요.');
    const state = await active.invite();
    active.assertCurrent();
    await active.persist();
    active.assertCurrent();
    return state;
  }
  async role(id: string, role: CollaborationRole | 'removed') {
    const active = this.ports.active();
    if (!active) throw Error('공동 프로젝트에 먼저 참여해주세요.');
    await active.role(id, role);
    active.assertCurrent();
  }
  async lock(path: string) {
    const scope = this.ports.scope(),
      active = this.ports.active();
    await this.ports.prepareLock(path);
    scope.assertCurrent();
    await active?.lock(path);
    active?.assertCurrent();
  }
  async unlock(path: string) {
    const active = this.ports.active();
    await active?.unlock(path);
    active?.assertCurrent();
  }
}
