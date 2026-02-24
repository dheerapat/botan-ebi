#!/bin/bash

touch .opencode/memory.jsonl

# Target configuration file
CONFIG=".opencode/opencode.jsonc"

# Detect OS to handle sed -i differences
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS version
  sed -i '' "s|<PWD>|$PWD|g" "$CONFIG"
else
  # Linux/GNU version
  sed -i "s|<PWD>|$PWD|g" "$CONFIG"
fi

echo "✅ Configuration updated: <PWD> replaced with $PWD"
