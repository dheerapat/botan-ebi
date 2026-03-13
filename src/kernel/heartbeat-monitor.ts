import fs from "fs/promises";
import path from "path";

export interface HeartbeatData {
  epochSeconds: number;
  type: "r" | "o";
  interval: string | null;
  slug: string;
  message: string;
  createdAt: number;
}

interface ParsedFilename {
  epochSeconds: number;
  type: "r" | "o";
  interval: string;
  slug: string;
}

const HEARTBEAT_EXTENSION = ".heartbeat.json";
const POLL_INTERVAL_MS = 60_000; // 1 minute

export class HeartbeatMonitor {
  private heartbeatDir: string;
  private archiveDir: string;
  private onHeartbeat: (heartbeat: HeartbeatData) => Promise<void>;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;

  constructor(
    heartbeatDir: string,
    onHeartbeat: (heartbeat: HeartbeatData) => Promise<void>,
  ) {
    this.heartbeatDir = heartbeatDir;
    this.archiveDir = path.join(heartbeatDir, "archive");
    this.onHeartbeat = onHeartbeat;
  }

  async start(): Promise<void> {
    await fs.mkdir(this.heartbeatDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });

    // Run an initial check immediately
    await this.pollHeartbeats();

    // Then poll every minute
    this.pollInterval = setInterval(() => {
      this.pollHeartbeats();
    }, POLL_INTERVAL_MS);

    console.log(
      `Heartbeat monitor started (polling every ${POLL_INTERVAL_MS / 1000}s from ${this.heartbeatDir})`,
    );
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Wait for any in-flight processing to finish
    let waitCount = 0;
    while (this.isProcessing && waitCount < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      waitCount++;
    }

    console.log("Heartbeat monitor stopped");
  }

  private async pollHeartbeats(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const files = await this.listHeartbeatFiles();
      const nowSeconds = Math.floor(Date.now() / 1000);

      for (const file of files) {
        const parsed = this.parseFilename(file);
        if (!parsed) {
          console.warn(`Skipping malformed heartbeat file: ${file}`);
          continue;
        }

        if (nowSeconds >= parsed.epochSeconds) {
          await this.fireHeartbeat(file, parsed);
        }
      }
    } catch (error) {
      console.error("Heartbeat poll error:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async listHeartbeatFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.heartbeatDir);
      return entries.filter((f) => f.endsWith(HEARTBEAT_EXTENSION));
    } catch {
      return [];
    }
  }

  parseFilename(filename: string): ParsedFilename | null {
    // Format: {epochSeconds}-{r|o}-{interval|none}-{slug}.heartbeat.json
    const withoutExt = filename.replace(HEARTBEAT_EXTENSION, "");
    const parts = withoutExt.split("-");

    // Minimum: epoch + type + interval/none + at least one slug segment
    if (parts.length < 4) return null;

    const epochSeconds = parseInt(parts[0]!, 10);
    if (isNaN(epochSeconds)) return null;

    const type = parts[1];
    if (type !== "r" && type !== "o") return null;

    const interval = parts[2]!;
    if (type === "r" && interval === "none") return null;
    if (type === "r" && !this.isValidInterval(interval)) return null;

    // Everything after the third part is the slug
    const slug = parts.slice(3).join("-");
    if (!slug) return null;

    return { epochSeconds, type, interval, slug };
  }

  private isValidInterval(interval: string): boolean {
    const match = interval.match(/^(\d+)(m|h|d)$/);
    if (!match) return false;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    if (value <= 0) return false;
    if (unit === "m" && value < 10) return false;
    return true;
  }

  private intervalToSeconds(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d)$/);
    if (!match) return 0;

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;

    switch (unit) {
      case "m":
        return value * 60;
      case "h":
        return value * 3600;
      case "d":
        return value * 86400;
      default:
        return 0;
    }
  }

  private async fireHeartbeat(
    filename: string,
    parsed: ParsedFilename,
  ): Promise<void> {
    const filePath = path.join(this.heartbeatDir, filename);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const heartbeat: HeartbeatData = JSON.parse(content);

      console.log(
        `Firing heartbeat: ${parsed.slug} (${parsed.type === "r" ? `repeat every ${parsed.interval}` : "one-time"})`,
      );

      // Fire the callback
      await this.onHeartbeat(heartbeat);

      // Handle lifecycle
      if (parsed.type === "o") {
        // One-time: move to archive
        await this.archiveHeartbeat(filename);
      } else {
        // Repeated: recreate with new epoch
        await this.recreateRepeatedHeartbeat(filename, heartbeat, parsed);
      }
    } catch (error) {
      console.error(`Failed to fire heartbeat ${filename}:`, error);
    }
  }

  private async archiveHeartbeat(filename: string): Promise<void> {
    const source = path.join(this.heartbeatDir, filename);
    const target = path.join(this.archiveDir, filename);

    try {
      await fs.rename(source, target);
      console.log(`Archived one-time heartbeat: ${filename}`);
    } catch (error) {
      console.error(`Failed to archive heartbeat ${filename}:`, error);
    }
  }

  private async recreateRepeatedHeartbeat(
    oldFilename: string,
    heartbeat: HeartbeatData,
    parsed: ParsedFilename,
  ): Promise<void> {
    const intervalSeconds = this.intervalToSeconds(parsed.interval);
    if (intervalSeconds === 0) {
      console.error(
        `Invalid interval for repeated heartbeat: ${parsed.interval}`,
      );
      return;
    }

    // Calculate new epoch: advance from the original epoch by intervals
    // until we're in the future. This handles missed heartbeats correctly.
    let newEpoch = parsed.epochSeconds + intervalSeconds;
    const nowSeconds = Math.floor(Date.now() / 1000);
    while (newEpoch <= nowSeconds) {
      newEpoch += intervalSeconds;
    }

    // Build new filename
    const newFilename = `${newEpoch}-${parsed.type}-${parsed.interval}-${parsed.slug}${HEARTBEAT_EXTENSION}`;

    // Update heartbeat data
    const newHeartbeat: HeartbeatData = {
      ...heartbeat,
      epochSeconds: newEpoch,
    };

    const oldPath = path.join(this.heartbeatDir, oldFilename);
    const newPath = path.join(this.heartbeatDir, newFilename);

    try {
      await fs.writeFile(newPath, JSON.stringify(newHeartbeat, null, 2));
      await fs.unlink(oldPath);
      console.log(
        `Recreated repeated heartbeat: ${newFilename} (next fire: ${new Date(newEpoch * 1000).toISOString()})`,
      );
    } catch (error) {
      console.error(`Failed to recreate heartbeat ${oldFilename}:`, error);
    }
  }
}
