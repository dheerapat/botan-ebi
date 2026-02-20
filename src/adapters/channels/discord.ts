import type {
  IInputAdapter,
  IOutputAdapter,
  MessagePacket,
  ResponsePacket,
} from "+interfaces/adapter";
import { DiscordInputAdapter } from "+adapters/channels/input/discord";
import { DiscordOutputAdapter } from "+adapters/channels/output/discord";

export default class DiscordAdapter implements IInputAdapter, IOutputAdapter {
  name = "discord";
  private inputAdapter: DiscordInputAdapter;
  private outputAdapter: DiscordOutputAdapter;

  constructor() {
    this.inputAdapter = new DiscordInputAdapter();
    this.outputAdapter = new DiscordOutputAdapter(
      this.inputAdapter.getClient(),
    );
  }

  async start(): Promise<void> {
    await this.inputAdapter.start();
    await this.outputAdapter.start();
  }

  async stop(): Promise<void> {
    await this.inputAdapter.stop();
    await this.outputAdapter.stop();
  }

  onMessage(callback: (msg: MessagePacket) => void): void {
    this.inputAdapter.onMessage(callback);
  }

  async send(response: ResponsePacket): Promise<void> {
    await this.outputAdapter.send(response);
  }
}

export { DiscordInputAdapter, DiscordOutputAdapter };
