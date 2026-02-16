import fs from "fs/promises";
import path from "path";

interface QueuedItem<T> {
  id: string;
  data: T;
  timestamp: number;
}

export class QueueManager {
  private basePath: string;
  private queues: Set<string> = new Set();
  private queueDepths: Map<string, number> = new Map();

  constructor(basePath: string = ".lobster/queues") {
    this.basePath = basePath;
  }

  getQueueDepth(queueName: string): number {
    return this.queueDepths.get(queueName) || 0;
  }

  async refreshQueueDepth(queueName: string): Promise<void> {
    await this.registerQueue(queueName);
    const queueDir = path.join(this.basePath, queueName);
    try {
      const files = await fs.readdir(queueDir);
      const jsonCount = files.filter((f) => f.endsWith(".json")).length;
      this.queueDepths.set(queueName, jsonCount);
    } catch (e) {
      this.queueDepths.set(queueName, 0);
    }
  }

  async registerQueue(name: string) {
    if (this.queues.has(name)) return;

    const dirs = [
      path.join(this.basePath, name),
      path.join(this.basePath, `${name}_processing`),
      path.join(this.basePath, `${name}_done`),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    this.queues.add(name);

    await this.refreshQueueDepth(name);
  }

  async enqueue<T>(queueName: string, data: T): Promise<string> {
    await this.registerQueue(queueName);

    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = `${id}.json`;
    const filePath = path.join(this.basePath, queueName, fileName);

    const item: QueuedItem<T> = {
      id,
      data,
      timestamp: Date.now(),
    };

    await fs.writeFile(filePath, JSON.stringify(item, null, 2));

    const currentDepth = this.queueDepths.get(queueName) || 0;
    this.queueDepths.set(queueName, currentDepth + 1);

    return id;
  }

  async dequeue<T>(queueName: string): Promise<QueuedItem<T> | null> {
    await this.registerQueue(queueName);

    const pendingDir = path.join(this.basePath, queueName);
    const processingDir = path.join(this.basePath, `${queueName}_processing`);

    let files: string[];
    try {
      files = await fs.readdir(pendingDir);
    } catch (e) {
      return null;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) return null;

    jsonFiles.sort();

    const oldestFile = jsonFiles[0]!;
    const sourcePath = path.join(pendingDir, oldestFile);
    const targetPath = path.join(processingDir, oldestFile);

    try {
      await fs.rename(sourcePath, targetPath);

      const content = await fs.readFile(targetPath, "utf-8");
      const item: QueuedItem<T> = JSON.parse(content);

      const currentDepth = this.queueDepths.get(queueName) || 0;
      this.queueDepths.set(queueName, Math.max(0, currentDepth - 1));

      return item;
    } catch (error) {
      console.error(`Error moving/reading queue file ${oldestFile}:`, error);
      return null;
    }
  }

  async complete(queueName: string, itemId: string): Promise<void> {
    const processingDir = path.join(this.basePath, `${queueName}_processing`);
    const doneDir = path.join(this.basePath, `${queueName}_done`);

    const fileName = `${itemId}.json`;
    const sourcePath = path.join(processingDir, fileName);
    const targetPath = path.join(doneDir, fileName);

    try {
      await fs.rename(sourcePath, targetPath);
    } catch (error) {
      console.warn(`Could not complete item ${itemId}:`, error);
    }
  }

  async cleanup(
    queueName: string,
    olderThanMs: number = 7 * 24 * 60 * 60 * 1000,
  ) {
    const doneDir = path.join(this.basePath, `${queueName}_done`);
  }
}
