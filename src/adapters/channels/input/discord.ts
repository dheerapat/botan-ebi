import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import type { IInputAdapter, MessagePacket } from "../../../interfaces/adapter";

export class DiscordInputAdapter implements IInputAdapter {
  name = "discord";
  private client: Client;
  private messageCallback?: (msg: MessagePacket) => void;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
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

      const packet: MessagePacket = {
        id: msg.id,
        source: this.name,
        channelId: msg.channelId,
        userId: msg.author.id,
        payload: msg.content,
        timestamp: Date.now(),
      };

      if (this.messageCallback) this.messageCallback(packet);
    });

    await this.client.login(process.env.DISCORD_TOKEN);
  }

  async stop() {
    this.client.destroy();
  }

  onMessage(callback: (msg: MessagePacket) => void): void {
    this.messageCallback = callback;
  }
}
