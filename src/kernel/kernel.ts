import type {
  MessagePacket,
  ResponsePacket,
  IInputAdapter,
  IOutputAdapter,
  IAgentAdapter,
} from "../interfaces/adapter";
import { QueueManager } from "./queue-manager";

export class Kernel {
  private inputs: Map<string, IInputAdapter> = new Map();
  private outputs: Map<string, IOutputAdapter> = new Map();
  private agents: Map<string, IAgentAdapter> = new Map();

  private queue: QueueManager;
  private isShuttingDown: boolean = false;
  private maxQueueDepth: number;
  private activeProcessingJobs: Set<string> = new Set();
  private shutdownTimeout: number;

  constructor(
    inputAdapters: IInputAdapter[],
    outputAdapters: IOutputAdapter[],
    agentAdapters: IAgentAdapter[],
    maxQueueDepth: number = 50,
    shutdownTimeout: number = 30000,
  ) {
    this.queue = new QueueManager();
    this.inputs = new Map(
      inputAdapters.map((adapter) => [adapter.name, adapter]),
    );
    this.outputs = new Map(
      outputAdapters.map((adapter) => [adapter.name, adapter]),
    );
    this.agents = new Map(
      agentAdapters.map((adapter) => [adapter.name, adapter]),
    );
    this.maxQueueDepth = maxQueueDepth;
    this.shutdownTimeout = shutdownTimeout;
  }

  async bootstrap(
    inputChannelName: string,
    outputChannelName: string,
    agentName: string,
  ) {
    console.log("🚀 Bootstrapping Botan-ebi Kernel...");
    const inputAdapter = this.inputs.get(inputChannelName);
    const outputAdapter = this.outputs.get(outputChannelName);
    const agent = this.agents.get(agentName);

    inputAdapter!.onMessage((msg: MessagePacket) =>
      this.handleIncomingMessage(msg),
    );

    await inputAdapter!.start();
    await outputAdapter!.start();
    await agent!.start();

    console.log("✅ Adapter Started");
    console.log("✅ Agent Loaded");

    this.startProcessingLoop(agentName);
  }

  // When a message comes from Discord/WhatsApp
  private async handleIncomingMessage(msg: MessagePacket) {
    if (this.isShuttingDown) {
      console.warn(`Rejecting message ${msg.id} - system is shutting down`);
      return;
    }

    const currentDepth = this.queue.getQueueDepth("incoming");
    if (currentDepth >= this.maxQueueDepth) {
      console.warn(
        `Rejecting message ${msg.id} - queue depth (${currentDepth}) exceeds limit (${this.maxQueueDepth})`,
      );
      return;
    }

    await this.queue.enqueue("incoming", msg);
  }

  // The main loop: Pick up message -> Send to Agent -> Send to Output
  private startProcessingLoop(agentName: string) {
    this.startIncomingLoop(agentName);
    this.startOutgoingLoop();
  }

  private async startIncomingLoop(agentName: string) {
    const processNext = async () => {
      if (this.isShuttingDown) {
        const processingCount = this.activeProcessingJobs.size;
        if (processingCount === 0) {
          console.log("Incoming loop: no more jobs to process");
          return;
        }
        console.log(
          `Incoming loop: waiting for ${processingCount} jobs to complete`,
        );
        setTimeout(processNext, 500);
        return;
      }

      const queuedItem = await this.queue.dequeue<MessagePacket>("incoming");
      if (!queuedItem) {
        setTimeout(processNext, 1000);
        return;
      }

      const msg = queuedItem.data;
      const agent = this.agents.get(agentName);

      if (!agent) {
        console.error("No agent available!");
        await this.queue.complete("incoming", queuedItem.id);
        processNext();
        return;
      }

      this.activeProcessingJobs.add(queuedItem.id);

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
      } finally {
        this.activeProcessingJobs.delete(queuedItem.id);
      }

      if (!this.isShuttingDown) {
        processNext();
      }
    };

    processNext();
  }

  private async startOutgoingLoop() {
    const processNext = async () => {
      if (this.isShuttingDown) {
        const processingCount = this.activeProcessingJobs.size;
        if (processingCount === 0) {
          console.log("Outgoing loop: no more jobs to process");
          return;
        }
        console.log(
          `Outgoing loop: waiting for ${processingCount} jobs to complete`,
        );
        setTimeout(processNext, 500);
        return;
      }

      const queuedItem = await this.queue.dequeue<ResponsePacket>("outgoing");
      if (!queuedItem) {
        setTimeout(processNext, 1000);
        return;
      }

      const response = queuedItem.data;
      const outputAdapter = this.outputs.get(response.source);

      this.activeProcessingJobs.add(queuedItem.id);

      if (outputAdapter) {
        await outputAdapter.send(response);
        await this.queue.complete("outgoing", queuedItem.id);
      } else {
        console.warn(`No output adapter found for source: ${response.source}`);
        await this.queue.complete("outgoing", queuedItem.id);
      }

      this.activeProcessingJobs.delete(queuedItem.id);

      if (!this.isShuttingDown) {
        processNext();
      }
    };

    processNext();
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log("\n🛑 Shutting down...");

    for (const [name, adapter] of this.inputs) {
      console.log(`Stopping input adapter: ${name}`);
      await adapter.stop();
    }

    const startTime = Date.now();

    while (this.activeProcessingJobs.size > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.shutdownTimeout) {
        console.warn(
          `Shutdown timeout reached with ${this.activeProcessingJobs.size} jobs remaining`,
        );
        break;
      }

      console.log(
        `Waiting for ${this.activeProcessingJobs.size} active jobs to complete...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log("✅ All active jobs completed or timeout reached");

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
