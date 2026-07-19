const API_BASE_URL = 'https://discord.com/api/v10';

export const SETUP_COMMAND_NAME = 'setup';
export const OPEN_CHANNEL_MODAL_ID = 'open-channel-modal';
export const CHANNEL_MODAL_ID = 'channel-modal';
export const CHANNEL_NAME_INPUT_ID = 'channel-name';
export const ACTIVATE_CHANNEL_PREFIX = 'activate-channel:';
export const ARCHIVE_MOCK_CHANNEL_NAMES = [
  'archive-sample-01',
  'archive-sample-02',
  'archive-sample-03',
  'archive-sample-04',
  'archive-sample-05',
] as const;

const EPHEMERAL_FLAG = 1 << 6;
const SEND_MESSAGES_PERMISSION = '2048';

export interface DiscordChannel {
  id: string;
  guild_id?: string;
  name: string;
  type: number;
  parent_id?: string | null;
  permission_overwrites?: PermissionOverwrite[];
}

interface PermissionOverwrite {
  id: string;
  type: number;
  allow?: string;
  deny?: string;
}

interface InteractionOption {
  custom_id?: string;
  value?: string;
  components?: InteractionOption[];
}

export interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  application_id?: string;
  data?: {
    custom_id?: string;
    name?: string;
    components?: InteractionOption[];
  };
}

export type DiscordRequest = (
  path: string,
  init?: RequestInit,
) => Promise<unknown>;

export function normalizeChannelName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, '-');
}

/** Builds the exact, case-insensitive expression used for category lookups. */
export function buildChannelNamePattern(value: string): RegExp {
  const escaped = normalizeChannelName(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'iu');
}

export function findChannelByName(
  channels: DiscordChannel[],
  categoryId: string,
  name: string,
): DiscordChannel | undefined {
  const pattern = buildChannelNamePattern(name);
  return channels.find(
    (channel) => channel.type === 0 && channel.parent_id === categoryId && pattern.test(channel.name),
  );
}

export function createDiscordRequest(token: string): DiscordRequest {
  return async (path, init = {}) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Discord API ${init.method ?? 'GET'} ${path} failed (${response.status})`);
    }
    if (response.status === 204) return undefined;
    return response.json();
  };
}

function messageHasOpenButton(message: unknown): boolean {
  const components = (message as { components?: InteractionOption[] }).components ?? [];
  return components.some((row) =>
    row.components?.some((component) => component.custom_id === OPEN_CHANNEL_MODAL_ID),
  );
}

function getInputValue(components: InteractionOption[] = []): string | undefined {
  for (const component of components) {
    if (component.custom_id === CHANNEL_NAME_INPUT_ID) return component.value;
    const nested = getInputValue(component.components);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function denySending(overwrites: PermissionOverwrite[] = [], guildId: string): PermissionOverwrite[] {
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0);
  if (!everyone) {
    return [...overwrites, { id: guildId, type: 0, deny: SEND_MESSAGES_PERMISSION }];
  }
  return overwrites.map((overwrite) => overwrite === everyone ? {
    ...overwrite,
    deny: (BigInt(overwrite.deny ?? '0') | BigInt(SEND_MESSAGES_PERMISSION)).toString(),
  } : overwrite);
}

export class ChannelManager {
  public constructor(private readonly request: DiscordRequest) {}

  public async setupGuild(guildId: string, setupChannelId: string): Promise<void> {
    const channels = (await this.request(`/guilds/${guildId}/channels`)) as DiscordChannel[];
    const archive = channels.find((channel) => channel.type === 4 && channel.name === 'アーカイブ');
    if (!archive) throw new Error('「アーカイブ」カテゴリが見つかりません。');

    for (const channel of channels.filter(
      (candidate) => candidate.type === 0 && candidate.parent_id === archive.id,
    )) {
      const permissionOverwrites = denySending(channel.permission_overwrites, guildId);
      if (JSON.stringify(permissionOverwrites) !== JSON.stringify(channel.permission_overwrites ?? [])) {
        await this.request(`/channels/${channel.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ permission_overwrites: permissionOverwrites }),
        });
      }
    }

    for (const name of ARCHIVE_MOCK_CHANNEL_NAMES) {
      if (!findChannelByName(channels, archive.id, name)) {
        const created = (await this.request(`/guilds/${guildId}/channels`, {
          method: 'POST',
          body: JSON.stringify({
            name,
            type: 0,
            parent_id: archive.id,
            permission_overwrites: denySending([], guildId),
          }),
        })) as DiscordChannel;
        channels.push(created);
      }
    }

    const messages = (await this.request(`/channels/${setupChannelId}/messages?limit=100`)) as unknown[];
    if (!messages.some(messageHasOpenButton)) {
      await this.request(`/channels/${setupChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: 'ゲーム用チャンネルを作成、またはアーカイブから復元できます。',
          components: [{
            type: 1,
            components: [{ type: 2, style: 1, label: 'チャンネルを開く', custom_id: OPEN_CHANNEL_MODAL_ID }],
          }],
        }),
      });
    }
  }

  /** /setup スラッシュコマンドをギルドに登録する */
  public async registerSetupCommand(applicationId: string, guildId: string): Promise<void> {
    await this.request(`/applications/${applicationId}/guilds/${guildId}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        name: SETUP_COMMAND_NAME,
        description: '常設ボタンをこのチャンネルに送信します',
        type: 1,
      }),
    });
  }

  public async handleInteraction(interaction: DiscordInteraction): Promise<boolean> {
    // スラッシュコマンド (type 2: APPLICATION_COMMAND)
    if (interaction.type === 2 && interaction.data?.name === SETUP_COMMAND_NAME) {
      await this.handleSetupCommand(interaction);
      return true;
    }

    const customId = interaction.data?.custom_id;
    if (interaction.type === 3 && customId === OPEN_CHANNEL_MODAL_ID) {
      await this.respond(interaction, 9, {
        custom_id: CHANNEL_MODAL_ID,
        title: 'ゲームチャンネル',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: CHANNEL_NAME_INPUT_ID,
            label: 'チャンネル名',
            style: 1,
            min_length: 1,
            max_length: 100,
            required: true,
            placeholder: '遊びたいゲーム名を入力',
          }],
        }],
      });
      return true;
    }

    if (interaction.type === 5 && customId === CHANNEL_MODAL_ID) {
      await this.handleModal(interaction);
      return true;
    }

    if (interaction.type === 3 && customId?.startsWith(ACTIVATE_CHANNEL_PREFIX)) {
      await this.activateArchivedChannel(interaction, customId.slice(ACTIVATE_CHANNEL_PREFIX.length));
      return true;
    }
    return false;
  }

  /** /setup コマンドのハンドラ */
  private async handleSetupCommand(interaction: DiscordInteraction): Promise<void> {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    if (!guildId || !channelId) {
      await this.ephemeral(interaction, 'サーバー内で実行してください。');
      return;
    }

    // 3秒のタイムアウトを避けるため、先に即時応答を返す
    await this.ephemeral(interaction, '常設ボタンの送信と初期セットアップを開始します...');

    // バックグラウンドで時間のかかるセットアップ処理を実行
    this.setupGuild(guildId, channelId).catch((error: unknown) => {
      console.error('セットアップ中にエラーが発生しました:', error instanceof Error ? error.message : error);
    });
  }

  private async handleModal(interaction: DiscordInteraction): Promise<void> {
    const guildId = interaction.guild_id;
    const input = getInputValue(interaction.data?.components);
    const name = input ? normalizeChannelName(input) : '';
    if (!guildId || !name) {
      await this.ephemeral(interaction, 'チャンネル名を入力してください。');
      return;
    }

    const channels = (await this.request(`/guilds/${guildId}/channels`)) as DiscordChannel[];
    const game = channels.find((channel) => channel.type === 4 && channel.name === 'ゲーム');
    const archive = channels.find((channel) => channel.type === 4 && channel.name === 'アーカイブ');
    if (!game || !archive) {
      await this.ephemeral(interaction, '「ゲーム」または「アーカイブ」カテゴリが見つかりません。');
      return;
    }

    const activeChannel = findChannelByName(channels, game.id, name);
    if (activeChannel) {
      await this.ephemeral(interaction, `同名のチャンネルが既にあります: <#${activeChannel.id}>`);
      return;
    }

    const archivedChannel = findChannelByName(channels, archive.id, name);
    if (archivedChannel) {
      await this.ephemeral(interaction, `アーカイブに同名のチャンネルがあります: <#${archivedChannel.id}>\nゲームカテゴリへ移動しますか？`, [{
        type: 1,
        components: [{
          type: 2,
          style: 3,
          label: 'アクティブに戻す',
          custom_id: `${ACTIVATE_CHANNEL_PREFIX}${archivedChannel.id}`,
        }],
      }]);
      return;
    }

    const created = (await this.request(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, type: 0, parent_id: game.id }),
    })) as DiscordChannel;
    await this.ephemeral(interaction, `チャンネルを作成しました: <#${created.id}>`);
  }

  private async activateArchivedChannel(
    interaction: DiscordInteraction,
    channelId: string,
  ): Promise<void> {
    const guildId = interaction.guild_id;
    if (!guildId) {
      await this.ephemeral(interaction, 'サーバー内で操作してください。');
      return;
    }
    const channels = (await this.request(`/guilds/${guildId}/channels`)) as DiscordChannel[];
    const game = channels.find((channel) => channel.type === 4 && channel.name === 'ゲーム');
    const archive = channels.find((channel) => channel.type === 4 && channel.name === 'アーカイブ');
    const target = channels.find((channel) => channel.id === channelId);
    if (!game || !archive || !target || target.parent_id !== archive.id) {
      await this.ephemeral(interaction, '対象のアーカイブチャンネルが見つかりません。');
      return;
    }
    await this.request(`/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        parent_id: game.id,
        permission_overwrites: game.permission_overwrites ?? [],
      }),
    });
    await this.ephemeral(interaction, `チャンネルをアクティブに戻しました: <#${channelId}>`);
  }

  private async ephemeral(
    interaction: DiscordInteraction,
    content: string,
    components: unknown[] = [],
  ): Promise<void> {
    await this.respond(interaction, 4, { content, components, flags: EPHEMERAL_FLAG });
  }

  private async respond(interaction: DiscordInteraction, type: number, data: unknown): Promise<void> {
    await this.request(`/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: 'POST',
      body: JSON.stringify({ type, data }),
    });
  }
}
