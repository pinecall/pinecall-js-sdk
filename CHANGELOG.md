# Changelog

## 0.2.0 (2026-03-10)

### New

- **Multi-agent support** — `pc.agent("id", config)` + `addChannel("phone", "+1...")`
- **Config shortcuts** — `voice`, `language`, `stt`, `turnDetection`, `interruption`
- **Protocol v2** — `connect` → `agent.create` → `channel.add` (backward-compatible with v1)
- **Message buffering** — agent commands are queued until server confirms registration

### Changed

- Default WebSocket URL: `wss://voice.pinecall.io/client`
- Standalone package (extracted from monorepo)
