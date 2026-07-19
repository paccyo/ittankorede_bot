/**
 * スラッシュコマンドを Discord に登録するスクリプト
 *
 * 使い方: mise run deploy-commands
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createDiscordRequest,
  SETUP_COMMAND_NAME,
} from './channel-manager';
import { getDiscordToken } from './gateway';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API_BASE_URL = 'https://discord.com/api/v10';

/** Bot の Application ID を取得する */
async function getApplicationId(token: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/oauth2/applications/@me`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) throw new Error(`Application ID の取得に失敗しました (${res.status})`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** 登録するコマンド一覧 */
const commands = [
  {
    name: SETUP_COMMAND_NAME,
    description: '常設ボタンをこのチャンネルに送信します',
    type: 1,
  },
];

async function main(): Promise<void> {
  const token = getDiscordToken();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID が設定されていません。.env を確認してください。');
  }

  const applicationId = await getApplicationId(token);
  const request = createDiscordRequest(token);

  // ギルドコマンドを一括上書き登録 (PUT)
  await request(`/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: 'PUT',
    body: JSON.stringify(commands),
  });

  console.log(`✅ ${commands.length} 件のコマンドをギルド ${guildId} に登録しました。`);
  for (const cmd of commands) {
    console.log(`   /${cmd.name} — ${cmd.description}`);
  }
}

main().catch((error: unknown) => {
  console.error('❌ コマンド登録に失敗しました:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
