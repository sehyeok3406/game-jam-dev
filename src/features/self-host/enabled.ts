declare const __SELF_HOST_ENABLED__: boolean;
export const SELF_HOST_ENABLED =
  typeof __SELF_HOST_ENABLED__ === 'undefined' ? true : __SELF_HOST_ENABLED__;
