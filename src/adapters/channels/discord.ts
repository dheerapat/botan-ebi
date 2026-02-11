import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import type {
  IInputAdapter,
  IOutputAdapter,
  MessagePacket,
  ResponsePacket,
} from "../../interfaces/adapter";

// Discord implements BOTH Input and Output
export default class DiscordAdapter implements IInputAdapter, IOutputAdapter {
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

  async start() {
    this.client.on(Events.ClientReady, () =>
      console.log(`Logged in as ${this.client.user?.tag}`),
    );

    this.client.on(Events.MessageCreate, async (msg) => {
      if (msg.author.bot) return;

      // Map Discord message to Generic Packet
      const packet: MessagePacket = {
        id: msg.id,
        source: this.name,
        channelId: msg.channelId,
        userId: msg.author.id,
        payload: msg.content,
        timestamp: Date.now(),
      };

      // Notify Kernel
      if (this.messageCallback) this.messageCallback(packet);
    });

    // Load token from env (decoupled from code)
    await this.client.login(process.env.DISCORD_TOKEN);
  }

  async stop() {
    this.client.destroy();
  }

  // Input Interface Method
  onMessage(callback: (msg: MessagePacket) => void): void {
    this.messageCallback = callback;
  }

  // Output Interface Method
  async send(response: ResponsePacket): Promise<void> {
    const channel = await this.client.channels.fetch(response.channelId);
    if (channel && "send" in channel) {
      await channel.send(response.payload);
    }
  }
}
