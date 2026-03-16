# WebRTC Demo

Pure HTML + JS voice agent UI — no build tools, no React, no bundler.

## Quick Start

```bash
# 1. Start your agent
pinecall run examples/agents/Minimal.js

# 2. Open in browser
open examples/webrtc-demo/index.html
```

## How It Works

Loads the pre-built IIFE bundle which exposes `Pinecall.PinecallWebRTC` globally:

```html
<script src="../../dist/pinecall-webrtc.iife.global.js"></script>
<script>
  const { PinecallWebRTC } = Pinecall;

  // Just pass your agent name — everything else is automatic
  const webrtc = new PinecallWebRTC('my-agent');

  webrtc.on('connected',    ()  => console.log('Connected!'));
  webrtc.on('user.message', (d) => console.log('User:', d.text));
  webrtc.on('bot.speaking', (d) => console.log('Bot:', d.text));

  await webrtc.connect();

  // Mute/unmute (handles both local track + server-side STT)
  webrtc.toggleMute();
</script>
```

On `connect()`, the SDK auto-discovers the event server (same-origin or
`localhost:4100`) and fetches a signed WebRTC token from `/webrtc/token`.
The event server proxies to `app.pinecall.io` using your API key — **no
secrets ever touch the browser**.

### Pre-fetched Token

If you have a custom backend, fetch the token server-side instead:

```javascript
// Node.js (server-side)
const { token } = await pc.getWebRTCToken('my-agent');
// or: const { token } = await fetchWebRTCToken({ apiKey: 'pk_...', agentId: 'my-agent' });

// Browser — pass pre-fetched token
const webrtc = new PinecallWebRTC('my-agent', { token });
await webrtc.connect();
```

## Features

- **Dual audio waveform** — green (user mic) / purple (agent TTS)
- **Chat bubbles** with word-by-word streaming
- **Events panel** (toggle) showing all data channel events
- **Mute button** and call duration timer
- **Token auth** — HMAC-signed, org-scoped, API key never in browser

## API

| Method | Description |
|--------|-------------|
| `new PinecallWebRTC(agentId)` | Create instance (auto-discovers token + server) |
| `new PinecallWebRTC(agentId, { token })` | Create with pre-fetched token |
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
