import { createIdentifyPayload, getDiscordToken } from '../bot/gateway';

describe('Discord Gateway configuration', () => {
  test('reads and trims the Discord bot token', () => {
    expect(getDiscordToken({ DISCORD_BOT_TOKEN: ' token-value ' })).toBe('token-value');
  });

  test('rejects a missing Discord bot token', () => {
    expect(() => getDiscordToken({})).toThrow('DISCORD_BOT_TOKEN is not set');
  });

  test('identifies the bot with an online presence and no privileged intents', () => {
    const payload = createIdentifyPayload('token-value');

    expect(payload).toMatchObject({
      op: 2,
      d: {
        token: 'token-value',
        intents: 0,
        presence: { status: 'online' },
      },
    });
  });
});
