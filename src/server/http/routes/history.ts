import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
export const historyRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) =>
      ['history', 'history-read', 'history-change', 'restore'].includes(action),
    ports,
  );
