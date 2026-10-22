import type { CanvasSection } from '../../contracts/canvas.ts';

export interface LocalSectionRepository {
  read(relative: string): Promise<CanvasSection>;
  list(): Promise<CanvasSection[]>;
  write(
    relative: string,
    section: Omit<CanvasSection, 'relativePath' | 'modifiedAt'>,
  ): Promise<CanvasSection>;
}
