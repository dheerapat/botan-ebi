import { tool } from "@opencode-ai/plugin";
import fs from "fs/promises";
import path from "path";

export default tool({
  description: `Create a heartbeat (scheduled reminder/notification) that will fire at a specific time and optionally repeat.

The heartbeat system allows you to schedule messages to be sent to a Discord channel at a future time.

**Filename convention:** {epochSeconds}-{r|o}-{interval|none}-{slug}.heartbeat.json
- "r" = repeated heartbeat, "o" = one-time heartbeat
- interval examples: 10m, 30m, 1h, 6h, 1d, 7d (minimum 10 minutes)
- slug: short kebab-case description

**Examples:**
- Daily 8am reminder: epochSeconds=1752300232, type="r", interval="1d", slug="check-email"
- One-time meeting prep: epochSeconds=1752300232, type="o", interval left empty, slug="meeting-prep"

Use the bash tool to determine the current unix epoch if needed (e.g. \`date +%s\`).
`,
  args: {
    epochSeconds: tool.schema
      .number()
      .describe(
        "Unix epoch in seconds for when the heartbeat should first fire",
      ),
    type: tool.schema
      .enum(["r", "o"])
      .describe('Heartbeat type: "r" for repeated, "o" for one-time'),
    interval: tool.schema
      .string()
      .optional()
      .describe(
        'Repeat interval (required if type is "r"). Format: {number}{unit} where unit is m (minutes, min 10), h (hours), or d (days). Examples: 10m, 30m, 1h, 6h, 1d, 7d',
      ),
    slug: tool.schema
      .string()
      .describe(
        "Short kebab-case description for the heartbeat, e.g. check-email, standup-reminder",
      ),
    message: tool.schema
      .string()
      .describe(
        "Full context message that will be sent back to you when the heartbeat fires. Write a detailed prompt so you can craft a natural reminder when you receive it. Include what the user asked for and any relevant context.",
      ),
  },
  async execute(args, context) {
    // Validate interval for repeated heartbeats
    if (args.type === "r" && !args.interval) {
      return "Error: interval is required for repeated heartbeats (type 'r'). Provide an interval like 10m, 1h, or 1d.";
    }

    if (args.interval) {
      const match = args.interval.match(/^(\d+)(m|h|d)$/);
      if (!match) {
        return "Error: invalid interval format. Use {number}{unit} where unit is m (minutes), h (hours), or d (days). Examples: 10m, 1h, 1d";
      }

      const value = parseInt(match[1]!, 10);
      const unit = match[2]!;

      if (unit === "m" && value < 10) {
        return "Error: minimum interval is 10 minutes (10m).";
      }

      if (value <= 0) {
        return "Error: interval value must be positive.";
      }
    }

    // Validate slug format
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.slug)) {
      return "Error: slug must be kebab-case (lowercase letters, numbers, and hyphens). Example: check-email, daily-standup";
    }

    // Build filename
    const intervalPart = args.type === "r" ? args.interval : "none";
    const filename = `${args.epochSeconds}-${args.type}-${intervalPart}-${args.slug}.heartbeat.json`;

    // Build heartbeat data
    const heartbeatData = {
      epochSeconds: args.epochSeconds,
      type: args.type,
      interval: args.interval || null,
      slug: args.slug,
      message: args.message,
      createdAt: Math.floor(Date.now() / 1000),
    };

    // Write to heartbeat directory
    const heartbeatDir = path.join(
      context.worktree,
      "opencode-assistant",
      "heartbeat",
    );
    await fs.mkdir(heartbeatDir, { recursive: true });

    const filePath = path.join(heartbeatDir, filename);
    await fs.writeFile(filePath, JSON.stringify(heartbeatData, null, 2));

    // Build confirmation
    const fireDate = new Date(args.epochSeconds * 1000);
    const typeLabel =
      args.type === "r" ? `repeated every ${args.interval}` : "one-time";

    return `Heartbeat created successfully.
- File: ${filename}
- Fires at: ${fireDate.toISOString()}
- Type: ${typeLabel}
- Slug: ${args.slug}`;
  },
});
