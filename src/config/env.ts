export interface EnvConfig {
  DISCORD_TOKEN: string;
  PI_PROVIDER?: string;
  PI_MODEL?: string;
  PI_SESSION_DIR?: string;
  MAX_MESSAGE_LENGTH?: number;
  MAX_QUEUE_DEPTH?: number;
  RATE_LIMIT_PER_MINUTE?: number;
}

export function validateEnv(): EnvConfig {
  const discordToken = process.env.DISCORD_TOKEN;

  if (!discordToken) {
    throw new Error("Missing required environment variable: DISCORD_TOKEN");
  }

  const config: EnvConfig = {
    DISCORD_TOKEN: discordToken,
    PI_PROVIDER: process.env.PI_PROVIDER,
    PI_MODEL: process.env.PI_MODEL,
    PI_SESSION_DIR: process.env.PI_SESSION_DIR,
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
