import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNEL_LOG_COMMAND, ChannelLogs } from '../bot/channel-logs';
import { ChannelManager } from '../bot/channel-manager';

const channel = { id: '42', guild_id: '1', name: 'game', type: 0, parent_id: '10' };

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

test('sets a text channel via the slash command and restores it on restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'channel-logs-'));
  try {
    const request = jest.fn().mockResolvedValue(undefined);
    const fallback = { guildId: '1', channelId: '20' };
    const logs = new ChannelLogs(request, fallback, directory);
    const manager = new ChannelManager(request, undefined, logs);
    const interaction = {
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

    expect(await manager.handleInteraction(interaction)).toBe(true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      type: 4, data: { flags: 64, content: expect.stringContaining('<#30>') },
    });

    const restarted = new ChannelLogs(request, fallback, directory);
    restarted.seedGuild('1', [channel]);
    await restarted.handleChannelEvent('CHANNEL_UPDATE', { ...channel, parent_id: null });
    expect(request).toHaveBeenLastCalledWith('/channels/30/messages', expect.anything());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
