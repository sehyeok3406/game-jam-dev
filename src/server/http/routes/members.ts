import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
export const membersRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) => ['invite', 'role', 'leave'].includes(action),
    ports,
  );
