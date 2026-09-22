import { IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { Decision } from '@prisma/client';

export class ActorQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  userId?: string;
}
export class ConnectionRequestDto extends ActorQueryDto {
  @IsUUID()
  connectionId!: string;
}
export class JudgmentRequestDto extends ConnectionRequestDto {
  @IsIn([Decision.DEFECT, Decision.COOPERATE])
  choice!: Extract<Decision, 'DEFECT' | 'COOPERATE'>;

  @IsInt()
  @Min(2000)
  @Max(60000)
  heldMs!: number;
}
export class EchoRequestDto extends ConnectionRequestDto {
  @IsInt()
  @Min(2)
  @Max(29)
  dayNumber!: number;

  @IsString()
  @Length(1, 500)
  @Matches(/\S/u)
  answer!: string;
}
export class RedeemRequestDto {
  @IsInt()
  @IsIn([5, 10])
  fragmentsToRedeem!: number;
}
