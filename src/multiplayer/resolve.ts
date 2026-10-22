import { multiplayerSettings, readMultiplayerManifest } from './contract.ts';
import { multiplayerIntent } from './intent.ts';
import { PlayError } from './errors.ts';
import type { MultiplayerSettings } from './types.ts';

/** Shared by review, submission and server planning. Explicit choices win. */
export function resolveMultiplayer(input: {
  explicit?: MultiplayerSettings | null;
  instructions: string;
  baselineHtml?: string;
  documents: readonly string[];
}): MultiplayerSettings | null | undefined {
  if (input.explicit !== undefined) return multiplayerSettings(input.explicit);
  const instruction = multiplayerIntent(input.instructions);
  if (instruction !== undefined) return multiplayerSettings(instruction);
  const inherited = input.baselineHtml
    ? readMultiplayerManifest(input.baselineHtml)
    : undefined;
  if (inherited) return multiplayerSettings(inherited);
  const intents = input.documents
    .map(multiplayerIntent)
    .filter((value) => value !== undefined);
  if (
    intents.some(
      (value) =>
        (value?.maxPlayers ?? null) !== (intents[0]?.maxPlayers ?? null),
    )
  )
    throw new PlayError('GC-MP-031');
  return multiplayerSettings(intents[0]);
}
