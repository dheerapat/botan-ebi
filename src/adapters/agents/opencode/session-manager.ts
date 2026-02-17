import fs from "fs/promises";
import path from "path";

interface SessionData {
  [channelId: string]: string;
}

export class SessionManager {
  private sessions: Map<string, string> = new Map();
  private sessionsPath: string;
  private tempSessionsPath: string;

  constructor(basePath: string = ".botan-ebi") {
    this.sessionsPath = path.join(basePath, "sessions.json");
    this.tempSessionsPath = path.join(basePath, "sessions.json.tmp");
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.sessionsPath, "utf-8");
      const data: SessionData = JSON.parse(content);
      this.sessions = new Map(Object.entries(data));
    } catch (error) {
      const isFileNotFound =
        error instanceof Error && "code" in error && error.code === "ENOENT";

      if (isFileNotFound) {
        console.log(
          "💭 No existing sessions found (first run), starting fresh",
        );
      } else {
        console.warn("Could not load sessions, starting fresh:", error);
      }

      this.sessions = new Map();
    }
  }

  async save(): Promise<void> {
    const data: SessionData = Object.fromEntries(this.sessions);
    const dir = path.dirname(this.sessionsPath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = this.tempSessionsPath;
    const targetPath = this.sessionsPath;

    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2));

      await fs.rename(tempPath, targetPath);
    } catch (error) {
      console.error("Failed to save sessions:", error);
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        console.warn("Failed to clean up temp file:", unlinkError);
      }
      throw error;
    }
  }

  getSessionId(channelId: string): string | undefined {
    return this.sessions.get(channelId);
  }

  /**
   * Store a session ID for a given channel.
   * This is an async operation that persists the change to disk.
   */
  async setSessionId(channelId: string, sessionId: string): Promise<void> {
    this.sessions.set(channelId, sessionId);
    await this.save();
  }

  /**
   * Delete a session for a given channel.
   * This is an async operation that persists the change to disk.
   * @returns true if session was deleted, false if it didn't exist
   */
  async deleteSession(channelId: string): Promise<boolean> {
    const deleted = this.sessions.delete(channelId);
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  /**
   * Clear all sessions from memory and disk.
   * This is an async operation that persists the change to disk.
   */
  async clearAll(): Promise<void> {
    this.sessions.clear();
    await this.save();
  }
}
