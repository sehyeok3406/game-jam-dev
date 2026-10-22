/** Compatibility entry point for existing desktop tools and older callers. */
export {
  SqliteProjectStore as SyncStore,
  readPublication as readSyncFiles,
} from './adapters/sqlite/project-repository.ts';
