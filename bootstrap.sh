#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_DIR="$SCRIPT_DIR/opencode-assistant"
OPENCODE_PID_FILE="$SCRIPT_DIR/.opencode.pid"
BOT_PID_FILE="$SCRIPT_DIR/.bot.pid"
OPENCODE_LOG="$SCRIPT_DIR/.opencode.log"
BOT_LOG="$SCRIPT_DIR/.bot.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

is_running() {
  local pid_file=$1
  if [[ -f "$pid_file" ]]; then
    local pid=$(cat "$pid_file")
    if ps -p "$pid" > /dev/null 2>&1; then
      return 0
    else
      rm -f "$pid_file"
    fi
  fi
  return 1
}

start_opencode() {
  if is_running "$OPENCODE_PID_FILE"; then
    log "Opencode server is already running (PID: $(cat $OPENCODE_PID_FILE))"
    return 1
  fi

  log "Starting opencode server in $OPENCODE_DIR"
  cd "$OPENCODE_DIR" || { log "Failed to cd to $OPENCODE_DIR"; return 1; }
  
  nohup opencode serve >> "$OPENCODE_LOG" 2>&1 &
  local pid=$!
  echo $pid > "$OPENCODE_PID_FILE"
  
  cd "$SCRIPT_DIR"
  sleep 2
  
  if is_running "$OPENCODE_PID_FILE"; then
    log "Opencode server started (PID: $pid)"
    return 0
  else
    log "Failed to start opencode server"
    rm -f "$OPENCODE_PID_FILE"
    return 1
  fi
}

start_bot() {
  if is_running "$BOT_PID_FILE"; then
    log "Bot is already running (PID: $(cat $BOT_PID_FILE))"
    return 1
  fi

  log "Starting bot"
  cd "$SCRIPT_DIR" || { log "Failed to cd to $SCRIPT_DIR"; return 1; }
  
  nohup bun run src/index.ts >> "$BOT_LOG" 2>&1 &
  local pid=$!
  echo $pid > "$BOT_PID_FILE"
  
  sleep 2
  
  if is_running "$BOT_PID_FILE"; then
    log "Bot started (PID: $pid)"
    return 0
  else
    log "Failed to start bot"
    rm -f "$BOT_PID_FILE"
    return 1
  fi
}

stop_opencode() {
  if ! is_running "$OPENCODE_PID_FILE"; then
    log "Opencode server is not running"
    return 1
  fi

  local pid=$(cat "$OPENCODE_PID_FILE")
  log "Stopping opencode server (PID: $pid)"
  
  kill "$pid" 2>/dev/null
  
  local count=0
  while ps -p "$pid" > /dev/null 2>&1 && [[ $count -lt 10 ]]; do
    sleep 1
    count=$((count + 1))
  done
  
  if ps -p "$pid" > /dev/null 2>&1; then
    log "Force killing opencode server"
    kill -9 "$pid" 2>/dev/null
  fi
  
  rm -f "$OPENCODE_PID_FILE"
  log "Opencode server stopped"
  return 0
}

stop_bot() {
  if ! is_running "$BOT_PID_FILE"; then
    log "Bot is not running"
    return 1
  fi

  local pid=$(cat "$BOT_PID_FILE")
  log "Stopping bot (PID: $pid)"
  
  kill "$pid" 2>/dev/null
  
  local count=0
  while ps -p "$pid" > /dev/null 2>&1 && [[ $count -lt 10 ]]; do
    sleep 1
    count=$((count + 1))
  done
  
  if ps -p "$pid" > /dev/null 2>&1; then
    log "Force killing bot"
    kill -9 "$pid" 2>/dev/null
  fi
  
  rm -f "$BOT_PID_FILE"
  log "Bot stopped"
  return 0
}

show_status() {
  echo ""
  echo "=== Service Status ==="
  
  if is_running "$OPENCODE_PID_FILE"; then
    local pid=$(cat "$OPENCODE_PID_FILE")
    echo "✓ Opencode server: RUNNING (PID: $pid)"
  else
    echo "✗ Opencode server: STOPPED"
  fi
  
  if is_running "$BOT_PID_FILE"; then
    local pid=$(cat "$BOT_PID_FILE")
    echo "✓ Bot: RUNNING (PID: $pid)"
  else
    echo "✗ Bot: STOPPED"
  fi
  
  echo ""
}

show_logs() {
  local follow=false
  [[ "$1" == "-f" || "$1" == "--follow" ]] && follow=true
  
  echo "=== Opencode Server Logs ==="
  if [[ -f "$OPENCODE_LOG" ]]; then
    if $follow; then
      tail -f "$OPENCODE_LOG"
    else
      tail -n 50 "$OPENCODE_LOG"
    fi
  else
    echo "No log file found"
  fi
  
  echo ""
  echo "=== Bot Logs ==="
  if [[ -f "$BOT_LOG" ]]; then
    if $follow; then
      tail -f "$BOT_LOG"
    else
      tail -n 50 "$BOT_LOG"
    fi
  else
    echo "No log file found"
  fi
}

case "$1" in
  start)
    log "Starting all services..."
    start_opencode
    start_bot
    show_status
    ;;
  stop)
    log "Stopping all services..."
    stop_bot
    stop_opencode
    show_status
    ;;
  restart)
    log "Restarting all services..."
    stop_bot
    stop_opencode
    sleep 2
    start_opencode
    start_bot
    show_status
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs "$2"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs [-f]}"
    echo ""
    echo "Commands:"
    echo "  start   - Start opencode server and bot"
    echo "  stop    - Stop opencode server and bot"
    echo "  restart - Restart opencode server and bot"
    echo "  status  - Show status of all services"
    echo "  logs    - Show logs (use -f to tail)"
    exit 1
    ;;
esac
