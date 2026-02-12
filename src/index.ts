import OpencodeAgent from "./adapters/agents/opencode/opencode.js";
import { DiscordInputAdapter } from "./adapters/channels/input/discord.js";
import { DiscordOutputAdapter } from "./adapters/channels/output/discord.js";
import { Kernel } from "./kernel/kernel.js";

const discordInputAdapter = new DiscordInputAdapter();
const discordOutputAdapter = new DiscordOutputAdapter(
  discordInputAdapter.getClient(),
);
const opencodeAgent = new OpencodeAgent();

const kernel = new Kernel(
  [discordInputAdapter],
  [discordOutputAdapter],
  [opencodeAgent],
);
kernel.bootstrap(
  discordInputAdapter.name,
  discordOutputAdapter.name,
  opencodeAgent.name,
);

process.on("SIGINT", () => kernel.shutdown());
process.on("SIGTERM", () => kernel.shutdown());
