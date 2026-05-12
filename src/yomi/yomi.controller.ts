import { Body, Controller, Post } from '@nestjs/common';
import { SubmitYomiAnswerDto } from './dto/submit-yomi-answer.dto.js';
import { YomiSubmissionResult, YomiService } from './yomi.service.js';

@Controller('yomi')
export class YomiController {
  constructor(private readonly yomiService: YomiService) {}

  @Post('answers')
  async submitAnswer(@Body() dto: SubmitYomiAnswerDto): Promise<YomiSubmissionResult> {
    return this.yomiService.submitAnswer(dto);
  }
}
