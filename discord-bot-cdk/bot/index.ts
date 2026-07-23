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
  const socket = connectToDiscord(token, new ChannelManager(createDiscordRequest(token), matcher));
  process.once('SIGINT', () => socket.close(1000, 'Process stopped'));
  process.once('SIGTERM', () => socket.close(1000, 'Process stopped'));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
