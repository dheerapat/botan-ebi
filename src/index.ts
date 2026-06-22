import PiRpcAgent from "+adapters/agents/pi/rpc-agent.js";
import { DiscordInputAdapter } from "+adapters/channels/input/discord.js";
import { DiscordOutputAdapter } from "+adapters/channels/output/discord.js";
import { Kernel } from "+kernel/kernel.js";
import { validateEnv } from "+config/env.js";

let env;
try {
  env = validateEnv();
  console.log("✅ Environment validated");
} catch (error) {
  if (error instanceof Error) {
    console.error(`❌ Environment validation failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(1);
}

if (!env) {
  console.error("❌ Environment validation failed: no environment config");
  process.exit(1);
}

const discordInputAdapter = new DiscordInputAdapter({
  maxMessageLength: env.MAX_MESSAGE_LENGTH,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
});
const discordOutputAdapter = new DiscordOutputAdapter(
  discordInputAdapter.getClient(),
);
const piAgent = new PiRpcAgent({
  provider: env.PI_PROVIDER,
  model: env.PI_MODEL,
  sessionDir: env.PI_SESSION_DIR,
});

const kernel = new Kernel(
  [discordInputAdapter],
  [discordOutputAdapter],
  [piAgent],
  env.MAX_QUEUE_DEPTH,
);
kernel.bootstrap(
  discordInputAdapter.name,
  discordOutputAdapter.name,
  piAgent.name,
);

process.on("SIGINT", () => kernel.shutdown());
process.on("SIGTERM", () => kernel.shutdown());
