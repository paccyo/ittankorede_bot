import { ChannelManager, DiscordInteraction } from './channel-manager';

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

export interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

export function getDiscordToken(environment: NodeJS.ProcessEnv = process.env): string {
  const token = environment.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'DISCORD_BOT_TOKEN is not set. Copy .env.example to .env and set the Bot token.',
    );
  }
  return token;
}

export function createIdentifyPayload(token: string): GatewayPayload {
  return {
    op: 2,
    d: {
      token,
      intents: 0,
      properties: {
        os: process.platform,
        browser: 'ittankorede_bot',
        device: 'ittankorede_bot',
      },
      presence: {
        activities: [],
        status: 'online',
        afk: false,
        since: null,
      },
    },
  };
}

/** Connects to Discord Gateway and keeps the bot session alive until stopped. */
export function connectToDiscord(token: string, channelManager?: ChannelManager): WebSocket {
  const socket = new WebSocket(GATEWAY_URL);
  let sequence: number | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const send = (payload: GatewayPayload): void => socket.send(JSON.stringify(payload));

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data)) as GatewayPayload;
    if (typeof payload.s === 'number') sequence = payload.s;

    if (payload.op === 10) {
      const hello = payload.d as { heartbeat_interval: number };
      heartbeat = setInterval(() => send({ op: 1, d: sequence }), hello.heartbeat_interval);
      send(createIdentifyPayload(token));
    } else if (payload.op === 1) {
      send({ op: 1, d: sequence });
    } else if (payload.op === 0 && payload.t === 'READY') {
      const ready = payload.d as { user: { username: string } };
      console.log(`Discord bot is online as ${ready.user.username}`);
      const guildId = process.env.DISCORD_GUILD_ID?.trim();
      const setupChannelId = process.env.DISCORD_SETUP_CHANNEL_ID?.trim();
      if (channelManager && guildId && setupChannelId) {
        void channelManager.setupGuild(guildId, setupChannelId).catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
        });
      }
    } else if (payload.op === 0 && payload.t === 'INTERACTION_CREATE' && channelManager) {
      void channelManager.handleInteraction(payload.d as DiscordInteraction).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      });
    }
  });

  socket.addEventListener('close', () => {
    if (heartbeat) clearInterval(heartbeat);
  });
  socket.addEventListener('error', () => {
    console.error('Discord Gateway connection failed. Check the token and network connection.');
  });

  return socket;
}
