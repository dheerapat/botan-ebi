import { Client } from "discord.js";
import type {
  IOutputAdapter,
  ResponsePacket,
} from "../../../interfaces/adapter";

export class DiscordOutputAdapter implements IOutputAdapter {
  name = "discord";
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async start(): Promise<void> {
    // Client lifecycle managed by input adapter
  }

  async stop(): Promise<void> {
    // Client lifecycle managed by input adapter
  }

  async send(response: ResponsePacket): Promise<void> {
    const channel = await this.client.channels.fetch(response.channelId);
    if (channel && "send" in channel) {
      await channel.send(response.payload);
    }
  }
}
