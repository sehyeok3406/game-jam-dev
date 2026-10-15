import { DEFAULT_MULTIPLAYER, type MultiplayerSettings } from './types.ts';

/** A convenience for plain requests; explicit library choices remain authoritative.
 * Ambiguous requests are left to the generation contract, not guessed from 1P/2P.
 */
export function multiplayerIntent(
  text: string,
): MultiplayerSettings | null | undefined {
  const sentences = text.split(/[.!?。\n]+/).map((part) => part.trim());
  let result: MultiplayerSettings | null | undefined;
  for (const sentence of sentences) {
    if (
      /(?:싱글|혼자|1인).{0,8}(?:게임으로|플레이로|전용으로|모드로)\s*(?:바꿔|변경|전환)|single.player\s+only/i.test(
        sentence,
      )
    ) {
      result = null;
      continue;
    }
    if (
      !/(?:멀티(?:\s*플레이)?(?=\s|[·:,.!?]|$|를|로|가|는|도|게임|지원|연결|기능|테스트)|온라인|함께\s*플레이|\bmultiplayer\b|\bonline\b|\bco-op\b)/i.test(
        sentence,
      )
    )
      continue;
    if (
      /(?:멀티(?:\s*플레이)?|온라인(?:\s*(?:멀티(?:\s*플레이)?|플레이))?|함께\s*플레이)\s*(?:(?:연결\s*)?기능|모듈)?\s*(?:은|는|을|를|가|이)?\s*(?:아예\s*|모두\s*|완전히\s*)?(?:빼|제거|삭제|없애|필요\s*없|넣지|추가하지|사용하지|하지\s*않)|(?:without|remove|disable|no)\s+(?:online\s+)?multiplayer/i.test(
        sentence,
      )
    ) {
      result = null;
      continue;
    }
    if (
      /(?:한|같은)\s*(?:컴퓨터|pc|기기)|로컬\s*(?:멀티|협동)|split[ -]?screen|local\s+multiplayer/i.test(
        sentence,
      ) &&
      !/서로\s*다른|다른\s*(?:컴퓨터|pc|기기)|인터넷|\bonline\b|온라인/i.test(
        sentence,
      )
    ) {
      result = null;
      continue;
    }
    const count = sentence.match(
      /(?:최대\s*)?([2-9]|\d{2})\s*(?:인|명|players?\b)/i,
    )?.[1];
    if (count && Number(count) > 4)
      throw Error(
        '[GC-MP-001] 함께 플레이는 현재 2~4명을 지원해요. 참여 인원을 조정해주세요.',
      );
    result = {
      ...DEFAULT_MULTIPLAYER,
      maxPlayers: count
        ? (Number(count) as 2 | 3 | 4)
        : (result?.maxPlayers ?? 2),
    };
  }
  return result;
}
