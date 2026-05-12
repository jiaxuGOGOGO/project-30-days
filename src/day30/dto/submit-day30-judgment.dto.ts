import { IsIn, IsInt, IsUUID, Min } from 'class-validator';
import { Decision } from '@prisma/client';

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
