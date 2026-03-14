# Changelog

## 0.1.0 (2026-03-14)

Initial release 🎉

### Features

- **Multi-agent support** — `pc.agent("id", config)` + `addChannel("phone", "+1...")`
- **Config shortcuts** — `voice`, `language`, `stt`, `turnDetection`, `interruption`
- **Eager turn** — `eager.turn` event for lowest-latency responses with auto-abort
- **Streaming replies** — `call.replyStream(turn)` with backpressure + abort support
- **Protocol v2** — `connect` → `agent.create` → `channel.add`
- **Message buffering** — agent commands are queued until server confirms registration
- **CLI** — `pinecall run`, `pinecall dial`, `pinecall voices`, `pinecall phone-numbers`, `pinecall test`
- **Channels** — phone (Twilio) and WebRTC
- **Call control** — `reply`, `say`, `forward`, `hold`, `mute`, `sendDTMF`, `hangup`

### GPTAgent — Server-Side LLM

- **Server-side LLM** — `GPTAgent` runs LLM on the server (zero SDK round-trips)
- **Server-side tool calling** — tools defined via `static tools = {}` execute on the SDK, orchestrated by the server
- **Auto-hold during tools** — call is placed on hold while tools execute, auto-unheld on bot reply
- **Agent base class** — `Agent` with `model` field also enables server-side LLM (no need for GPTAgent)

### Turn Detection

- **SmartTurn** — GPU-accelerated turn detection via `turnDetection: "smart_turn"`
- **Configurable silence** — `turnDetection: { mode: "smart_turn", silenceMs: 400 }` (default 400ms)
- **Native (Flux)** — Deepgram Flux native turn detection via `turnDetection: "native"`

### CLI Enhancements

- **`pinecall run`** — run an agent from a file with live TUI
- **Command palette** — Ctrl+O for quick commands (hold, mute, DTMF, forward, say)
- **Text input** — Ctrl+T for typing slash commands directly
- **LLM pane** — shows LLM streaming output with `agent.log()` support
- **Clipboard** — Ctrl+Y to copy LLM pane content
