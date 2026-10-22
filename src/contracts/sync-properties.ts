export type PropertyVersions = Record<
  string,
  Partial<Record<PropertyGroup, number>>
>;
export type PropertyGroup = keyof typeof propertyKeys | 'structure';
export const propertyKeys = {
  content: ['title'],
  position: ['x', 'y'],
  size: ['width', 'height', 'collapsed'],
  color: ['background_color'],
  workflow: ['workflow_status_id', 'workflow_order', 'status_property_enabled'],
} as const;
