# Examples

## 📂 Structure

```
examples/
├── agents/              # Server-side agent definitions
│   ├── Minimal.js       # Simplest possible agent
│   ├── Receptionist.js  # Full-featured receptionist bot
│   ├── Multilingual.js  # Multi-language agent
│   └── CustomLLM.js     # Custom LLM integration
│
├── webrtc-demo/         # 🌐 WebRTC Demo (pure HTML, no build)
│   │                    # Audio waveform, events panel, streaming,
│   │                    # data channel commands, token auth
│   └── index.html       # Open directly in browser
│
├── sdk/                 # 📦 SDK API usage examples
│   ├── basic.ts         # Core SDK setup
│   └── events.ts        # Event handling patterns
│
└── ui/
    └── dashboard/       # 🖥 Development dashboard (React + Vite)
                         # Builds to dist/dashboard for SDK server
```

## Quick Start

### WebRTC Demo (no build required)

```bash
# 1. Start your agent
pinecall run examples/agents/Minimal.js

# 2. Open in browser
open examples/webrtc-demo/index.html
```

The demo auto-discovers the event server and gets a token — zero config needed.

### Run an Agent

```bash
pinecall run examples/agents/Minimal.js
```
