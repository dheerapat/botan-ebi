import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { QueueManager } from "../src/kernel/queue-manager.js";
import fs from "fs/promises";
import path from "path";

describe("QueueManager", () => {
  let queueManager: QueueManager;
  let testBasePath: string;

  beforeEach(async () => {
    testBasePath = path.join(process.cwd(), ".test-queues");
    queueManager = new QueueManager(testBasePath);

    await fs.rm(testBasePath, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(testBasePath, { recursive: true, force: true });
  });

  describe("enqueue", () => {
    it("should add an item to the queue and return an ID", async () => {
      const testData = { message: "test data" };
      const id = await queueManager.enqueue("test-queue", testData);

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      const queueDir = path.join(testBasePath, "test-queue");
      const files = await fs.readdir(queueDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe(`${id}.json`);
    });

    it("should create queue directories if they don't exist", async () => {
      await queueManager.enqueue("new-queue", { data: "test" });

      const queueDir = path.join(testBasePath, "new-queue");
      const processingDir = path.join(testBasePath, "new-queue_processing");
      const doneDir = path.join(testBasePath, "new-queue_done");

      expect(await fs.access(queueDir).then(() => true, () => false)).toBeTrue();
      expect(await fs.access(processingDir).then(() => true, () => false)).toBeTrue();
      expect(await fs.access(doneDir).then(() => true, () => false)).toBeTrue();
    });
  });

  describe("dequeue", () => {
    it("should return null when queue is empty", async () => {
      const result = await queueManager.dequeue("empty-queue");
      expect(result).toBeNull();
    });

    it("should return the oldest item from the queue", async () => {
      const testData1 = { id: 1, message: "first" };
      const testData2 = { id: 2, message: "second" };

      await queueManager.enqueue("fifo-queue", testData1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await queueManager.enqueue("fifo-queue", testData2);

      const firstItem = await queueManager.dequeue("fifo-queue");
      expect(firstItem).toBeDefined();
      expect(firstItem!.data).toEqual(testData1);

      const secondItem = await queueManager.dequeue("fifo-queue");
      expect(secondItem).toBeDefined();
      expect(secondItem!.data).toEqual(testData2);
    });

    it("should move item from pending to processing directory", async () => {
      const testData = { message: "test" };
      const id = await queueManager.enqueue("move-queue", testData);

      const pendingDir = path.join(testBasePath, "move-queue");
      const processingDir = path.join(testBasePath, "move-queue_processing");

      let pendingFiles = await fs.readdir(pendingDir);
      expect(pendingFiles.length).toBe(1);

      await queueManager.dequeue("move-queue");

      pendingFiles = await fs.readdir(pendingDir);
      const processingFiles = await fs.readdir(processingDir);

      expect(pendingFiles.length).toBe(0);
      expect(processingFiles.length).toBe(1);
      expect(processingFiles[0]).toBe(`${id}.json`);
    });
  });

  describe("complete", () => {
    it("should move item from processing to done directory", async () => {
      const testData = { message: "test" };
      const id = await queueManager.enqueue("complete-queue", testData);
      await queueManager.dequeue("complete-queue");

      const processingDir = path.join(testBasePath, "complete-queue_processing");
      const doneDir = path.join(testBasePath, "complete-queue_done");

      let processingFiles = await fs.readdir(processingDir);
      expect(processingFiles.length).toBe(1);

      await queueManager.complete("complete-queue", id);

      processingFiles = await fs.readdir(processingDir);
      const doneFiles = await fs.readdir(doneDir);

      expect(processingFiles.length).toBe(0);
      expect(doneFiles.length).toBe(1);
      expect(doneFiles[0]).toBe(`${id}.json`);
    });

    it("should not throw error if item doesn't exist", async () => {
      await queueManager.complete("non-existent", "fake-id");
    });
  });

  describe("end-to-end workflow", () => {
    it("should handle complete enqueue -> dequeue -> complete cycle", async () => {
      const testData = {
        id: "123",
        source: "test",
        channelId: "channel-1",
        userId: "user-1",
        payload: "Hello, world!",
        timestamp: Date.now(),
      };

      const id = await queueManager.enqueue("workflow-queue", testData);
      const queuedItem = await queueManager.dequeue("workflow-queue");

      expect(queuedItem).toBeDefined();
      expect(queuedItem!.id).toBe(id);
      expect(queuedItem!.data).toEqual(testData);
      expect(queuedItem!.timestamp).toBeLessThanOrEqual(Date.now());

      await queueManager.complete("workflow-queue", id);

      const pendingDir = path.join(testBasePath, "workflow-queue");
      const processingDir = path.join(
        testBasePath,
        "workflow-queue_processing",
      );
      const doneDir = path.join(testBasePath, "workflow-queue_done");

      expect((await fs.readdir(pendingDir)).length).toBe(0);
      expect((await fs.readdir(processingDir)).length).toBe(0);
      expect((await fs.readdir(doneDir)).length).toBe(1);
    });
  });

  describe("getQueueDepth", () => {
    it("should return 0 for new empty queue", async () => {
      const depth = queueManager.getQueueDepth("new-queue");
      expect(depth).toBe(0);
    });

    it("should count existing files on disk after registration", async () => {
      const queueDir = path.join(testBasePath, "existing-queue");
      await fs.mkdir(queueDir, { recursive: true });

      const file1 = path.join(queueDir, "msg1.json");
      const file2 = path.join(queueDir, "msg2.json");
      await fs.writeFile(file1, '{"test":1}');
      await fs.writeFile(file2, '{"test":2}');

      const newQueueManager = new QueueManager(testBasePath);
      await newQueueManager.refreshQueueDepth("existing-queue");
      const depth = newQueueManager.getQueueDepth("existing-queue");
      expect(depth).toBe(2);
    });

    it("should track depth incrementally during enqueue", async () => {
      await queueManager.enqueue("depth-queue", { data: "1" });
      expect(queueManager.getQueueDepth("depth-queue")).toBe(1);

      await queueManager.enqueue("depth-queue", { data: "2" });
      expect(queueManager.getQueueDepth("depth-queue")).toBe(2);

      await queueManager.enqueue("depth-queue", { data: "3" });
      expect(queueManager.getQueueDepth("depth-queue")).toBe(3);
    });

    it("should decrement depth during dequeue", async () => {
      await queueManager.enqueue("dequeue-queue", { data: "1" });
      await queueManager.enqueue("dequeue-queue", { data: "2" });

      expect(queueManager.getQueueDepth("dequeue-queue")).toBe(2);

      await queueManager.dequeue("dequeue-queue");
      expect(queueManager.getQueueDepth("dequeue-queue")).toBe(1);

      await queueManager.dequeue("dequeue-queue");
      expect(queueManager.getQueueDepth("dequeue-queue")).toBe(0);
    });

    it("should ignore non-JSON files in count", async () => {
      const queueDir = path.join(testBasePath, "mixed-queue");
      await fs.mkdir(queueDir, { recursive: true });

      await fs.writeFile(path.join(queueDir, "msg1.json"), '{"test":1}');
      await fs.writeFile(path.join(queueDir, "msg2.json"), '{"test":2}');
      await fs.writeFile(path.join(queueDir, "readme.txt"), 'text file');
      await fs.writeFile(path.join(queueDir, ".gitkeep"), '');

      const newQueueManager = new QueueManager(testBasePath);
      await newQueueManager.refreshQueueDepth("mixed-queue");
      const depth = newQueueManager.getQueueDepth("mixed-queue");
      expect(depth).toBe(2);
    });
  });
});
