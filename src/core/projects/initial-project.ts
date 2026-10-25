import type { Snapshot } from '../../contracts/project.ts';
import { projectDirectoryName } from './project-name.ts';

export function initialProjectSnapshot(input: string): Snapshot {
  const name = projectDirectoryName(input);
  return {
    'project.md': [
      '---',
      'id: project',
      `title: ${JSON.stringify(name)}`,
      `project_name: ${JSON.stringify(name)}`,
      'type: overview',
      'status: draft',
      'x: 80',
      'y: 80',
      'width: 360',
      'height: 320',
      'sources: []',
      '---',
      '',
      `# ${name}`,
      '',
      '게임 아이디어를 자유롭게 기록해보세요.',
      '',
    ].join('\n'),
  };
}
