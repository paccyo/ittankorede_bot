import type { DiscordChannel } from './channel-manager';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface ChannelNameMatcher {
  findSimilarChannel(input: string, channels: DiscordChannel[]): Promise<DiscordChannel | undefined>;
}

interface GeminiMatchResult {
  matchedChannelId: string | null;
}

/** Uses Gemini structured output to resolve aliases and spelling variations. */
export class GeminiChannelNameMatcher implements ChannelNameMatcher {
  public constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-2.5-flash',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async findSimilarChannel(
    input: string,
    channels: DiscordChannel[],
  ): Promise<DiscordChannel | undefined> {
    if (channels.length === 0) return undefined;

    const response = await this.fetcher(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: [
              '入力されたゲーム名と同じゲームを表すチャンネルを候補から選んでください。',
              '略称、英語・日本語名、大小文字、表記揺れを考慮してください。',
              '同じゲームだと判断できない場合は matchedChannelId を null にしてください。',
              `入力: ${JSON.stringify(input)}`,
              `候補: ${JSON.stringify(channels.map(({ id, name }) => ({ id, name })))}`,
            ].join('\n') }],
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: {
              type: 'object',
              properties: { matchedChannelId: { type: ['string', 'null'] } },
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
    return typeof result.matchedChannelId === 'string'
      ? channels.find((channel) => channel.id === result.matchedChannelId)
      : undefined;
  }
}
