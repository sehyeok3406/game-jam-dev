export interface ProjectTextFiles {
  read(relative: string): Promise<string | null>;
  replace(
    relative: string,
    expected: string | null,
    raw: string,
  ): Promise<void>;
}
