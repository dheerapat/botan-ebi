import type { IAgentAdapter, MessagePacket } from "+interfaces/adapter";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { SessionManager } from "+adapters/agents/opencode/session-manager";
import { retryWithBackoff } from "+utils/retry";

export default class OpencodeAgent implements IAgentAdapter {
  name = "opencode";

  private client: ReturnType<typeof createOpencodeClient>;
  private sessionManager: SessionManager;
  private baseUrl: string;
  private providerId: string | undefined;
  private modelId: string | undefined;

  constructor() {
    this.baseUrl = process.env.OPENCODE_BASE_URL || "http://localhost:4096";
    this.providerId = process.env.OPENCODE_PROVIDER_ID;
    this.modelId = process.env.OPENCODE_MODEL_ID;

    this.client = createOpencodeClient({ baseUrl: this.baseUrl });
    this.sessionManager = new SessionManager();
  }

  async start(): Promise<void> {
    await this.sessionManager.load();
    console.log(`✅ OpencodeAgent initialized (connecting to ${this.baseUrl})`);
  }

  async stop(): Promise<void> {
    await this.sessionManager.save();
    console.log("✅ OpencodeAgent stopped");
  }

  async process(message: MessagePacket, context?: any): Promise<string> {
    const { payload, channelId } = message;
    const trimmedPayload = payload.trim();

    const resetCommands = ["/reset", "!reset"];
    if (resetCommands.includes(trimmedPayload.toLowerCase())) {
      return this.handleReset(channelId);
    }

    try {
      const sessionId = await this.getOrCreateSession(channelId);
      const response = await this.sendMessage(sessionId, trimmedPayload);
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `OpencodeAgent error for channel ${channelId}:`,
        errorMessage,
      );
      return `I encountered an error: ${errorMessage}. Please try again later.`;
    }
  }

  private async handleReset(channelId: string): Promise<string> {
    const sessionId = this.sessionManager.getSessionId(channelId);

    if (sessionId) {
      try {
        await retryWithBackoff(
          () =>
            this.client.session.delete({
              path: { id: sessionId },
            }),
          {
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
          },
        );
        await this.sessionManager.deleteSession(channelId);
        console.log(`Session reset for channel ${channelId}`);
        return "Session reset! Starting a fresh conversation.";
      } catch (error) {
        console.error(`Failed to delete session ${sessionId}:`, error);
        await this.sessionManager.deleteSession(channelId);
        return "Session reset (local cache cleared). Starting fresh.";
      }
    }

    return "No active session to reset. Starting fresh conversation.";
  }

  private async getOrCreateSession(channelId: string): Promise<string> {
    let sessionId = this.sessionManager.getSessionId(channelId);

    if (!sessionId) {
      console.log(`Creating new session for channel ${channelId}`);
      const session = await retryWithBackoff(
        () =>
          this.client.session.create({
            body: { title: `Discord Channel: ${channelId}` },
          }),
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
        },
      );
      if (!session.data) {
        throw new Error("Failed to create session: no data returned");
      }
      sessionId = session.data.id;
      await this.sessionManager.setSessionId(channelId, sessionId);
    }

    return sessionId;
  }

  private async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<string> {
    const parts = [{ type: "text" as const, text: message }];

    const body: any = { parts };

    if (this.providerId && this.modelId) {
      body.model = {
        providerID: this.providerId,
        modelID: this.modelId,
      };
    }

    const result = await retryWithBackoff(
      () =>
        this.client.session.prompt({
          path: { id: sessionId },
          body,
        }),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    );

    if (!result.data) {
      return "[No response received from opencode]";
    }

    const assistantMessage = result.data;

    if (assistantMessage.parts) {
      const textParts = assistantMessage.parts.filter(
        (p: any) => p.type === "text",
      );
      return textParts.map((p: any) => p.text).join("\n");
    }

    return "[No response text received]";
  }
}
