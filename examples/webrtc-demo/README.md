# WebRTC Custom UI Example

A minimal voice agent UI — **HTML + Tailwind CSS + ~30 lines of JS**. No build tools, no React, no bundler.

## Quick Start

```bash
# 1. Start your agent
pinecall server examples/agents/Minimal.js

# 2. Open in browser
open examples/webrtc-ui/index.html
```

## How It Works

The example loads the pre-built `pinecall-webrtc.iife.global.js` (~5KB) which exposes `Pinecall.PinecallWebRTC` globally.

```html
<script src="../../dist/pinecall-webrtc.iife.global.js"></script>
<script>
  const { PinecallWebRTC } = Pinecall;

  // Auto-discovers the Pinecall server from your SDK server
  const webrtc = await PinecallWebRTC.fromSDKServer('http://localhost:4100', 'my-agent');

  webrtc.on('connected',    ()  => console.log('Connected!'));
  webrtc.on('user.message', (d) => console.log('User:', d.text));
  webrtc.on('bot.speaking', (d) => console.log('Bot:', d.text));

  await webrtc.connect();

  // Mute/unmute (handles both local track + server-side STT)
  webrtc.toggleMute();
</script>
```

## Architecture

```
Browser
  │
  ├── GET /server-info ──→ SDK Server (:4100) → returns Pinecall server URL
  │
  └── WebRTC direct ──→ Pinecall Server
      ├── Mic audio → STT/VAD
      ├── TTS audio → speaker
      └── Data channel → events (transcripts, bot.word, etc.)
```

## API

| Method | Description |
|--------|-------------|
| `PinecallWebRTC.fromSDKServer(url, agentId)` | Create instance with auto server discovery |
| `connect()` | Start WebRTC call |
| `disconnect()` | End call |
| `mute()` / `unmute()` / `toggleMute()` | Mic control (local + server) |
| `on(event, handler)` | Listen for events |
| `isMuted` / `isConnected` | State getters |

## Building the SDK Script

If you modify `src/webrtc-client.ts`, rebuild with:

```bash
npx tsup
```

This outputs `dist/pinecall-webrtc.iife.global.js` (minified IIFE bundle).
