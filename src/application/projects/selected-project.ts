import type { WorkspaceState } from '../../contracts/project.ts';
import { projectDirectoryName } from '../../core/projects/project-name.ts';

type Ports = {
  id(): string;
  name(root: string): Promise<string>;
  known(root: string): string | undefined;
  assertName(name: string, exceptId?: string): void;
  withName<T>(
    name: string,
    exceptId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T>;
  rename(root: string, name: string, expectedName: string): Promise<void>;
  open(root: string): Promise<WorkspaceState>;
};
/** An opaque one-use selection is the authority to rename an unregistered folder's metadata. */
export class SelectedProjectRegistration {
  private ports: Ports;
  private selected?: { token: string; root: string; name: string };
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async select(root: string): Promise<WorkspaceState> {
    this.selected = undefined;
    if (this.ports.known(root)) return this.ports.open(root);
    const name = await this.ports.name(root);
    try {
      this.ports.assertName(projectDirectoryName(name));
    } catch (error) {
      const token = this.ports.id();
      this.selected = { token, root, name };
      return {
        root: null,
        name: null,
        registration: { token, name, reason: (error as Error).message },
      };
    }
    return this.ports.withName(name, undefined, () => this.ports.open(root));
  }
  async register(token: string, input: string | null) {
    const selected = this.selected;
    if (!selected || selected.token !== token)
      throw Error('폴더 선택이 만료되었습니다. 폴더를 다시 선택해주세요.');
    if (input === null) {
      this.selected = undefined;
      return { root: null, name: null };
    }
    const name = projectDirectoryName(input);
    return this.ports.withName(
      name,
      this.ports.known(selected.root),
      async () => {
        await this.ports.rename(selected.root, name, selected.name);
        selected.name = name;
        const result = await this.ports.open(selected.root);
        this.selected = undefined;
        return result;
      },
    );
  }
}
