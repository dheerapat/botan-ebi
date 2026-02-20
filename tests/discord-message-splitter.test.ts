import { describe, it, expect } from "bun:test";
import { splitMessage } from "../src/utils/discord-message-splitter.js";

describe("discord-message-splitter", () => {
  describe("basic functionality", () => {
    it("should return single chunk for short message", () => {
      const message = "Hello world";
      const result = splitMessage(message);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(message);
    });

    it("should split long message into chunks", () => {
      const message = "a".repeat(2500);
      const result = splitMessage(message, { maxLength: 1000 });
      expect(result.length).toBeGreaterThan(1);
      expect(result.every((chunk) => chunk.length <= 1000)).toBe(true);
    });

    it("should use default maxLength of 2000", () => {
      const message = "a".repeat(2500);
      const result = splitMessage(message);
      expect(result.every((chunk) => chunk.length <= 2000)).toBe(true);
    });
  });

  describe("splitting behavior", () => {
    it("should prefer to split at newlines", () => {
      const message = "line1\n".repeat(50);
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]?.endsWith("\n")).toBe(true);
    });

    it("should split at spaces when no newlines available", () => {
      const message = "word ".repeat(100);
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]?.endsWith(" ")).toBe(true);
    });

    it("should split at exact length when no delimiters available", () => {
      const message = "a".repeat(500);
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]?.length).toBeLessThanOrEqual(200);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe("code blocks", () => {
    it("should not split inside code blocks", () => {
      const message = "```typescript\n" + "const x = 1;\n".repeat(100) + "```";
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]?.includes("```typescript")).toBe(true);
      expect(result[0]?.includes("```")).toBe(true);
      expect(
        result[0]?.includes("```") && result[0]?.includes("*[code truncated]*"),
      ).toBe(true);
    });

    it("should truncate code block markers", () => {
      const message = "```typescript\n" + "const x = 1;\n".repeat(100) + "```";
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]).toContain("*[code truncated]*");
      expect(result[0]).toContain("```");
    });

    it("should handle multiple code blocks", () => {
      const message = "text```block1```text```block2```text";
      const result = splitMessage(message, { maxLength: 30 });
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe("inline code", () => {
    it("should not split inside inline code", () => {
      const message = "Some `code here` text";
      const result = splitMessage(message, { maxLength: 50 });
      expect(
        result[0]?.includes("`code here`") ||
          result[1]?.includes("`code here`"),
      ).toBe(true);
    });

    it("should distinguish inline from code blocks", () => {
      const message = "inline `code` and ```block```";
      const result = splitMessage(message, { maxLength: 50 });
      expect(result.some((chunk) => chunk.includes("`code`"))).toBe(true);
      expect(result.some((chunk) => chunk.includes("```block```"))).toBe(true);
    });
  });

  describe("prepend and append", () => {
    it("should add prepend to each chunk", () => {
      const message = "a".repeat(3000);
      const prepend = "[START]";
      const result = splitMessage(message, { maxLength: 1000, prepend });
      expect(result.every((chunk) => chunk.startsWith(prepend))).toBe(true);
    });

    it("should add append to each chunk", () => {
      const message = "a".repeat(3000);
      const append = "[END]";
      const result = splitMessage(message, { maxLength: 1000, append });
      expect(result.every((chunk) => chunk.endsWith(append))).toBe(true);
    });

    it("should add both prepend and append", () => {
      const message = "a".repeat(3000);
      const prepend = "[START]";
      const append = "[END]";
      const result = splitMessage(message, {
        maxLength: 1000,
        prepend,
        append,
      });
      expect(
        result.every(
          (chunk) => chunk.startsWith(prepend) && chunk.endsWith(append),
        ),
      ).toBe(true);
    });

    it("should account for prepend/append in chunk size", () => {
      const message = "a".repeat(3000);
      const prepend = "[START]";
      const append = "[END]";
      const maxLength = 1000;
      const result = splitMessage(message, { maxLength, prepend, append });
      expect(result.every((chunk) => chunk.length <= maxLength)).toBe(true);
    });

    it("should throw if prepend+append exceed maxLength", () => {
      const message = "a".repeat(3000);
      const prepend = "[START]";
      const append = "[END]";
      expect(() =>
        splitMessage(message, { maxLength: 5, prepend, append }),
      ).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const result = splitMessage("");
      expect(result).toEqual([""]);
    });

    it("should handle single character", () => {
      const result = splitMessage("a");
      expect(result).toEqual(["a"]);
    });

    it("should handle message exactly at maxLength", () => {
      const message = "a".repeat(2000);
      const result = splitMessage(message, { maxLength: 2000 });
      expect(result).toHaveLength(1);
    });

    it("should handle message one over maxLength", () => {
      const message = "a".repeat(2001);
      const result = splitMessage(message, { maxLength: 2000 });
      expect(result.length).toBe(2);
    });

    it("should handle newlines at split point", () => {
      const message = "line1\nline2\nline3".repeat(100);
      const result = splitMessage(message, { maxLength: 100 });
      result.forEach((chunk) => {
        expect(chunk).not.toMatch(/^\n/);
      });
    });
  });

  describe("truncation marker", () => {
    it("should include truncation marker for cut code blocks", () => {
      const message = "```typescript\n" + "const x = 1;\n".repeat(100) + "```";
      const result = splitMessage(message, { maxLength: 200 });
      expect(result[0]).toContain("*[code truncated]*");
    });

    it("should continue after truncated code block", () => {
      const message =
        "```typescript\n" + "const x = 1;\n".repeat(100) + "```\nmore text";
      const result = splitMessage(message, { maxLength: 200 });
      expect(result.length).toBeGreaterThan(1);
      expect(result[result.length - 1]).toContain("more text");
    });
  });
});
