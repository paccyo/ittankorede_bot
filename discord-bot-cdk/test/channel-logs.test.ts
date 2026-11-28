import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNEL_LOG_COMMAND, ChannelLogs } from '../bot/channel-logs';
import { ChannelManager } from '../bot/channel-manager';

const channel = { id: '42', guild_id: '1', name: 'game', type: 0, parent_id: '10' };

const setLogCommand = {
  id: '100',
  token: 'token',
  type: 2,
  guild_id: '1',
  data: {
    name: CHANNEL_LOG_COMMAND.name,
    options: [{ name: 'channel', value: '30' }],
    resolved: { channels: { '30': { ...channel, id: '30' } } },
  },
};

function postedContents(request: jest.Mock): string[] {
  return request.mock.calls.map(([, init]) => JSON.parse(init.body).content);
}

function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'channel-logs-'));
  return run(directory).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test('logs creation and category moves to the default destination for the configured guild', async () => {
  const request = jest.fn().mockResolvedValue(undefined);
  const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' });
  logs.seedGuild('1', [channel]);

  await logs.handleChannelEvent('CHANNEL_UPDATE', { ...channel, name: 'renamed' });
  await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, guild_id: '2' });
  expect(request).not.toHaveBeenCalled();

  await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43', parent_id: null });
  await logs.handleChannelEvent('CHANNEL_UPDATE', { ...channel, parent_id: '11' });
  expect(request.mock.calls.map(([path, init]) => [path, JSON.parse(init.body).content])).toEqual([
    ['/channels/20/messages', 'チャンネルを作成しました: <#43>（カテゴリなし）'],
    ['/channels/20/messages', 'チャンネルを移動しました: <#42>（<#10> → <#11>）'],
  ]);
});

test('does not log the creation of a category', async () => {
  const request = jest.fn().mockResolvedValue(undefined);
  const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' });

  await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '50', type: 4, parent_id: null });
  expect(request).not.toHaveBeenCalled();
});

test('sets a text channel via the slash command and restores it on restart', () => withTempDirectory(async (directory) => {
  const request = jest.fn().mockResolvedValue(undefined);
  const fallback = { guildId: '1', channelId: '20' };
  const logs = new ChannelLogs(request, fallback, directory);
  const manager = new ChannelManager(request, undefined, logs);

  expect(await manager.handleInteraction(setLogCommand)).toBe(true);
  expect(request.mock.calls[0][0]).toBe('/channels/30/messages');
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    type: 4, data: { flags: 64, content: expect.stringContaining('<#30>') },
  });

  const restarted = new ChannelLogs(request, fallback, directory);
  restarted.seedGuild('1', [channel]);
  await restarted.handleChannelEvent('CHANNEL_UPDATE', { ...channel, parent_id: null });
  expect(request).toHaveBeenLastCalledWith('/channels/30/messages', expect.anything());
}));

test('does not save the destination when the bot cannot post there', () => withTempDirectory(async (directory) => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const request = jest.fn()
      .mockRejectedValueOnce(new Error('Discord API POST /channels/30/messages failed (403)'))
      .mockResolvedValue(undefined);
    const logs = new ChannelLogs(request, undefined, directory);
    const manager = new ChannelManager(request, undefined, logs);

    expect(await manager.handleInteraction(setLogCommand)).toBe(true);
    expect(JSON.parse(request.mock.calls[1][1].body).data.content).toContain('投稿できませんでした');
    expect(existsSync(join(directory, '1'))).toBe(false);

    await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43' });
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
}));

test('falls back to the default destination when the log channel is deleted', () => withTempDirectory(async (directory) => {
  const request = jest.fn().mockResolvedValue(undefined);
  const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' }, directory);
  logs.setDestination('1', '30');

  await logs.handleChannelEvent('CHANNEL_DELETE', { ...channel, id: '30' });
  expect(existsSync(join(directory, '1'))).toBe(false);

  await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43' });
  expect(request).toHaveBeenCalledWith('/channels/20/messages', expect.anything());
}));

describe('when Discord rejects a log', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('retries after a 429 and keeps the order of the logs', async () => {
    const request = jest.fn()
      .mockRejectedValueOnce(new Error('Discord API POST /channels/20/messages failed (429)'))
      .mockResolvedValue(undefined);
    const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' });

    const first = logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43' });
    const second = logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '44' });
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.all([first, second]);

    expect(postedContents(request)).toEqual([
      'チャンネルを作成しました: <#43>（<#10>）',
      'チャンネルを作成しました: <#43>（<#10>）',
      'チャンネルを作成しました: <#44>（<#10>）',
    ]);
  });

  test('gives up after three 429s without blocking later logs', async () => {
    const rateLimited = new Error('Discord API POST /channels/20/messages failed (429)');
    const request = jest.fn()
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValue(undefined);
    const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' });

    const first = logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43' });
    const firstResult = expect(first).rejects.toThrow('(429)');
    const second = logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '44' });
    await jest.advanceTimersByTimeAsync(10000);
    await firstResult;
    await second;

    expect(request).toHaveBeenCalledTimes(4);
    expect(postedContents(request)[3]).toBe('チャンネルを作成しました: <#44>（<#10>）');
  });

  test('does not retry other errors', async () => {
    const request = jest.fn()
      .mockRejectedValueOnce(new Error('Discord API POST /channels/20/messages failed (403)'))
      .mockResolvedValue(undefined);
    const logs = new ChannelLogs(request, { guildId: '1', channelId: '20' });

    await expect(logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '43' })).rejects.toThrow('(403)');
    await logs.handleChannelEvent('CHANNEL_CREATE', { ...channel, id: '44' });

    expect(postedContents(request)).toEqual([
      'チャンネルを作成しました: <#43>（<#10>）',
      'チャンネルを作成しました: <#44>（<#10>）',
    ]);
  });
});
