# Changelog

## 0.1.0 (2026-03-11)

Initial release 🎉

### Features

- **Multi-agent support** — `pc.agent("id", config)` + `addChannel("phone", "+1...")`
- **Config shortcuts** — `voice`, `language`, `stt`, `turnDetection`, `interruption`
- **Eager turn** — `eager.turn` event for lowest-latency responses with auto-abort
- **Streaming replies** — `call.replyStream(turn)` with backpressure + abort support
- **Protocol v2** — `connect` → `agent.create` → `channel.add`
- **Message buffering** — agent commands are queued until server confirms registration
- **CLI** — `pinecall agent`, `pinecall dial`, `pinecall voices`, `pinecall phone-numbers`, `pinecall test`
- **Channels** — phone (Twilio) and WebRTC
- **Call control** — `reply`, `say`, `forward`, `hold`, `mute`, `sendDTMF`, `hangup`
