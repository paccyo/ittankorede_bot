import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectToDiscord, getDiscordToken } from './gateway';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const socket = connectToDiscord(getDiscordToken());
  process.once('SIGINT', () => socket.close(1000, 'Process stopped'));
  process.once('SIGTERM', () => socket.close(1000, 'Process stopped'));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
