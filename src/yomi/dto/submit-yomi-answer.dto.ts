import { IsEnum, IsUUID } from 'class-validator';

export enum FateCardChoice {
  A = 'A',
  B = 'B',
}

export class SubmitYomiAnswerDto {
  @IsUUID('4')
  roomId!: string;

  @IsUUID('4')
  actorUserId!: string;

  @IsUUID('4')
  targetUserId!: string;

  @IsUUID('4')
  fateCardId!: string;

  @IsEnum(FateCardChoice)
  selectedOption!: FateCardChoice;
}
