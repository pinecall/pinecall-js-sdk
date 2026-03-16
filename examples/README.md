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

Open `examples/webrtc-demo/index.html` in a browser. Edit `AGENT_ID` and `TOKEN_URL` at the top of the script.

### Run an Agent

```bash
node examples/agents/Minimal.js
```
