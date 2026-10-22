import type { ReactNode } from 'react';
import { RuntimeContext, type AppRuntime } from './runtime-context';
export { useRuntime, type AppRuntime } from './runtime-context';

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: AppRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}
