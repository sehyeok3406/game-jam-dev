import type { SharedProjectFiles } from '../ports/shared-project-files.ts';
import type { Snapshot } from '../../contracts/project.ts';

/** A server snapshot is authoritative; mirror failures never become a local editing command. */
export class SharedProjectMirror {
  private files: SharedProjectFiles;
  private assertCurrent: () => void;
  constructor(files: SharedProjectFiles, assertCurrent: () => void) {
    this.files = files;
    this.assertCurrent = assertCurrent;
  }
  async sync(snapshot: Snapshot) {
    const target = { ...snapshot };
    const files = this.files;
    this.assertCurrent();
    await files.ensure(target);
    this.assertCurrent();
    const before = await files.capture();
    this.assertCurrent();
    const move = await files.move(before, target);
    try {
      this.assertCurrent();
      await files.apply(
        move.baseline,
        Object.fromEntries(
          Object.keys({ ...before, ...target }).map((relative) => [
            relative,
            target[relative] ?? null,
          ]),
        ),
      );
    } catch (error) {
      // Roll back at the captured root even if the initiating session has since closed.
      await move.rollback();
      throw error;
    } finally {
      await move.finish();
    }
    // The metadata commit already succeeded. A later cancellation/trash failure must not undo folder moves alone.
    this.assertCurrent();
    await files.trash(before, target);
    this.assertCurrent();
    await files.cleanup(before, target);
    this.assertCurrent();
  }
  async trash(before: Snapshot, after: Snapshot) {
    this.assertCurrent();
    await this.files.trash({ ...before }, { ...after });
    this.assertCurrent();
  }
}
