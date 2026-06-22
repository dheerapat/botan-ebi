import { spawn, type ChildProcess } from "child_process";
import { StringDecoder } from "string_decoder";
import type { IAgentAdapter, MessagePacket } from "+interfaces/adapter";

interface Pending {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PiRpcAgentOptions {
  provider?: string;
  model?: string;
  sessionDir?: string;
  responseTimeoutMs?: number;
}

export default class PiRpcAgent implements IAgentAdapter {
  name = "pi";

  private proc: ChildProcess | null = null;
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private pending = new Map<string, Pending>();
  private eventListeners: Array<(event: any) => void> = [];
  private channelSessions = new Map<string, string>();
  private reqCounter = 0;
  private opts: Required<PiRpcAgentOptions>;
  private running = false;
  private procError: Error | null = null;

  constructor(opts: PiRpcAgentOptions = {}) {
    this.opts = {
      provider: opts.provider ?? "",
      model: opts.model ?? "",
      sessionDir: opts.sessionDir ?? ".pi/sessions",
      responseTimeoutMs: opts.responseTimeoutMs ?? 300_000,
    };
  }

  private nextId(): string {
    return `r${++this.reqCounter}`;
  }

  async start(): Promise<void> {
    this.running = true;
    this.spawn();
    console.log(
      `✅ PiRpcAgent initialized (session dir: ${this.opts.sessionDir})`,
    );
  }

  private spawn(): void {
    const args = ["--mode", "rpc", "--session-dir", this.opts.sessionDir];
    if (this.opts.provider) args.push("--provider", this.opts.provider);
    if (this.opts.model) args.push("--model", this.opts.model);

    try {
      this.proc = spawn("pi", args, {
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (err) {
      this.procError = err instanceof Error ? err : new Error(String(err));
      console.error("Failed to spawn pi process:", this.procError.message);
      return;
    }

    this.procError = null;

    const stdout = this.proc.stdout;
    if (!stdout) {
      this.procError = new Error("pi process has no stdout");
      return;
    }

    stdout.on("data", (chunk: Buffer) => {
      this.buffer += this.decoder.write(chunk);
      this.processLines();
    });

    this.proc.on("exit", (code, signal) => {
      console.warn(
        `pi process exited (code: ${code}, signal: ${signal})`,
      );
      this.rejectAll(`pi process exited (code: ${code})`);
      if (this.running) {
        console.log("Restarting pi process...");
        this.spawn();
      }
    });

    this.proc.on("error", (err) => {
      this.procError = err;
      console.error("pi process error:", err.message);
    });
  }

  private processLines(): void {
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl === -1) break;
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.type === "response") {
      const id = msg.id;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (msg.success) pending.resolve(msg.data ?? {});
        else pending.reject(new Error(msg.error || "Command failed"));
      }
      return;
    }

    // Forward events (agent_start, message_update, agent_end, etc.)
    for (const listener of this.eventListeners) {
      try {
        listener(msg);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  private send(cmd: Record<string, unknown>, id?: string): Promise<any> {
    if (this.procError) {
      return Promise.reject(this.procError);
    }

    const cmdId = id ?? this.nextId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId);
        reject(new Error(`Command "${String(cmd.type)}" timed out`));
      }, this.opts.responseTimeoutMs);

      this.pending.set(cmdId, { resolve, reject, timer });

      try {
        this.proc!.stdin!.write(
          JSON.stringify({ ...cmd, id: cmdId }) + "\n",
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(cmdId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.rejectAll("Agent stopped");

    if (this.proc) {
      try {
        this.proc.stdin?.write(JSON.stringify({ type: "abort" }) + "\n");
      } catch {
        // ignore
      }
      this.proc.kill();
      this.proc = null;
    }
  }

  private rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async process(message: MessagePacket): Promise<string> {
    const { payload, channelId } = message;
    const trimmed = payload.trim();

    // Handle reset commands
    if (["/reset", "!reset"].includes(trimmed.toLowerCase())) {
      return this.handleReset(channelId);
    }

    console.log(`[pi-agent] process: channel=${channelId}, proc=${!!this.proc}, procError=${this.procError?.message ?? "null"}`);

    if (this.procError) {
      return `I'm not connected to the AI agent due to an error: ${this.procError.message}. Please restart the bot.`;
    }

    if (!this.proc || !this.proc.stdin?.writable) {
      console.warn(`[pi-agent] process not ready, attempting restart...`);
      this.spawn();
      // Give it a moment
      await new Promise((r) => setTimeout(r, 1000));
      if (!this.proc || !this.proc.stdin?.writable) {
        return "I encountered an error: pi process is not available. Please restart the bot.";
      }
    }

    // Switch to channel's session if we have one
    const sessionPath = this.channelSessions.get(channelId);
    if (sessionPath) {
      try {
        console.log(`[pi-agent] switching to session: ${sessionPath}`);
        await this.send({ type: "switch_session", sessionPath });
      } catch (err) {
        console.warn(
          `Failed to switch to session for channel ${channelId}:`,
          err,
        );
        this.channelSessions.delete(channelId);
      }
    }

    // Send prompt and collect response
    let responseText: string;
    try {
      console.log(`[pi-agent] sending prompt...`);
      responseText = await this.collectResponse(() =>
        this.send({ type: "prompt", message: trimmed }),
      );
      console.log(`[pi-agent] response received (${responseText.length} chars)`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(
        `PiRpcAgent error for channel ${channelId}:`,
        errorMessage,
      );
      return `I encountered an error: ${errorMessage}. Please try again later.`;
    }

    // Store session path for new channels
    if (!sessionPath) {
      try {
        const state = await this.send({ type: "get_state" });
        if (state?.sessionFile) {
          console.log(`[pi-agent] stored session: ${state.sessionFile}`);
          this.channelSessions.set(channelId, state.sessionFile);
        }
      } catch {
        // non-critical
      }
    }

    return responseText || "[No response text received]";
  }

  private async handleReset(channelId: string): Promise<string> {
    this.channelSessions.delete(channelId);
    try {
      await this.send({ type: "new_session" });
      return "Session reset! Starting a fresh conversation.";
    } catch (error) {
      console.error("Failed to reset session:", error);
      this.channelSessions.clear();
      return "Session reset (local cache cleared). Starting fresh.";
    }
  }

  private collectResponse(
    sendFn: () => Promise<void>,
    timeoutMs?: number,
  ): Promise<string> {
    const timeout = timeoutMs ?? this.opts.responseTimeoutMs;

    return new Promise<string>((resolve, reject) => {
      let text = "";

      const timer = setTimeout(() => {
        this.eventListeners = this.eventListeners.filter(
          (l) => l !== onEvent,
        );
        reject(new Error("Agent response timed out"));
      }, timeout);

      const onEvent = (event: any) => {
        if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta") {
            text += delta.delta;
          }
        }

        if (event.type === "agent_end") {
          clearTimeout(timer);
          this.eventListeners = this.eventListeners.filter(
            (l) => l !== onEvent,
          );
          resolve(text);
        }
      };

      this.eventListeners.push(onEvent);

      sendFn().catch((err) => {
        clearTimeout(timer);
        this.eventListeners = this.eventListeners.filter(
          (l) => l !== onEvent,
        );
        reject(err);
      });
    });
  }
}
