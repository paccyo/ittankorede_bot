import { ChannelLogs } from './channel-logs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectToDiscord, getDiscordToken } from './gateway';
import { ChannelManager, createDiscordRequest } from './channel-manager';
import { GeminiChannelNameMatcher } from './channel-name-matcher';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const token = getDiscordToken();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const matcher = geminiApiKey
    ? new GeminiChannelNameMatcher(geminiApiKey, process.env.GEMINI_MODEL?.trim() || undefined)
    : undefined;
  const request = createDiscordRequest(token);
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const channelId = process.env.DISCORD_CHANNEL_LOG_CHANNEL_ID?.trim();
  const logs = new ChannelLogs(
    request,
    guildId && channelId ? { guildId, channelId } : undefined,
    resolve(__dirname, '../../.channel-log-settings'),
  );
  const socket = connectToDiscord(token, new ChannelManager(request, matcher, logs), logs);
  process.once('SIGINT', () => socket.close(1000, 'Process stopped'));
  process.once('SIGTERM', () => socket.close(1000, 'Process stopped'));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
