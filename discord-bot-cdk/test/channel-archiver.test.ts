import { ChannelArchiver, snowflakeToTime } from '../bot/channel-archiver';
import { DiscordChannel, DiscordRequest } from '../bot/channel-manager';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-29T00:00:00Z');

/** 指定した時刻に作られたことになる Snowflake ID */
function snowflakeAt(time: number): string {
  return ((BigInt(time) - 1420070400000n) << 22n).toString();
}

const categories: DiscordChannel[] = [
  { id: 'game-category', name: 'ゲーム', type: 4 },
  { id: 'archive-category', name: 'アーカイブ', type: 4 },
];

const oldChannelId = snowflakeAt(NOW - 30 * DAY);
const newChannelId = snowflakeAt(NOW - 3 * DAY);

function createRequest(
  channels: DiscordChannel[],
  latest: Record<string, { timestamp: string } | null | Error>,
) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = jest.fn<ReturnType<DiscordRequest>, Parameters<DiscordRequest>>(async (path, init) => {
    calls.push({ path, init });
    if (path === '/guilds/guild/channels') return channels;
    const match = /^\/channels\/([^/]+)\/messages\?limit=1$/u.exec(path);
    if (match) {
      const message = latest[match[1]];
      if (message instanceof Error) throw message;
      return message ? [{ id: 'message', ...message }] : [];
    }
    return undefined;
  });
  const patched = () => calls
    .filter((call) => call.init?.method === 'PATCH')
    .map((call) => ({ path: call.path, body: JSON.parse(String(call.init?.body)) }));
  return { request, calls, patched };
}

function daysAgo(days: number): { timestamp: string } {
  return { timestamp: new Date(NOW - days * DAY).toISOString() };
}

test('converts a snowflake ID to its creation time', () => {
  expect(snowflakeToTime(snowflakeAt(NOW))).toBe(NOW);
  expect(snowflakeToTime('175928847299117063')).toBe(Date.parse('2016-04-30T11:18:25.796Z'));
});

describe('fetchLatestMessages', () => {
  test('fetches the latest message of every text channel in the game category', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'talk', name: 'talk', type: 0, parent_id: 'game-category' },
      { id: 'empty', name: 'empty', type: 0, parent_id: 'game-category' },
      { id: 'voice', name: 'voice', type: 2, parent_id: 'game-category' },
      { id: 'archived', name: 'archived', type: 0, parent_id: 'archive-category' },
      { id: 'general', name: 'general', type: 0, parent_id: null },
    ];
    const { request, calls } = createRequest(channels, { talk: daysAgo(1), empty: null });

    const results = await new ChannelArchiver(request).fetchLatestMessages('guild');

    expect(calls.map((call) => call.path)).toEqual([
      '/guilds/guild/channels',
      '/channels/talk/messages?limit=1',
      '/channels/empty/messages?limit=1',
    ]);
    expect(results.map(({ channel, message }) => [channel.id, message?.timestamp ?? null])).toEqual([
      ['talk', daysAgo(1).timestamp],
      ['empty', null],
    ]);
  });

  test('fails when the game or archive category is missing', async () => {
    const { request } = createRequest([categories[0]], {});
    await expect(new ChannelArchiver(request).fetchLatestMessages('guild')).rejects.toThrow('カテゴリが見つかりません');
  });
});

describe('archiveInactiveChannels', () => {
  test('archives channels whose latest message is at least 10 days old and keeps the others', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'active', name: 'active', type: 0, parent_id: 'game-category' },
      { id: 'almost', name: 'almost', type: 0, parent_id: 'game-category' },
      { id: 'boundary', name: 'boundary', type: 0, parent_id: 'game-category' },
      {
        id: 'stale',
        name: 'stale',
        type: 0,
        parent_id: 'game-category',
        permission_overwrites: [{ id: 'guild', type: 0, allow: '1024' }, { id: 'role', type: 0, allow: '2048' }],
      },
    ];
    const { request, patched } = createRequest(channels, {
      active: daysAgo(1),
      almost: { timestamp: new Date(NOW - 10 * DAY + 1).toISOString() },
      boundary: daysAgo(10),
      stale: daysAgo(11),
    });

    const archived = await new ChannelArchiver(request).archiveInactiveChannels('guild', NOW);

    expect(archived.map((channel) => channel.id)).toEqual(['boundary', 'stale']);
    expect(patched()).toEqual([
      {
        path: '/channels/boundary',
        body: { parent_id: 'archive-category', permission_overwrites: [{ id: 'guild', type: 0, deny: '2048' }] },
      },
      {
        path: '/channels/stale',
        body: {
          parent_id: 'archive-category',
          permission_overwrites: [{ id: 'guild', type: 0, allow: '1024', deny: '2048' }, { id: 'role', type: 0, allow: '2048' }],
        },
      },
    ]);
  });

  test('uses the creation time of a channel that has no messages', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: oldChannelId, name: 'old-empty', type: 0, parent_id: 'game-category' },
      { id: newChannelId, name: 'new-empty', type: 0, parent_id: 'game-category' },
    ];
    const { request, patched } = createRequest(channels, { [oldChannelId]: null, [newChannelId]: null });

    await new ChannelArchiver(request).archiveInactiveChannels('guild', NOW);

    expect(patched().map((call) => call.path)).toEqual([`/channels/${oldChannelId}`]);
  });

  test('never archives a channel whose messages could not be read, and continues with the others', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const channels: DiscordChannel[] = [
        ...categories,
        { id: oldChannelId, name: 'unreadable', type: 0, parent_id: 'game-category' },
        { id: 'stale', name: 'stale', type: 0, parent_id: 'game-category' },
      ];
      const { request, patched } = createRequest(channels, {
        [oldChannelId]: new Error(`Discord API GET /channels/${oldChannelId}/messages?limit=1 failed (403)`),
        stale: daysAgo(20),
      });

      await new ChannelArchiver(request).archiveInactiveChannels('guild', NOW);

      expect(patched().map((call) => call.path)).toEqual(['/channels/stale']);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('#unreadable'), expect.stringContaining('(403)'));
    } finally {
      error.mockRestore();
    }
  });

  test('continues with the other channels when one cannot be moved', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const channels: DiscordChannel[] = [
        ...categories,
        { id: 'locked', name: 'locked', type: 0, parent_id: 'game-category' },
        { id: 'stale', name: 'stale', type: 0, parent_id: 'game-category' },
      ];
      const { request, calls } = createRequest(channels, { locked: daysAgo(20), stale: daysAgo(20) });
      const implementation = request.getMockImplementation()!;
      request.mockImplementation(async (path, init) => {
        if (path === '/channels/locked' && init?.method === 'PATCH') {
          calls.push({ path, init });
          throw new Error('Discord API PATCH /channels/locked failed (403)');
        }
        return implementation(path, init);
      });

      const archived = await new ChannelArchiver(request).archiveInactiveChannels('guild', NOW);

      expect(archived.map((channel) => channel.id)).toEqual(['stale']);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('#locked'), expect.stringContaining('(403)'));
    } finally {
      error.mockRestore();
    }
  });

  test('does not archive excluded channels such as the setup channel', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'setup', name: 'setup', type: 0, parent_id: 'game-category' },
    ];
    const { request, calls } = createRequest(channels, { setup: daysAgo(30) });

    await new ChannelArchiver(request, ['setup']).archiveInactiveChannels('guild', NOW);

    expect(calls.map((call) => call.path)).toEqual(['/guilds/guild/channels']);
  });
});
