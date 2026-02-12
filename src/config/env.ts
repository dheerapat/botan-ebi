export interface EnvConfig {
  DISCORD_TOKEN: string;
  OPENCODE_BASE_URL: string;
  OPENCODE_PROVIDER_ID?: string;
  OPENCODE_MODEL_ID?: string;
  MAX_MESSAGE_LENGTH?: number;
  MAX_QUEUE_DEPTH?: number;
  RATE_LIMIT_PER_MINUTE?: number;
}

export function validateEnv(): EnvConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  const opencodeBaseUrl = process.env.OPENCODE_BASE_URL;

  if (!discordToken || !opencodeBaseUrl) {
    const missing: string[] = [];
    if (!discordToken) missing.push("DISCORD_TOKEN");
    if (!opencodeBaseUrl) missing.push("OPENCODE_BASE_URL");
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  const config: EnvConfig = {
    DISCORD_TOKEN: discordToken,
    OPENCODE_BASE_URL: opencodeBaseUrl,
    OPENCODE_PROVIDER_ID: process.env.OPENCODE_PROVIDER_ID,
    OPENCODE_MODEL_ID: process.env.OPENCODE_MODEL_ID,
    MAX_MESSAGE_LENGTH: parseInt(
      process.env.MAX_MESSAGE_LENGTH || "10000",
      10,
    ),
    MAX_QUEUE_DEPTH: parseInt(process.env.MAX_QUEUE_DEPTH || "50", 10),
    RATE_LIMIT_PER_MINUTE: parseInt(
      process.env.RATE_LIMIT_PER_MINUTE || "10",
      10,
    ),
  };

  return config;
}
