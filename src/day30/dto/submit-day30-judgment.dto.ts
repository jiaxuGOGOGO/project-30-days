import { IsIn, IsInt, IsUUID, Min } from 'class-validator';
import { Decision } from '@prisma/client';

/**
 * Day 30 Judgment DTO — Progressive Trust Reveal.
 *
 * Terminology mapping:
 * - COOPERATE = STAY (留下) — hand over the final key
 * - DEFECT = PAUSE (暂停) — not ready yet
 *
 * Backend accepts the original enum values for backward compatibility.
 */
export class SubmitDay30JudgmentDto {
  @IsUUID()
  connectionId!: string;

  @IsUUID()
  userId!: string;

  @IsIn([Decision.DEFECT, Decision.COOPERATE])
  choice!: Extract<Decision, 'DEFECT' | 'COOPERATE'>;

  @IsInt()
  @Min(2000)
  heldMs!: number;
}
