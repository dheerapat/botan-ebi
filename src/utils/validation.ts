import type { MessagePacket } from "+interfaces/adapter";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ValidationOptions {
  maxMessageLength: number;
}

export function validateMessagePacket(
  packet: MessagePacket,
  options: ValidationOptions,
): ValidationResult {
  if (!packet.id || typeof packet.id !== "string") {
    return { valid: false, error: "Invalid message ID" };
  }

  if (!packet.source || typeof packet.source !== "string") {
    return { valid: false, error: "Invalid source" };
  }

  if (!packet.channelId || typeof packet.channelId !== "string") {
    return { valid: false, error: "Invalid channel ID" };
  }

  if (!packet.userId || typeof packet.userId !== "string") {
    return { valid: false, error: "Invalid user ID" };
  }

  if (!packet.payload || typeof packet.payload !== "string") {
    return { valid: false, error: "Invalid payload" };
  }

  if (packet.payload.length > options.maxMessageLength) {
    return {
      valid: false,
      error: `Message too long (max ${options.maxMessageLength} characters)`,
    };
  }

  if (!packet.timestamp || typeof packet.timestamp !== "number") {
    return { valid: false, error: "Invalid timestamp" };
  }

  return { valid: true };
}
