# Lobster 

Bot powered by opencode AI agent.

> This project is heavily influenced by [tinyclaw](https://github.com/jlia0/tinyclaw)

## Features

- Discord bot with direct message support
- Per-channel AI conversations using opencode
- Session persistence across restarts
- Reset commands: `/reset` or `!reset` to start fresh

## Installation

```bash
bun install
```

## Configuration

Create a `.env` file with:

```bash
# Discord Bot Token (required)
DISCORD_TOKEN=your_discord_bot_token_here

# Opencode Configuration
OPENCODE_BASE_URL=http://localhost:4096

# Optional: Override model
# OPENCODE_PROVIDER_ID=zai-coding-plan
# OPENCODE_MODEL_ID=glm-4.7

# Optional: Production settings
# Maximum message length in characters (default: 10000)
MAX_MESSAGE_LENGTH=10000

# Maximum queue depth before backpressure kicks in (default: 50)
MAX_QUEUE_DEPTH=50

# Rate limit per channel per minute (default: 10)
RATE_LIMIT_PER_MINUTE=10
```

## Usage

Start the opencode server:
```bash
opencode serve
```

In another terminal, start the Discord bot:
```bash
bun run start
```

## Testing

```bash
bun test
```

## Architecture

- **DiscordAdapter**: Handles Discord input/output
- **OpencodeAgent**: Processes messages via opencode API
- **QueueManager**: File-based persistent queue system
- **SessionManager**: Manages per-channel session persistence
