import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
export const aiRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) => action.startsWith('ai-') || action === 'requests-start',
    ports,
  );
