import { GeminiChannelNameMatcher } from '../bot/channel-name-matcher';
import { DiscordChannel } from '../bot/channel-manager';

describe('GeminiChannelNameMatcher', () => {
  const channels: DiscordChannel[] = [
    { id: 'lol', name: 'league-of-legends', type: 0, parent_id: 'archive' },
    { id: 'apex', name: 'apex-legends', type: 0, parent_id: 'archive' },
  ];

  test('returns only a channel id selected by structured output', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ matchedChannelId: 'apex' }) }] } }],
      }),
    });
    const matcher = new GeminiChannelNameMatcher('api-key', 'gemini-2.5-flash', fetcher);

    await expect(matcher.findSimilarChannel('エペ', channels)).resolves.toEqual(channels[1]);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('?');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'api-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
      responseJsonSchema: {
        required: ['matchedChannelId'],
        properties: { matchedChannelId: { enum: ['lol', 'apex', null] } },
      },
    });
  });

  test('does not accept a channel id outside the supplied candidates', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"matchedChannelId":"unknown"}' }] } }],
      }),
    });

    await expect(
      new GeminiChannelNameMatcher('api-key', 'test-model', fetcher).findSimilarChannel('game', channels),
    ).resolves.toBeUndefined();
  });
  test.each([
    [{ ok: false, status: 503 }, 'Gemini API request failed (503)'],
    [{ ok: true, json: async () => ({ candidates: [] }) }, 'Gemini API returned no structured output'],
  ])('rejects unsuccessful or empty responses (%j)', async (response, message) => {
    const fetcher = jest.fn().mockResolvedValue(response);
    const matcher = new GeminiChannelNameMatcher('api-key', 'test-model', fetcher);

    await expect(matcher.findSimilarChannel('game', channels)).rejects.toThrow(message);
  });

});
