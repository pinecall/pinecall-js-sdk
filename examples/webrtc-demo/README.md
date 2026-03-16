# WebRTC Demo

Pure HTML + JS voice agent UI — no build tools, no React, no bundler.

## Quick Start

```bash
# 1. Start your agent
pinecall run examples/agents/Minimal.js

# 2. Open in browser
open examples/webrtc-demo/index.html
```

Edit `AGENT_ID` and `TOKEN_URL` at the top of the `<script>` block in `index.html`.

## How It Works

Loads the pre-built IIFE bundle which exposes `Pinecall.PinecallWebRTC` globally:

```html
<script src="../../dist/pinecall-webrtc.iife.global.js"></script>
<script>
  const { PinecallWebRTC } = Pinecall;

  const webrtc = new PinecallWebRTC('my-agent');

  webrtc.on('connected',    ()  => console.log('Connected!'));
  webrtc.on('user.message', (d) => console.log('User:', d.text));
  webrtc.on('bot.speaking', (d) => console.log('Bot:', d.text));

  await webrtc.connect();

  // Mute/unmute (handles both local track + server-side STT)
  webrtc.toggleMute();
</script>
```

## Features

- **Dual audio waveform** — green (user mic) / purple (agent TTS)
- **Chat bubbles** with word-by-word streaming
- **Events panel** (toggle) showing all data channel events
- **Mute button** and call duration timer
- **Token auth** support for production

## API

| Method | Description |
|--------|-------------|
| `new PinecallWebRTC(agentId, opts?)` | Create instance |
| `connect()` | Start WebRTC call |
| `disconnect()` | End call |
| `mute()` / `unmute()` / `toggleMute()` | Mic control (local + server) |
| `on(event, handler)` | Listen for events |
| `isMuted` / `isConnected` | State getters |
| `localStream` / `remoteStream` | MediaStreams for visualization |

## Building the SDK Script

If you modify `src/webrtc-client.ts`, rebuild with:

```bash
npm run build
```
