import { denySending, DiscordChannel, DiscordRequest } from './channel-manager';

export const INACTIVE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const INACTIVE_MS = INACTIVE_DAYS * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1420070400000n;

interface DiscordMessage {
  id: string;
  timestamp: string;
}

interface DiscordThread {
  id: string;
  parent_id?: string | null;
  last_message_id?: string | null;
  thread_metadata?: { archive_timestamp?: string };
}

interface ThreadList {
  threads: DiscordThread[];
  has_more?: boolean;
}

/** 1 チャンネルあたり、アーカイブ済みスレッドを何ページまで確認するか */
const MAX_ARCHIVED_THREAD_PAGES = 10;

export interface LatestMessage {
  channel: DiscordChannel;
  /** チャンネルに発言が無いときは null */
  message: DiscordMessage | null;
}

/** 次の 0 時 (日本時間) までのミリ秒。ちょうど 0 時なら翌日の 0 時までを返す */
export function msUntilNextMidnightJst(now: number): number {
  return DAY_MS - ((now + JST_OFFSET_MS) % DAY_MS);
}

/** Snowflake ID から作成日時 (ミリ秒) を求める */
export function snowflakeToTime(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/** スレッドの最後の発言 (発言が無ければスレッドの作成) の日時 */
function threadActivity(thread: DiscordThread): number {
  return snowflakeToTime(thread.last_message_id ?? thread.id);
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

  /**
   * 最後の発言 (発言が無ければチャンネルの作成) から 10 日以上たったチャンネルを「アーカイブ」に移す。
   * チャンネル内のスレッドでの発言も、そのチャンネルでの発言として数える。
   */
  public async archiveInactiveChannels(guildId: string, now = Date.now()): Promise<DiscordChannel[]> {
    const { channels, game, archive } = await this.loadCategories(guildId);
    const cutoff = now - INACTIVE_MS;
    const archived: DiscordChannel[] = [];
    let activeThreads: DiscordThread[] | undefined;
    for (const { channel, message } of await this.fetchLatestMessagesIn(channels, game)) {
      const lastActivity = message ? Date.parse(message.timestamp) : snowflakeToTime(channel.id);
      if (Number.isNaN(lastActivity) || lastActivity > cutoff) continue;
      // アクティブなスレッドの一覧は、候補が見つかったときに 1 回だけ取得する。
      // 取得できなければ判断できないので、例外のまま実行全体を止める
      activeThreads ??= ((await this.request(`/guilds/${guildId}/threads/active`)) as ThreadList).threads;
      try {
        if (await this.hasRecentThreadActivity(channel, activeThreads, cutoff)) continue;
      } catch (error) {
        // スレッドを確認できないチャンネルは、非アクティブとみなさずに残す
        console.error(`#${channel.name} のスレッドを確認できませんでした:`, error instanceof Error ? error.message : error);
        continue;
      }
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

  /** チャンネル内のスレッドに、cutoff より後の発言があるか */
  private async hasRecentThreadActivity(
    channel: DiscordChannel,
    activeThreads: DiscordThread[],
    cutoff: number,
  ): Promise<boolean> {
    if (activeThreads.some((thread) => thread.parent_id === channel.id && threadActivity(thread) > cutoff)) return true;

    // スレッドは既定で最後の発言から 24 時間で自動アーカイブされるので、アーカイブ済みの公開スレッドも確認する。
    // 一覧はアーカイブされた日時の新しい順で、アーカイブされた日時は最後の発言より後なので、
    // アーカイブされた日時が cutoff 以前になったところで打ち切れる
    let before: string | undefined;
    for (let page = 0; page < MAX_ARCHIVED_THREAD_PAGES; page += 1) {
      const query = before ? `?before=${encodeURIComponent(before)}` : '';
      const { threads, has_more } = (await this.request(
        `/channels/${channel.id}/threads/archived/public${query}`,
      )) as ThreadList;
      if (threads.some((thread) => threadActivity(thread) > cutoff)) return true;
      const last = threads.at(-1)?.thread_metadata?.archive_timestamp;
      if (!has_more || !last || Date.parse(last) <= cutoff) return false;
      before = last;
    }
    // 10 日の間に確認しきれないほどスレッドが使われているので、アクティブとみなす
    return true;
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
