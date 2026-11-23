import {
  ARCHIVE_MOCK_CHANNEL_NAMES,
  ChannelManager,
  CANCEL_CHANNEL_PREFIX,
  CREATE_CHANNEL_PREFIX,
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
    application_id: 'app-id',
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
    const matcher = { findSimilarChannel: jest.fn() };
    await new ChannelManager(request, matcher).handleInteraction(modalInteraction('Minecraft'));
    expect(matcher.findSimilarChannel).not.toHaveBeenCalled();

    expect(bodyOf(calls[0])).toEqual({ type: 5, data: { flags: 64 } });
    expect(calls[1].path).toBe('/guilds/guild/channels');
    expect(calls[2]).toMatchObject({
      path: '/webhooks/app-id/interaction-token/messages/@original',
      init: { method: 'PATCH' },
    });
    expect(bodyOf(calls[2])).toMatchObject({ content: expect.stringContaining('<#active>') });
  });

  test('asks before activating an archived channel', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ]);
    const matcher = { findSimilarChannel: jest.fn() };
    await new ChannelManager(request, matcher).handleInteraction(modalInteraction('Splatoon'));
    expect(matcher.findSimilarChannel).not.toHaveBeenCalled();

    expect(bodyOf(calls[2])).toMatchObject({
      content: expect.stringContaining('<#archived>'),
      components: [{ components: [
        { label: '新規作成' },
        { label: '既存チャンネルを使用' },
        { label: 'キャンセル' },
      ] }],
    });
  });

  test('uses an LLM spelling-variation match and provides an ephemeral channel link', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'archived', name: 'apex-legends', type: 0, parent_id: 'archive-category' },
    ]);
    const matcher = {
      findSimilarChannel: jest.fn().mockResolvedValue({
        id: 'archived', name: 'apex-legends', type: 0, parent_id: 'archive-category',
      }),
    };

    await new ChannelManager(request, matcher).handleInteraction(modalInteraction('エペ'));

    expect(matcher.findSimilarChannel).toHaveBeenCalledWith('エペ', [
      expect.objectContaining({ id: 'archived' }),
    ]);
    expect(bodyOf(calls[2])).toMatchObject({ content: expect.stringContaining('<#archived>') });
  });

  test('creates the requested new channel after choosing new creation', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'archived', name: 'league-of-legends', type: 0, parent_id: 'archive-category' },
    ];
    const { request, calls } = createRequest(channels);
    const manager = new ChannelManager(request, {
      findSimilarChannel: jest.fn().mockResolvedValue(channels[2]),
    });
    await manager.handleInteraction(modalInteraction('LOL'));
    const response = bodyOf(calls[2]) as { components: Array<{ components: Array<{ custom_id: string }> }> };
    const customId = response.components[0].components[0].custom_id;

    await manager.handleInteraction({
      id: 'choice', token: 'choice-token', type: 3, guild_id: 'guild', application_id: 'app-id',
      data: { custom_id: customId },
    });

    expect(customId).toMatch(new RegExp(`^${CREATE_CHANNEL_PREFIX}`));
    const creation = calls.find((call, index) => index > 1 && call.path === '/guilds/guild/channels' && call.init);
    expect(bodyOf(creation!)).toEqual({ name: 'lol', type: 0, parent_id: 'game-category' });
  });

  test('cancels an archive choice without changing a channel', async () => {
    const channels: DiscordChannel[] = [
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ];
    const { request, calls } = createRequest(channels);
    const manager = new ChannelManager(request);
    await manager.handleInteraction(modalInteraction('splatoon'));
    const response = bodyOf(calls[2]) as { components: Array<{ components: Array<{ custom_id: string }> }> };

    await manager.handleInteraction({
      id: 'choice', token: 'choice-token', type: 3, guild_id: 'guild', application_id: 'app-id',
      data: { custom_id: response.components[0].components[2].custom_id },
    });

    expect(calls.some((call) => call.path === '/channels/archived')).toBe(false);
    expect(bodyOf(calls.at(-1)!)).toMatchObject({ type: 7, data: { content: 'キャンセルしました。', components: [] } });
  });

  test('creates a new channel in the game category', async () => {
    const { request, calls } = createRequest(categories);
    await new ChannelManager(request).handleInteraction(modalInteraction('New Game'));

    expect(calls[2].path).toBe('/guilds/guild/channels');
    expect(bodyOf(calls[2])).toEqual({ name: 'new-game', type: 0, parent_id: 'game-category' });
    expect(bodyOf(calls[3])).toMatchObject({ content: expect.stringContaining('<#created-channel>') });
  });

  test('moves the archive channel selected by the existing-channel button', async () => {
    const { request, calls } = createRequest([
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ]);
    const manager = new ChannelManager(request);
    await manager.handleInteraction(modalInteraction('splatoon'));
    const response = bodyOf(calls[2]) as { components: Array<{ components: Array<{ custom_id: string }> }> };
    await manager.handleInteraction({
      id: 'choice', token: 'choice-token', type: 3, guild_id: 'guild', application_id: 'app-id',
      data: { custom_id: response.components[0].components[1].custom_id },
    });

    expect(calls[5].path).toBe('/channels/archived');
    expect(bodyOf(calls[5])).toEqual({
      parent_id: 'game-category',
      permission_overwrites: [{ id: 'guild', type: 0, allow: '1' }],
    });
  });

  test('creates a new channel when the matcher rejects', async () => {
    const { request, calls } = createRequest(categories);
    const matcher = { findSimilarChannel: jest.fn().mockRejectedValue(new Error('timeout')) };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new ChannelManager(request, matcher).handleInteraction(modalInteraction('New Game'));
      expect(matcher.findSimilarChannel).toHaveBeenCalled();
      expect(bodyOf(calls[2])).toEqual({ name: 'new-game', type: 0, parent_id: 'game-category' });
      expect(bodyOf(calls[3])).toMatchObject({ content: expect.stringContaining('<#created-channel>') });
    } finally {
      log.mockRestore();
    }
  });

  test('rejects choices from other guilds and expires unused choices after 15 minutes', async () => {
    jest.useFakeTimers();
    try {
      const { request, calls } = createRequest([
        ...categories,
        { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
      ]);
      const manager = new ChannelManager(request);
      await manager.handleInteraction(modalInteraction('splatoon'));
      const choice = {
        id: 'choice', token: 'choice-token', type: 3, guild_id: 'guild',
        data: { custom_id: `${CANCEL_CHANNEL_PREFIX}interaction` },
      };
      await manager.handleInteraction({ ...choice, guild_id: 'other' });
      expect(bodyOf(calls.at(-1)!)).toMatchObject({
        type: 7, data: { content: expect.stringContaining('期限切れ'), components: [] },
      });
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(15 * 60 * 1000);
      await manager.handleInteraction(choice);
      expect(bodyOf(calls.at(-1)!)).toMatchObject({
        type: 7, data: { content: expect.stringContaining('期限切れ'), components: [] },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('rechecks for a same-name game channel before creating from a choice', async () => {
    const channels = [
      ...categories,
      { id: 'archived', name: 'splatoon', type: 0, parent_id: 'archive-category' },
    ];
    const { request, calls } = createRequest(channels);
    const manager = new ChannelManager(request);
    await manager.handleInteraction(modalInteraction('splatoon'));
    channels.push({ id: 'active', name: 'splatoon', type: 0, parent_id: 'game-category' });

    await manager.handleInteraction({
      id: 'choice', token: 'choice-token', type: 3, guild_id: 'guild', application_id: 'app-id',
      data: { custom_id: `${CREATE_CHANNEL_PREFIX}interaction` },
    });

    expect(bodyOf(calls[3])).toEqual({ type: 6 });
    expect(calls.some((call) => call.path === '/guilds/guild/channels' && call.init?.method === 'POST')).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      path: '/webhooks/app-id/choice-token/messages/@original', init: { method: 'PATCH' },
    });
    expect(bodyOf(calls.at(-1)!)).toMatchObject({ content: expect.stringContaining('<#active>'), components: [] });
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
  test('registers the /setup slash command', async () => {
    const { request, calls } = createRequest([]);
    await new ChannelManager(request).registerSetupCommand('app-id', 'guild');

    expect(calls[0].path).toBe('/applications/app-id/guilds/guild/commands');
    expect(bodyOf(calls[0])).toMatchObject({ name: 'setup', type: 1 });
  });

  test('/setup command posts the permanent button to the invoked channel', async () => {
    const channels: DiscordChannel[] = [...categories];
    const calls: Array<{ path: string; init?: RequestInit }> = [];
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

    const handled = await new ChannelManager(request).handleInteraction({
      id: 'interaction',
      token: 'token',
      type: 2,
      guild_id: 'guild',
      channel_id: 'target-channel',
      data: { name: 'setup' },
    });

    expect(handled).toBe(true);
    
    // バックグラウンド処理(setupGuild)の完了を待つ
    await new Promise((resolve) => setTimeout(resolve, 50));

    // setupGuild がボタンメッセージを送信
    expect(calls.some((c) => c.path === '/channels/target-channel/messages' && c.init?.method === 'POST')).toBe(true);
    // エフェメラル応答
    const callback = calls.find((c) => c.path.includes('/callback'));
    expect(callback).toBeDefined();
    expect(bodyOf(callback!)).toMatchObject({ type: 4, data: { flags: 64 } });
  });
});
