import {
  ARCHIVE_MOCK_CHANNEL_NAMES,
  ChannelManager,
  DiscordChannel,
  DiscordInteraction,
  DiscordRequest,
  buildChannelNamePattern,
  findChannelByName,
} from '../bot/channel-manager';

const categories: DiscordChannel[] = [
  { id: 'game-category', name: 'ゲーム', type: 4, permission_overwrites: [{ id: 'guild', type: 0, allow: '1' }] },
  { id: 'archive-category', name: 'アーカイブ', type: 4 },
];

function modalInteraction(name: string): DiscordInteraction {
  return {
    id: 'interaction',
    token: 'interaction-token',
    type: 5,
    guild_id: 'guild',
    data: {
      custom_id: 'channel-modal',
      components: [{ components: [{ custom_id: 'channel-name', value: name }] }],
    },
  };
}

function createRequest(channels: DiscordChannel[]) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const implementation: DiscordRequest = async (path, init) => {
    calls.push({ path, init });
    if (path === '/guilds/guild/channels' && !init) return channels;
    if (path === '/guilds/guild/channels' && init?.method === 'POST') {
      return { id: 'created-channel', type: 0, ...JSON.parse(String(init.body)) };
    }
    return undefined;
  };
  const request = jest.fn(implementation) as jest.MockedFunction<DiscordRequest>;
  return { request, calls };
}

function bodyOf(call: { init?: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

describe('channel name lookup', () => {
  test('matches an exact normalized name and escapes regular expression characters', () => {
    expect(buildChannelNamePattern('  My.Game  ').test('my.game')).toBe(true);
    expect(buildChannelNamePattern('My.Game').test('myXgame')).toBe(false);
    expect(buildChannelNamePattern('foo bar').test('foo-bar')).toBe(true);
  });

  test('only finds text channels inside the specified category', () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'active', name: 'minecraft', type: 0, parent_id: 'game-category' },
      { id: 'archived', name: 'minecraft', type: 0, parent_id: 'archive-category' },
    ];
    expect(findChannelByName(channels, 'archive-category', 'Minecraft')?.id).toBe('archived');
  });
});

describe('ChannelManager', () => {
  test('opens a modal from the permanent message button', async () => {
    const { request, calls } = createRequest([]);
    const manager = new ChannelManager(request);

    await manager.handleInteraction({
      id: 'interaction', token: 'token', type: 3, data: { custom_id: 'open-channel-modal' },
    });

    expect(bodyOf(calls[0])).toMatchObject({
      type: 9,
      data: { custom_id: 'channel-modal', components: [{ components: [{ custom_id: 'channel-name' }] }] },
    });
  });

  test('returns an existing game channel as an ephemeral link', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'active', name: 'minecraft', type: 0, parent_id: 'game-category' },
    ]);
    await new ChannelManager(request).handleInteraction(modalInteraction('Minecraft'));

    expect(bodyOf(calls[1])).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining('<#active>'), flags: 64 },
    });
    expect(calls).toHaveLength(2);
  });

  test('asks before activating an archived channel', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ]);
    await new ChannelManager(request).handleInteraction(modalInteraction('Splatoon'));

    expect(bodyOf(calls[1])).toMatchObject({
      data: {
        content: expect.stringContaining('<#archived>'),
        components: [{ components: [{ custom_id: 'activate-channel:archived' }] }],
        flags: 64,
      },
    });
  });

  test('creates a new channel in the game category', async () => {
    const { request, calls } = createRequest(categories);
    await new ChannelManager(request).handleInteraction(modalInteraction('New Game'));

    expect(calls[1].path).toBe('/guilds/guild/channels');
    expect(bodyOf(calls[1])).toEqual({ name: 'new-game', type: 0, parent_id: 'game-category' });
    expect(bodyOf(calls[2])).toMatchObject({ data: { content: expect.stringContaining('<#created-channel>') } });
  });

  test('moves a confirmed archive channel and applies game category permissions', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ]);
    await new ChannelManager(request).handleInteraction({
      id: 'interaction', token: 'token', type: 3, guild_id: 'guild',
      data: { custom_id: 'activate-channel:archived' },
    });

    expect(calls[1].path).toBe('/channels/archived');
    expect(bodyOf(calls[1])).toEqual({
      parent_id: 'game-category',
      permission_overwrites: [{ id: 'guild', type: 0, allow: '1' }],
    });
  });

  test('idempotently creates five read-only archive samples and one setup message', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'existing-archive', name: 'old-game', type: 0, parent_id: 'archive-category' },
    ];
    const request: DiscordRequest = async (path, init) => {
      calls.push({ path, init });
      if (path === '/guilds/guild/channels' && !init) return channels;
      if (path === '/guilds/guild/channels') {
        const body = bodyOf({ init }) as unknown as DiscordChannel;
        return { ...body, id: `created-${body.name}` };
      }
      if (path.includes('/messages?')) return [];
      return {};
    };

    await new ChannelManager(request).setupGuild('guild', 'setup');

    const creations = calls.filter((call) => call.path === '/guilds/guild/channels' && call.init);
    expect(creations.map((call) => bodyOf(call).name)).toEqual(ARCHIVE_MOCK_CHANNEL_NAMES);
    expect(bodyOf(creations[0])).toMatchObject({
      parent_id: 'archive-category',
      permission_overwrites: [{ id: 'guild', type: 0, deny: '2048' }],
    });
    expect(calls.find((call) => call.path === '/channels/existing-archive')).toBeDefined();
    expect(calls.filter((call) => call.path === '/channels/setup/messages' && call.init)).toHaveLength(1);
  });
});
