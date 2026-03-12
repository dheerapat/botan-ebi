import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  HeartbeatMonitor,
  type HeartbeatData,
} from "../src/kernel/heartbeat-monitor.js";
import fs from "fs/promises";
import path from "path";

describe("HeartbeatMonitor", () => {
  let testDir: string;
  let archiveDir: string;
  let firedHeartbeats: HeartbeatData[];

  beforeEach(async () => {
    testDir = path.join(process.cwd(), ".test-heartbeats");
    archiveDir = path.join(testDir, "archive");
    firedHeartbeats = [];

    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createHeartbeatFile(
    filename: string,
    data: HeartbeatData,
  ): Promise<void> {
    return fs.writeFile(
      path.join(testDir, filename),
      JSON.stringify(data, null, 2),
    );
  }

  function makeHeartbeatData(
    overrides: Partial<HeartbeatData> = {},
  ): HeartbeatData {
    return {
      epochSeconds: Math.floor(Date.now() / 1000) - 60, // 1 minute ago (due)
      type: "o",
      interval: null,
      slug: "test-heartbeat",
      message: "This is a test heartbeat reminder.",
      channelId: "channel-123",
      userId: "user-456",
      createdAt: Math.floor(Date.now() / 1000) - 3600,
      ...overrides,
    };
  }

  describe("parseFilename", () => {
    it("should parse a one-time heartbeat filename", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      const result = monitor.parseFilename(
        "1752300232-o-none-meeting-prep.heartbeat.json",
      );
      expect(result).toEqual({
        epochSeconds: 1752300232,
        type: "o",
        interval: "none",
        slug: "meeting-prep",
      });
    });

    it("should parse a repeated heartbeat filename", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      const result = monitor.parseFilename(
        "1752300232-r-1d-check-email.heartbeat.json",
      );
      expect(result).toEqual({
        epochSeconds: 1752300232,
        type: "r",
        interval: "1d",
        slug: "check-email",
      });
    });

    it("should parse repeated heartbeat with hour interval", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      const result = monitor.parseFilename(
        "1752300232-r-6h-standup-reminder.heartbeat.json",
      );
      expect(result).toEqual({
        epochSeconds: 1752300232,
        type: "r",
        interval: "6h",
        slug: "standup-reminder",
      });
    });

    it("should parse repeated heartbeat with minute interval", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      const result = monitor.parseFilename(
        "1752300232-r-30m-water-break.heartbeat.json",
      );
      expect(result).toEqual({
        epochSeconds: 1752300232,
        type: "r",
        interval: "30m",
        slug: "water-break",
      });
    });

    it("should handle multi-word slugs", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      const result = monitor.parseFilename(
        "1752300232-o-none-take-out-the-trash.heartbeat.json",
      );
      expect(result).toEqual({
        epochSeconds: 1752300232,
        type: "o",
        interval: "none",
        slug: "take-out-the-trash",
      });
    });

    it("should return null for malformed filenames", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      expect(monitor.parseFilename("bad-file.json")).toBeNull();
      expect(monitor.parseFilename("notanumber-r-1d-slug.heartbeat.json")).toBeNull();
      expect(monitor.parseFilename("1234-x-1d-slug.heartbeat.json")).toBeNull();
      expect(monitor.parseFilename("1234-r-none-slug.heartbeat.json")).toBeNull();
      expect(monitor.parseFilename("1234-r-5m-slug.heartbeat.json")).toBeNull(); // below 10m minimum
    });

    it("should return null for too few parts", () => {
      const monitor = new HeartbeatMonitor(testDir, async () => {});
      expect(monitor.parseFilename("1234-r.heartbeat.json")).toBeNull();
      expect(monitor.parseFilename("1234.heartbeat.json")).toBeNull();
    });
  });

  describe("firing one-time heartbeats", () => {
    it("should fire a due one-time heartbeat and move to archive", async () => {
      const data = makeHeartbeatData({ type: "o", interval: null });
      const filename = `${data.epochSeconds}-o-none-test-heartbeat.heartbeat.json`;

      await createHeartbeatFile(filename, data);

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();

      // Wait for the initial poll to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      await monitor.stop();

      expect(firedHeartbeats.length).toBe(1);
      expect(firedHeartbeats[0]!.slug).toBe("test-heartbeat");
      expect(firedHeartbeats[0]!.channelId).toBe("channel-123");
      expect(firedHeartbeats[0]!.userId).toBe("user-456");

      // File should be in archive
      const archiveFiles = await fs.readdir(archiveDir);
      expect(archiveFiles.length).toBe(1);
      expect(archiveFiles[0]).toBe(filename);

      // File should not be in main dir
      const mainFiles = (await fs.readdir(testDir)).filter((f) =>
        f.endsWith(".heartbeat.json"),
      );
      expect(mainFiles.length).toBe(0);
    });

    it("should NOT fire a heartbeat that is not yet due", async () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 86400; // 1 day in future
      const data = makeHeartbeatData({
        epochSeconds: futureEpoch,
        type: "o",
        interval: null,
      });
      const filename = `${futureEpoch}-o-none-future-task.heartbeat.json`;

      await createHeartbeatFile(filename, data);

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(0);

      // File should still be in main dir
      const mainFiles = (await fs.readdir(testDir)).filter((f) =>
        f.endsWith(".heartbeat.json"),
      );
      expect(mainFiles.length).toBe(1);
    });
  });

  describe("firing repeated heartbeats", () => {
    it("should fire a due repeated heartbeat and recreate with new epoch", async () => {
      const pastEpoch = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const data = makeHeartbeatData({
        epochSeconds: pastEpoch,
        type: "r",
        interval: "1d",
        slug: "daily-check",
      });
      const filename = `${pastEpoch}-r-1d-daily-check.heartbeat.json`;

      await createHeartbeatFile(filename, data);

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(1);
      expect(firedHeartbeats[0]!.slug).toBe("daily-check");

      // Original file should be gone
      const fileExists = await fs
        .access(path.join(testDir, filename))
        .then(
          () => true,
          () => false,
        );
      expect(fileExists).toBe(false);

      // New file with future epoch should exist
      const mainFiles = (await fs.readdir(testDir)).filter((f) =>
        f.endsWith(".heartbeat.json"),
      );
      expect(mainFiles.length).toBe(1);

      const newFilename = mainFiles[0]!;
      expect(newFilename).toContain("-r-1d-daily-check.heartbeat.json");

      // The new epoch should be in the future
      const newEpochStr = newFilename.split("-")[0]!;
      const newEpoch = parseInt(newEpochStr, 10);
      expect(newEpoch).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // Verify the new epoch is approximately pastEpoch + 86400
      // (might need multiple jumps if pastEpoch + 86400 is still in the past)
      expect(newEpoch).toBeGreaterThanOrEqual(pastEpoch + 86400);

      // Verify the content was updated
      const newContent = JSON.parse(
        await fs.readFile(path.join(testDir, newFilename), "utf-8"),
      );
      expect(newContent.epochSeconds).toBe(newEpoch);
      expect(newContent.slug).toBe("daily-check");
      expect(newContent.type).toBe("r");
    });

    it("should handle missed repeated heartbeats by jumping forward", async () => {
      // Heartbeat that was due 3 days ago with 1d interval
      const pastEpoch = Math.floor(Date.now() / 1000) - 3 * 86400;
      const data = makeHeartbeatData({
        epochSeconds: pastEpoch,
        type: "r",
        interval: "1d",
        slug: "missed-check",
      });
      const filename = `${pastEpoch}-r-1d-missed-check.heartbeat.json`;

      await createHeartbeatFile(filename, data);

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(1);

      // New file epoch should be in the future (not pastEpoch + 1 day which is still past)
      const mainFiles = (await fs.readdir(testDir)).filter((f) =>
        f.endsWith(".heartbeat.json"),
      );
      expect(mainFiles.length).toBe(1);

      const newEpochStr = mainFiles[0]!.split("-")[0]!;
      const newEpoch = parseInt(newEpochStr, 10);
      expect(newEpoch).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe("multiple heartbeats", () => {
    it("should fire multiple due heartbeats in one poll cycle", async () => {
      const pastEpoch = Math.floor(Date.now() / 1000) - 60;

      const data1 = makeHeartbeatData({
        epochSeconds: pastEpoch,
        slug: "task-one",
        channelId: "ch-1",
      });
      const data2 = makeHeartbeatData({
        epochSeconds: pastEpoch - 10,
        slug: "task-two",
        channelId: "ch-2",
      });

      await createHeartbeatFile(
        `${pastEpoch}-o-none-task-one.heartbeat.json`,
        data1,
      );
      await createHeartbeatFile(
        `${pastEpoch - 10}-o-none-task-two.heartbeat.json`,
        data2,
      );

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(2);

      const slugs = firedHeartbeats.map((hb) => hb.slug).sort();
      expect(slugs).toEqual(["task-one", "task-two"]);

      // Both should be archived
      const archiveFiles = await fs.readdir(archiveDir);
      expect(archiveFiles.length).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should skip non-heartbeat files", async () => {
      await fs.writeFile(path.join(testDir, "readme.txt"), "not a heartbeat");
      await fs.writeFile(
        path.join(testDir, "data.json"),
        '{"not":"heartbeat"}',
      );

      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(0);
    });

    it("should handle empty heartbeat directory", async () => {
      const monitor = new HeartbeatMonitor(testDir, async (hb) => {
        firedHeartbeats.push(hb);
      });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await monitor.stop();

      expect(firedHeartbeats.length).toBe(0);
    });

    it("should create directories on start if they don't exist", async () => {
      const freshDir = path.join(process.cwd(), ".test-heartbeats-fresh");
      await fs.rm(freshDir, { recursive: true, force: true });

      const monitor = new HeartbeatMonitor(freshDir, async () => {});
      await monitor.start();
      await monitor.stop();

      const exists = await fs
        .access(freshDir)
        .then(
          () => true,
          () => false,
        );
      expect(exists).toBe(true);

      const archiveExists = await fs
        .access(path.join(freshDir, "archive"))
        .then(
          () => true,
          () => false,
        );
      expect(archiveExists).toBe(true);

      await fs.rm(freshDir, { recursive: true, force: true });
    });
  });
});
