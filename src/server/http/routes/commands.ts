import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
export const commandsRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) =>
      ['state', 'lock', 'unlock', 'command', 'offline-sync'].includes(action),
    ports,
  );
