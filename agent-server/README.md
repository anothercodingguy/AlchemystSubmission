# Agent Server (Mock Backend)

A WebSocket server that simulates a context-aware AI agent for testing the Agent Console frontend.

## Quick Start

```bash
# Build the Docker image
docker build -t agent-server ./agent-server

# Run in normal mode
docker run -p 4747:4747 agent-server

# Run in chaos mode
docker run -p 4747:4747 agent-server --mode chaos
```

## Endpoints

| Endpoint | Description |
|---|---|
| `ws://localhost:4747/ws` | WebSocket endpoint |
| `GET http://localhost:4747/health` | Health check |
| `GET http://localhost:4747/log` | Session logs (JSON array) |

## Protocol

See the main README.md for the full protocol reference.

## Chaos Mode Behaviors

When run with `--mode chaos`, the server randomly introduces:

- **Connection drops** — terminates WebSocket mid-stream (~3% per token)
- **Latency spikes** — 2-8 second pauses (~5% per token)
- **Out-of-order delivery** — shuffles message batches (~20%)
- **Duplicate messages** — sends same seq twice (~8%)
- **Rapid tool calls** — two TOOL_CALLs before any TOOL_RESULT (~25%)
- **Corrupt heartbeats** — PING with empty challenge (~10%)
- **Oversized context** — 500KB+ CONTEXT_SNAPSHOT payload (~15%)
