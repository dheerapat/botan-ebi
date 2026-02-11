import type {
  MessagePacket,
  ResponsePacket,
  IInputAdapter,
  IOutputAdapter,
  IAgentAdapter,
} from "../interfaces/adapter";
import { QueueManager } from "./queue-manager";
import DiscordAdapter from "../adapters/channels/discord";
import OpencodeAgent from "../adapters/agents/opencode/opencode";

export class Kernel {
  private inputs: Map<string, IInputAdapter> = new Map();
  private outputs: Map<string, IOutputAdapter> = new Map();
  private agents: Map<string, IAgentAdapter> = new Map();

  private queue: QueueManager;
  private isShuttingDown: boolean = false;

  constructor() {
    this.queue = new QueueManager();
  }

  async bootstrap() {
    console.log("🚀 Bootstrapping Lobster Kernel...");

    const discordAdapter = new DiscordAdapter();
    const opencodeAgent = new OpencodeAgent();

    this.inputs.set(discordAdapter.name, discordAdapter);
    this.outputs.set(discordAdapter.name, discordAdapter);
    this.agents.set(opencodeAgent.name, opencodeAgent);

    discordAdapter.onMessage((msg) => this.handleIncomingMessage(msg));

    await discordAdapter.start();
    await opencodeAgent.start();

    console.log("✅ Discord Adapter Started");
    console.log("✅ Opencode Agent Loaded");

    this.startProcessingLoop();
  }

  // When a message comes from Discord/WhatsApp
  private async handleIncomingMessage(msg: MessagePacket) {
    await this.queue.enqueue("incoming", msg);
  }

  // The main loop: Pick up message -> Send to Agent -> Send to Output
  private startProcessingLoop() {
    this.startIncomingLoop();
    this.startOutgoingLoop();
  }

  private async startIncomingLoop() {
    const processNext = async () => {
      const queuedItem = await this.queue.dequeue<MessagePacket>("incoming");
      if (!queuedItem) {
        setTimeout(processNext, 1000);
        return;
      }

      const msg = queuedItem.data;
      const agent = this.agents.get("opencode");

      if (!agent) {
        console.error("No agent available!");
        await this.queue.complete("incoming", queuedItem.id);
        processNext();
        return;
      }

      console.log(
        `[${msg.source}] Processing message ${msg.id} via ${agent.name}...`,
      );

      try {
        const responseText = await agent.process(msg);

        const response: ResponsePacket = {
          ...msg,
          id: `${msg.id}_response`,
          payload: responseText,
          originalMessageId: msg.id,
          timestamp: Date.now(),
        };

        await this.queue.enqueue("outgoing", response);
        await this.queue.complete("incoming", queuedItem.id);
      } catch (err) {
        console.error("Agent processing failed:", err);
        await this.queue.complete("incoming", queuedItem.id);
      }

      processNext();
    };

    processNext();
  }

  private async startOutgoingLoop() {
    const processNext = async () => {
      const queuedItem = await this.queue.dequeue<ResponsePacket>("outgoing");
      if (!queuedItem) {
        setTimeout(processNext, 1000);
        return;
      }

      const response = queuedItem.data;
      const outputAdapter = this.outputs.get(response.source);

      if (outputAdapter) {
        await outputAdapter.send(response);
        await this.queue.complete("outgoing", queuedItem.id);
      } else {
        console.warn(`No output adapter found for source: ${response.source}`);
        await this.queue.complete("outgoing", queuedItem.id);
      }

      processNext();
    };

    processNext();
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log("🛑 Shutting down...");

    for (const [name, adapter] of this.inputs) {
      console.log(`Stopping input adapter: ${name}`);
      await adapter.stop();
    }

    for (const [name, adapter] of this.outputs) {
      console.log(`Stopping output adapter: ${name}`);
      await adapter.stop();
    }

    for (const [name, agent] of this.agents) {
      console.log(`Stopping agent: ${name}`);
      await agent.stop();
    }

    console.log("✅ Shutdown complete");
    process.exit(0);
  }
}
