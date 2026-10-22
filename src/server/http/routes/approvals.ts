import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
export const approvalsRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) => action.startsWith('requests-') && action !== 'requests-start',
    ports,
  );
