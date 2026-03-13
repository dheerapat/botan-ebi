import fs from "fs/promises";
import path from "path";

export interface ChannelContextData {
  channelId: string;
  userId: string;
  source: string;
  lastSeen: number;
}

export class ChannelContext {
  private context: ChannelContextData | null = null;
  private filePath: string;
  private tempFilePath: string;

  constructor(basePath: string = ".botan-ebi") {
    this.filePath = path.join(basePath, "last-channel.json");
    this.tempFilePath = path.join(basePath, "last-channel.json.tmp");
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      this.context = JSON.parse(content);
    } catch (error) {
      const isFileNotFound =
        error instanceof Error && "code" in error && error.code === "ENOENT";

      if (isFileNotFound) {
        console.log(
          "No existing channel context found (first run), starting fresh",
        );
      } else {
        console.warn("Could not load channel context, starting fresh:", error);
      }

      this.context = null;
    }
  }

  async update(
    channelId: string,
    userId: string,
    source: string,
  ): Promise<void> {
    this.context = {
      channelId,
      userId,
      source,
      lastSeen: Math.floor(Date.now() / 1000),
    };

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.writeFile(
        this.tempFilePath,
        JSON.stringify(this.context, null, 2),
      );
      await fs.rename(this.tempFilePath, this.filePath);
    } catch (error) {
      console.error("Failed to save channel context:", error);
      try {
        await fs.unlink(this.tempFilePath);
      } catch {
        // ignore cleanup failure
      }
    }
  }

  get(): ChannelContextData | null {
    return this.context;
  }
}
