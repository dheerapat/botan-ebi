# Botan-ebi

A Discord bot powered by the opencode AI agent.

> This project is heavily inspired by [tinyclaw](https://github.com/jlia0/tinyclaw)

## Features

- Discord bot with direct message support
- Per-channel AI conversations via opencode
- Session persistence across restarts
- Reset commands: `/reset` or `!reset` to start a new session

## Installation

*This project is designed to be used together with [opencode-assistant](https://github.com/dheerapat/opencode-assistant). You can modify `src/adapter/agent` to add a new agent adapter of your choice.*

```bash
mkdir assistant
cd assistant
git clone https://github.com/dheerapat/opencode-assistant.git
git clone https://github.com/dheerapat/botan-ebi.git
```

Now `cd` into each directory to set up both projects:

```bash
# In opencode-assistant directory
cd opencode-assistant
cp .opencode/opencode.jsonc.example .opencode/opencode.jsonc
./setup.sh
```

```bash
# In botan-ebi directory
cd botan-ebi
bun install
```

## Configuration

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

Start the opencode server:

```bash
# In opencode-assistant directory
opencode serve
```

In another terminal, start the Discord bot:

```bash
# In botan-ebi directory
bun run start
```

## Testing

```bash
bun test
```

## Architecture

- **DiscordAdapter**: Handles Discord input and output
- **OpencodeAgent**: Processes messages via the opencode API
- **QueueManager**: File-based persistent queue system
- **SessionManager**: Manages per-channel session persistence
