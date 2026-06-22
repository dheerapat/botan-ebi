import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ChannelContext,
  type ChannelContextData,
} from "../src/kernel/channel-context.js";
import fs from "fs/promises";
import path from "path";

describe("ChannelContext", () => {
  const testBasePath = path.join(process.cwd(), ".test-channel-context");

  beforeEach(async () => {
    await fs.rm(testBasePath, { recursive: true, force: true });
    await fs.mkdir(testBasePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testBasePath, { recursive: true, force: true });
  });

  it("should return null when no context has been set", async () => {
    const ctx = new ChannelContext(testBasePath);
    await ctx.load();
    expect(ctx.get()).toBeNull();
  });

  it("should persist and load channel context", async () => {
    const ctx = new ChannelContext(testBasePath);
    await ctx.load();

    await ctx.update("channel-123", "user-456", "discord");

    const data = ctx.get();
    expect(data).not.toBeNull();
    expect(data!.channelId).toBe("channel-123");
    expect(data!.userId).toBe("user-456");
    expect(data!.source).toBe("discord");
    expect(data!.lastSeen).toBeGreaterThan(0);

    // Load in a fresh instance to verify disk persistence
    const ctx2 = new ChannelContext(testBasePath);
    await ctx2.load();

    const loaded = ctx2.get();
    expect(loaded).not.toBeNull();
    expect(loaded!.channelId).toBe("channel-123");
    expect(loaded!.userId).toBe("user-456");
    expect(loaded!.source).toBe("discord");
  });

  it("should overwrite previous context on update", async () => {
    const ctx = new ChannelContext(testBasePath);
    await ctx.load();

    await ctx.update("channel-1", "user-1", "discord");
    await ctx.update("channel-2", "user-2", "discord");

    const data = ctx.get();
    expect(data!.channelId).toBe("channel-2");
    expect(data!.userId).toBe("user-2");
  });

  it("should handle missing file gracefully on load", async () => {
    const freshPath = path.join(testBasePath, "nonexistent");
    await fs.mkdir(freshPath, { recursive: true });

    const ctx = new ChannelContext(freshPath);
    await ctx.load(); // should not throw
    expect(ctx.get()).toBeNull();
  });

  it("should handle corrupted file gracefully on load", async () => {
    const filePath = path.join(testBasePath, "last-channel.json");
    await fs.writeFile(filePath, "not valid json{{{");

    const ctx = new ChannelContext(testBasePath);
    await ctx.load(); // should not throw
    expect(ctx.get()).toBeNull();
  });

  it("should create base directory if it doesn't exist", async () => {
    const deepPath = path.join(testBasePath, "deep", "nested");

    const ctx = new ChannelContext(deepPath);
    await ctx.update("ch-1", "usr-1", "discord");

    const fileExists = await fs
      .access(path.join(deepPath, "last-channel.json"))
      .then(
        () => true,
        () => false,
      );
    expect(fileExists).toBe(true);
  });
});
