import { Injectable, Logger } from '@nestjs/common';

/**
 * Provider-agnostic LLM entry point — your single point of contact with whatever
 * model you have a key for.
 *
 * Pick a provider in `.env` via LLM_PROVIDER (anthropic | openai | gemini) and set
 * the matching API key. The campaign "generate message" feature should call
 * `complete()` with a fully-interpolated prompt.
 *
 * How you handle timeouts, retries, errors, and status persistence AROUND this
 * call is part of what we're evaluating — that logic belongs in your campaigns
 * service, not here.
 *
 * NOTE: the SDK calls below are written against each provider's current
 * messages/chat API. If you prefer a different model or a newer SDK call, you're
 * free to adjust this file — just keep the `complete(prompt): Promise<string>`
 * contract so the rest of the app doesn't care which provider you used.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider: string;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor() {
    this.provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
    this.model = process.env.LLM_MODEL || this.defaultModel();
    this.maxTokens = Number(process.env.LLM_MAX_TOKENS || 300);
  }

  private defaultModel(): string {
    // Cheap/fast defaults per provider. If your account doesn't have one of
    // these, set LLM_MODEL in .env to a model you can access — the code doesn't
    // care which model string you use.
    switch (this.provider) {
      case 'openai':
        return 'gpt-4o-mini';
      case 'gemini':
        return 'gemini-2.0-flash';
      case 'anthropic':
      default:
        return 'claude-haiku-4-5';
    }
  }

  /**
   * Sends a single user prompt and returns the model's text completion.
   * Throws on provider/network error — callers decide how to handle that.
   */
  async complete(prompt: string): Promise<string> {
    switch (this.provider) {
      case 'openai':
        return this.completeOpenai(prompt);
      case 'gemini':
        return this.completeGemini(prompt);
      case 'anthropic':
        return this.completeAnthropic(prompt);
      default:
        throw new Error(`Unknown LLM_PROVIDER: ${this.provider}`);
    }
  }

  // --- Anthropic -----------------------------------------------------------
  private async completeAnthropic(prompt: string): Promise<string> {
    // Lazy import so the app boots even if only one provider's SDK is installed.
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
  }

  // --- OpenAI --------------------------------------------------------------
  private async completeOpenai(prompt: string): Promise<string> {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return (res.choices[0]?.message?.content || '').trim();
  }

  // --- Google Gemini -------------------------------------------------------
  private async completeGemini(prompt: string): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = client.getGenerativeModel({ model: this.model });
    const res = await model.generateContent(prompt);
    return res.response.text().trim();
  }
}
