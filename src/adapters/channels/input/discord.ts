import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import type { IInputAdapter, MessagePacket } from "+interfaces/adapter";
import { validateMessagePacket } from "+utils/validation";
import { RateLimiter } from "+utils/rate-limiter";

export interface DiscordInputConfig {
  maxMessageLength: number;
  rateLimitPerMinute: number;
  cleanupIntervalMs?: number;
}

export class DiscordInputAdapter implements IInputAdapter {
  name = "discord";
  private client: Client;
  private messageCallback?: (msg: MessagePacket) => void;
  private config: DiscordInputConfig;
  private rateLimiter: RateLimiter;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: Partial<DiscordInputConfig>) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
    this.config = {
      maxMessageLength: config?.maxMessageLength || 10000,
      rateLimitPerMinute: config?.rateLimitPerMinute || 10,
      cleanupIntervalMs: config?.cleanupIntervalMs || 60000,
    };
    this.rateLimiter = new RateLimiter({
      maxRequestsPerMinute: this.config.rateLimitPerMinute,
    });
  }

  getClient(): Client {
    return this.client;
  }

  async start() {
    this.client.on(Events.ClientReady, () =>
      console.log(`Logged in as ${this.client.user?.tag}`),
    );

    this.client.on(Events.MessageCreate, async (msg) => {
      if (msg.author.bot) return;

      const rateCheck = this.rateLimiter.check(msg.channelId);

      if (!rateCheck.allowed) {
        const retryAfter = rateCheck.retryAfter || 60;
        console.warn(
          `Rate limit exceeded for channel ${msg.channelId}. Retry in ${retryAfter}s`,
        );
        await msg.reply(
          `⚠️ Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        );
        return;
      }

      const packet: MessagePacket = {
        id: msg.id,
        source: this.name,
        channelId: msg.channelId,
        userId: msg.author.id,
        payload: msg.content,
        timestamp: Date.now(),
      };

      const validation = validateMessagePacket(packet, {
        maxMessageLength: this.config.maxMessageLength,
      });

      if (!validation.valid) {
        console.warn(`Message validation failed: ${validation.error}`);
        await msg.reply(`⚠️ ${validation.error}`);
        return;
      }

      if (this.messageCallback) this.messageCallback(packet);
    });

    await this.client.login(process.env.DISCORD_TOKEN);

    this.cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  async stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.client.destroy();
  }

  onMessage(callback: (msg: MessagePacket) => void): void {
    this.messageCallback = callback;
  }
}
