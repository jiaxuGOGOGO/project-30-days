export interface DirectedYomiKeyInput {
  roomId: string;
  fateCardId: string;
  actorUserId: string;
  targetUserId: string;
}

export function canonicalPair(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId.localeCompare(secondUserId) <= 0 ? [firstUserId, secondUserId] : [secondUserId, firstUserId];
}

export function yomiAnswerKey(input: DirectedYomiKeyInput): string {
  return `yomi:answer:${input.roomId}:${input.fateCardId}:${input.actorUserId}:${input.targetUserId}`;
}

export function yomiPairLockKey(roomId: string, fateCardId: string, firstUserId: string, secondUserId: string): string {
  const [left, right] = canonicalPair(firstUserId, secondUserId);
  return `yomi:lock:${roomId}:${fateCardId}:${left}:${right}`;
}

export function yomiCooldownKey(roomId: string, actorUserId: string, targetUserId: string): string {
  return `yomi:cooldown:${roomId}:${actorUserId}:${targetUserId}`;
}
