# Botan-ebi

A Discord bot powered by the [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

> This project is heavily inspired by [tinyclaw](https://github.com/jlia0/tinyclaw)

## Features

- Discord bot with direct message support
- Per-channel AI conversations via pi (session persistence managed by pi)
- Reset commands: `/reset` or `!reset` to start a new session
- Pi manages the LLM session — the bot spawns `pi --mode rpc` as a subprocess

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [pi](https://github.com/earendil-works/pi-coding-agent) installed globally
- API key for your LLM provider (set in env or `~/.pi/agent/auth.json`)

## Installation

```bash
# Clone the repository
git clone https://github.com/dheerapat/botan-ebi.git
cd botan-ebi

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env and add your DISCORD_TOKEN
```

## Environment Configuration

Create a `.env` file with the following settings:

```bash
# Discord Bot Token (required)
DISCORD_TOKEN=your_discord_bot_token_here

# Pi reads API keys from env vars (ANTHROPIC_API_KEY, etc.) or ~/.pi/agent/auth.json

# Optional: Override the provider and model
# PI_PROVIDER=anthropic
# PI_MODEL=claude-sonnet-4-20250514

# Optional: Pi session storage directory (default: .pi/sessions)
# PI_SESSION_DIR=.pi/sessions

# Optional: Production settings
MAX_MESSAGE_LENGTH=10000
MAX_QUEUE_DEPTH=50
RATE_LIMIT_PER_MINUTE=10
```

## Usage

### Quick Start (Recommended)

```bash
# Start the bot (pi agent is managed as a subprocess)
./bootstrap.sh start

# Check status
./bootstrap.sh status

# View logs
./bootstrap.sh logs

# Stop the bot
./bootstrap.sh stop

# Restart
./bootstrap.sh restart
```

### Manual Start

```bash
bun run start
```

## Testing

```bash
bun test
```

## Architecture

### Project Structure

```
botan-ebi/
├── src/
│   ├── adapters/
│   │   ├── agents/
│   │   │   └── pi/
│   │   │       └── rpc-agent.ts    # Pi RPC subprocess adapter
│   │   └── channels/
│   │       ├── input/discord.ts
│   │       └── output/discord.ts
│   ├── interfaces/
│   │   └── adapter.ts              # IAgentAdapter, IInputAdapter, IOutputAdapter
│   ├── kernel/
│   │   ├── kernel.ts               # Orchestrator: message loop between adapters
│   │   ├── queue-manager.ts        # File-based persistent queue
│   │   ├── heartbeat-monitor.ts    # Scheduled message system
│   │   └── channel-context.ts      # Last channel tracker
│   ├── config/
│   │   └── env.ts                  # Environment validation
│   ├── utils/
│   │   ├── rate-limiter.ts
│   │   ├── retry.ts
│   │   ├── validation.ts
│   │   └── discord-message-splitter.ts
│   └── index.ts
├── bootstrap.sh                    # Process manager (bot only)
├── package.json
└── tsconfig.json
```

### Components

- **DiscordAdapter**: Handles Discord input and output with rate limiting
- **PiRpcAgent**: Spawns `pi --mode rpc` as subprocess, communicates via JSONL
- **Kernel**: Orchestrates message flow between adapters and agent
- **QueueManager**: File-based persistent queue system for message durability
- **HeartbeatMonitor**: Filesystem-watch based scheduled reminders
- **RateLimiter**: Per-channel rate limiting to prevent abuse

### Message Flow

1. Discord message → DiscordInputAdapter → Incoming Queue
2. Kernel picks message → PiRpcAgent processes (via RPC subprocess) → Outgoing Queue
3. Output Adapter picks response → Discord channel

Pi manages LLM sessions natively. Each Discord channel maps to a Pi session file. Session persistence, retry logic, and model configuration are handled by pi — the bot only manages the subprocess lifecycle and channel-to-session routing.
