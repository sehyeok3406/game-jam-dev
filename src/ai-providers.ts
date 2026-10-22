/** Compatibility exports; new UI/domain consumers use core/ai/catalog. */
export * from './core/ai/catalog.ts';
export {
  aiArguments,
  providerEvent,
  GEMINI_RUN_SETTINGS,
  geminiRunSettings,
} from './adapters/node/ai/providers.ts';
