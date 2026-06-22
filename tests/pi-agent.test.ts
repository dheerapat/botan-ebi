import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import PiRpcAgent from "../src/adapters/agents/pi/rpc-agent.js";
import type { MessagePacket } from "../src/interfaces/adapter";
import fs from "fs/promises";
import path from "path";

describe("PiRpcAgent", () => {
  let agent: PiRpcAgent;
  let testSessionDir: string;

  beforeEach(async () => {
    testSessionDir = path.join(process.cwd(), ".test-pi-sessions");
    agent = new PiRpcAgent({ sessionDir: testSessionDir });
    await fs.rm(testSessionDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await agent.stop();
    await fs.rm(testSessionDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("should initialize with correct name", () => {
      expect(agent.name).toBe("pi");
    });

    it("should start and stop without errors", async () => {
      await agent.start();
      await agent.stop();
    });
  });

  describe("process - reset commands", () => {
    it("should handle /reset command", async () => {
      const message: MessagePacket = {
        id: "msg-1",
        source: "discord",
        channelId: "channel-123",
        userId: "user-123",
        payload: "/reset",
        timestamp: Date.now(),
      };

      const response = await agent.process(message);
      expect(response).toContain("fresh");
    });

    it("should handle !reset command", async () => {
      const message: MessagePacket = {
        id: "msg-2",
        source: "discord",
        channelId: "channel-456",
        userId: "user-456",
        payload: "!reset",
        timestamp: Date.now(),
      };

      const response = await agent.process(message);
      expect(response).toContain("fresh");
    });

    it("should handle reset with whitespace variations", async () => {
      const message: MessagePacket = {
        id: "msg-3",
        source: "discord",
        channelId: "channel-789",
        userId: "user-789",
        payload: "  /RESET  ",
        timestamp: Date.now(),
      };

      const response = await agent.process(message);
      expect(response).toContain("fresh");
    });
  });

  describe("process - error handling", () => {
    it("should return friendly error when pi is unavailable", async () => {
      const message: MessagePacket = {
        id: "msg-4",
        source: "discord",
        channelId: "channel-error",
        userId: "user-error",
        payload: "Hello",
        timestamp: Date.now(),
      };

      const response = await agent.process(message);
      expect(response).toContain("error");
    });
  });
});
