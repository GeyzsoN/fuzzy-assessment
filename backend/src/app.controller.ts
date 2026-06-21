import { Body, Controller, Get, Post } from '@nestjs/common';
import { LlmService } from './shared/llm/llm.service';

/**
 * Health + an LLM smoke-test endpoint so candidates can verify their API key works.
 * Feel free to delete the /llm/smoke route once you've confirmed your setup.
 */
@Controller()
export class AppController {
  constructor(private readonly llm: LlmService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('llm/smoke')
  async smoke(@Body('prompt') prompt: string) {
    const text = await this.llm.complete(prompt || 'Say hello in 5 words.');
    return { text };
  }
}
