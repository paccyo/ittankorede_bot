import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectToDiscord, getDiscordToken } from './gateway';
import { ChannelManager, createDiscordRequest } from './channel-manager';
import { GeminiChannelNameMatcher } from './channel-name-matcher';
import { ChannelArchiver, msUntilNextMidnightJst } from './channel-archiver';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** 起動時と毎日 0 時 (日本時間) に、非アクティブなチャンネルをアーカイブする */
function scheduleArchive(request: ReturnType<typeof createDiscordRequest>): void {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId) return;
  const setupChannelId = process.env.DISCORD_SETUP_CHANNEL_ID?.trim();
  const archiver = new ChannelArchiver(request, setupChannelId ? [setupChannelId] : []);
  const run = (): void => {
    archiver.archiveInactiveChannels(guildId).then((archived) => {
      if (archived.length > 0) console.log(`非アクティブなチャンネルをアーカイブしました: ${archived.map((channel) => `#${channel.name}`).join(', ')}`);
    }).catch((error: unknown) => {
      console.error('自動アーカイブに失敗しました:', error instanceof Error ? error.message : error);
    });
  };
  const scheduleNext = (): void => {
    setTimeout(() => {
      run();
      scheduleNext();
    }, msUntilNextMidnightJst(Date.now())).unref();
  };
  // 0 時に Bot が止まっていた日の分を取りこぼさないよう、起動時にも実行する
  run();
  scheduleNext();
}

try {
  const token = getDiscordToken();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const matcher = geminiApiKey
    ? new GeminiChannelNameMatcher(geminiApiKey, process.env.GEMINI_MODEL?.trim() || undefined)
    : undefined;
  const socket = connectToDiscord(token, new ChannelManager(createDiscordRequest(token), matcher));
  process.once('SIGINT', () => socket.close(1000, 'Process stopped'));
  process.once('SIGTERM', () => socket.close(1000, 'Process stopped'));
  scheduleArchive(createDiscordRequest(token));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
