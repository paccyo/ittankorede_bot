import { denySending, DiscordChannel, DiscordRequest } from './channel-manager';

export const INACTIVE_DAYS = 10;
const INACTIVE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1420070400000n;

interface DiscordMessage {
  id: string;
  timestamp: string;
}

export interface LatestMessage {
  channel: DiscordChannel;
  /** チャンネルに発言が無いときは null */
  message: DiscordMessage | null;
}

/** Snowflake ID から作成日時 (ミリ秒) を求める */
export function snowflakeToTime(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export class ChannelArchiver {
  public constructor(
    private readonly request: DiscordRequest,
    /** アーカイブしないチャンネル (常設ボタンのチャンネルなど) */
    private readonly excludedChannelIds: string[] = [],
  ) {}

  /**
   * 「ゲーム」カテゴリ内の全テキストチャンネルについて、最新のメッセージを 1 件ずつ取得する。
   * 取得に失敗したチャンネルは結果に含めない。
   */
  public async fetchLatestMessages(guildId: string): Promise<LatestMessage[]> {
    const { channels, game } = await this.loadCategories(guildId);
    return this.fetchLatestMessagesIn(channels, game);
  }

  /** 最後の発言 (発言が無ければチャンネルの作成) から 10 日以上たったチャンネルを「アーカイブ」に移す */
  public async archiveInactiveChannels(guildId: string, now = Date.now()): Promise<DiscordChannel[]> {
    const { channels, game, archive } = await this.loadCategories(guildId);
    const archived: DiscordChannel[] = [];
    for (const { channel, message } of await this.fetchLatestMessagesIn(channels, game)) {
      const lastActivity = message ? Date.parse(message.timestamp) : snowflakeToTime(channel.id);
      if (Number.isNaN(lastActivity) || now - lastActivity < INACTIVE_MS) continue;
      try {
        await this.request(`/channels/${channel.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            parent_id: archive.id,
            permission_overwrites: denySending(channel.permission_overwrites, guildId),
          }),
        });
        archived.push(channel);
      } catch (error) {
        console.error(`#${channel.name} をアーカイブできませんでした:`, error instanceof Error ? error.message : error);
      }
    }
    return archived;
  }

  private async loadCategories(guildId: string): Promise<{
    channels: DiscordChannel[];
    game: DiscordChannel;
    archive: DiscordChannel;
  }> {
    const channels = (await this.request(`/guilds/${guildId}/channels`)) as DiscordChannel[];
    const game = channels.find((channel) => channel.type === 4 && channel.name === 'ゲーム');
    const archive = channels.find((channel) => channel.type === 4 && channel.name === 'アーカイブ');
    if (!game || !archive) throw new Error('「ゲーム」または「アーカイブ」カテゴリが見つかりません。');
    return { channels, game, archive };
  }

  private async fetchLatestMessagesIn(channels: DiscordChannel[], game: DiscordChannel): Promise<LatestMessage[]> {
    const results: LatestMessage[] = [];
    for (const channel of channels.filter((candidate) =>
      candidate.type === 0 && candidate.parent_id === game.id && !this.excludedChannelIds.includes(candidate.id))) {
      try {
        const messages = (await this.request(`/channels/${channel.id}/messages?limit=1`)) as DiscordMessage[];
        results.push({ channel, message: messages[0] ?? null });
      } catch (error) {
        // 読み取れないチャンネルを非アクティブとみなしてアーカイブしないよう、結果から外す
        console.error(`#${channel.name} の最新メッセージを取得できませんでした:`, error instanceof Error ? error.message : error);
      }
    }
    return results;
  }
}
