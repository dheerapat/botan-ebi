# Botan-ebi

A Discord bot powered by the opencode AI agent.

> This project is heavily inspired by [tinyclaw](https://github.com/jlia0/tinyclaw)

## Features

- Discord bot with direct message support
- Per-channel AI conversations via opencode
- Session persistence across restarts
- Reset commands: `/reset` or `!reset` to start a new session

## Installation

The opencode server is now bundled with the bot in the `opencode-assistant` directory.

```bash
# Clone the repository
git clone https://github.com/dheerapat/botan-ebi.git
cd botan-ebi

# Install dependencies
bun install

# Set up opencode configuration
cd opencode-assistant
cp .opencode/opencode.jsonc.example .opencode/opencode.jsonc
./setup.sh
cd ..
```

Create a `.env` file from the example and add your Discord token:

```bash
cp .env.example .env
# Edit .env and add your DISCORD_TOKEN
```

## Opencode Configuration

The opencode server is configured in `opencode-assistant/.opencode/opencode.jsonc`.

### MCP Servers Included:
- **graph-memory**: Persistent memory for user preferences and context
- **brave-search**: Web search capabilities for real-time information
- **chrome-devtools**: Browser automation for web scraping

### Assistant Persona:
The bot uses a "professional personal assistant" persona that:
- Addresses users as "Sir" (configurable)
- Maintains a polished, solution-first approach
- Provides dry, witty responses when appropriate
- Prioritizes privacy and safety

### Customization:
To customize the assistant, edit `opencode-assistant/.opencode/prompts/assistant.txt`.

## Environment Configuration

Create a `.env` file with the following settings:

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

### Quick Start (Recommended)

The bootstrap script manages both the opencode server and Discord bot:

```bash
# Start both services
./bootstrap.sh start

# Check status
./bootstrap.sh status

# View logs
./bootstrap.sh logs

# Stop both services
./bootstrap.sh stop

# Restart both services
./bootstrap.sh restart
```

The bootstrap script:
- Starts the opencode server (port 4096)
- Starts the Discord bot once opencode is ready
- Tracks PIDs for graceful shutdown
- Manages logs in the `logs/` directory
- Performs health checks on startup

### Manual Start (Advanced)

If you prefer to manage processes manually:

**Terminal 1 - Start opencode server:**
```bash
cd opencode-assistant
opencode serve
```

**Terminal 2 - Start Discord bot:**
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
├── opencode-assistant/    # Bundled opencode server configuration
│   ├── .opencode/         # Opencode config and prompts
│   ├── setup.sh           # Initial setup script
│   └── README.md
├── src/                   # Bot source code
│   ├── adapters/          # Discord and Opencode integrations
│   ├── interfaces/        # Adapter contracts
│   ├── kernel/            # Main orchestrator and queue system
│   ├── utils/             # Rate limiting, retry, validation
│   └── config/            # Environment validation
├── logs/                  # Service logs (created on startup)
├── .botan-ebi/            # Queue files and PID tracking
├── bootstrap.sh           # Service management script
└── package.json
```

### Components

- **DiscordAdapter**: Handles Discord input and output with rate limiting
- **OpencodeAgent**: Processes messages via the opencode API with session management
- **Kernel**: Orchestrates message flow between adapters and agents
- **QueueManager**: File-based persistent queue system for message durability
- **SessionManager**: Manages per-channel session persistence across restarts
- **RateLimiter**: Per-channel rate limiting to prevent abuse
- **RetryWithBackoff**: Exponential backoff for resilient API calls

### Message Flow
1. Discord message → DiscordInputAdapter → Incoming Queue
2. Kernel picks message → OpencodeAgent processes → Outgoing Queue
3. Output Adapter picks response → Discord channel

### Persistence
- **Sessions**: `.botan-ebi/sessions.json` - Maps Discord channels to opencode sessions
- **Queues**: `.botan-ebi/queues/` - Pending/processing/done message queues
- **PIDs**: `.botan-ebi/pids.json` - Process tracking for graceful shutdown
- **Logs**: `logs/` - opencode and bot logs
