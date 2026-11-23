import type { DiscordChannel } from './channel-manager';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
/** 一致する候補が無いことを表す値です。Discord のチャンネル ID (数字) とは衝突しません。 */
const NO_MATCH = 'none';

export interface ChannelNameMatcher {
  findSimilarChannel(input: string, channels: DiscordChannel[]): Promise<DiscordChannel | undefined>;
}

interface GeminiMatchResult {
  matchedChannelId: string;
}

/** 応答を速くするため、モデルの世代に合わせて thinking を最小にする設定を返します。 */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-flash/u.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3(\.\d+)?-flash/u.test(model)) return { thinkingLevel: 'minimal' };
  return undefined;
}

/** Uses Gemini structured output to resolve aliases and spelling variations. */
export class GeminiChannelNameMatcher implements ChannelNameMatcher {
  public constructor(
    private readonly apiKey: string,
    private readonly model = DEFAULT_GEMINI_MODEL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async findSimilarChannel(
    input: string,
    channels: DiscordChannel[],
  ): Promise<DiscordChannel | undefined> {
    if (channels.length === 0) return undefined;

    const response = await this.fetcher(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: [
              '入力されたゲーム名と同じゲームを表すチャンネルを候補から選んでください。',
              '略称、英語・日本語名、大小文字、表記揺れを考慮してください。',
              `同じゲームだと判断できない場合は matchedChannelId を "${NO_MATCH}" にしてください。`,
              `入力: ${JSON.stringify(input)}`,
              `候補: ${JSON.stringify(channels.map(({ id, name }) => ({ id, name })))}`,
            ].join('\n') }],
          }],
          generationConfig: {
            temperature: 0,
            thinkingConfig: thinkingConfigFor(this.model),
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: {
                matchedChannelId: { type: 'string', enum: [...channels.map(({ id }) => id), NO_MATCH] },
              },
              required: ['matchedChannelId'],
              additionalProperties: false,
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini API request failed (${response.status})`);

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini API returned no structured output');

    const result = JSON.parse(text) as GeminiMatchResult;
    return channels.find((channel) => channel.id === result.matchedChannelId);
  }
}
