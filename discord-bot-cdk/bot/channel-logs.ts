import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscordChannel, DiscordRequest } from './channel-manager';

export const CHANNEL_LOG_COMMAND = {
  name: 'set-channel-log',
  description: 'チャンネル管理ログの送信先を設定します',
  type: 1,
  default_member_permissions: '32',
  options: [{
    name: 'channel',
    description: 'ログを送信するテキストチャンネル',
    type: 7,
    channel_types: [0],
    required: true,
  }],
};

export class ChannelLogs {
  private readonly destinations = new Map<string, string>();
  private readonly parents = new Map<string, Map<string, string | null>>();

  public constructor(
    private readonly request: DiscordRequest,
    private readonly defaultDestination?: { guildId: string; channelId: string },
    private readonly settingsDirectory?: string,
  ) {}

  public setDestination(guildId: string, channelId: string): void {
    if (this.settingsDirectory) {
      mkdirSync(this.settingsDirectory, { recursive: true });
      const path = join(this.settingsDirectory, guildId);
      writeFileSync(`${path}.${process.pid}.tmp`, channelId);
      renameSync(`${path}.${process.pid}.tmp`, path);
    }
    this.destinations.set(guildId, channelId);
  }

  public seedGuild(guildId: string, channels: DiscordChannel[]): void {
    this.parents.set(guildId, new Map(channels.map((channel) => [channel.id, channel.parent_id ?? null])));
    if (this.settingsDirectory) {
      try {
        const destination = readFileSync(join(this.settingsDirectory, guildId), 'utf8').trim();
        if (/^\d+$/u.test(destination)) this.destinations.set(guildId, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  public async handleChannelEvent(event: string, channel: DiscordChannel): Promise<void> {
    const guildId = channel.guild_id;
    if (!guildId) return;

    const parents = this.parents.get(guildId) ?? new Map<string, string | null>();
    this.parents.set(guildId, parents);
    if (event === 'CHANNEL_DELETE') {
      parents.delete(channel.id);
      if (this.destinations.get(guildId) === channel.id) {
        this.destinations.delete(guildId);
        if (this.settingsDirectory) rmSync(join(this.settingsDirectory, guildId), { force: true });
      }
      return;
    }

    const previousParent = parents.get(channel.id);
    const parent = channel.parent_id ?? null;
    parents.set(channel.id, parent);

    const destination = this.destinations.get(guildId)
      ?? (this.defaultDestination?.guildId === guildId ? this.defaultDestination.channelId : undefined);
    if (!destination) return;

    const category = (id: string | null): string => id ? `<#${id}>` : 'カテゴリなし';
    let content: string;
    if (event === 'CHANNEL_CREATE') {
      content = `チャンネルを作成しました: <#${channel.id}>（${category(parent)}）`;
    } else if (previousParent !== undefined && previousParent !== parent) {
      content = `チャンネルを移動しました: <#${channel.id}>（${category(previousParent)} → ${category(parent)}）`;
    } else {
      return;
    }

    await this.request(`/channels/${destination}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
  }
}
