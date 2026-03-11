<p align="center">
  <img src="https://pinecall.io/img/logo.png" alt="Pinecall" width="180" />
</p>

<h3 align="center">@pinecall/sdk</h3>

<p align="center">
  <strong>Build AI voice agents in minutes.</strong><br/>
  TypeScript SDK + CLI for real-time voice over phone, WebRTC, or browser mic.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#cli">CLI</a> •
  <a href="#sdk">SDK</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#events">Events</a>
</p>

---

## Setup

```bash
npm install @pinecall/sdk
```

Set your API key:

```bash
export PINECALL_API_KEY=pk_...
export OPENAI_API_KEY=sk-...     # for agent/dial commands
```

> Get your API key at [app.pinecall.io](https://app.pinecall.io)

---

## Quickstart

### CLI (fastest way to try)

```bash
# Start an inbound voice agent
pinecall agent

# Start in Spanish
pinecall agent --es

# Make an outbound call
pinecall dial +14155551234

# List your voices
pinecall voices

# List your phone numbers
pinecall phone-numbers

# Smoke test (connect + APIs)
pinecall test
```

### SDK (build your own)

```typescript
import { Pinecall } from "@pinecall/sdk";

const pc = new Pinecall({ apiKey: process.env.PINECALL_API_KEY! });

const agent = pc.agent("my-agent", {
  voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
  turnDetection: "smart_turn",
});

agent.addChannel("phone", "+19035551234");

agent.on("call.started", (call) => {
  call.say("Hello! How can I help you?");
});

// eager.turn fires before the user fully stops speaking,
// giving you the lowest possible latency. If the user keeps
// talking the reply stream is automatically aborted.
agent.on("eager.turn", async (turn, call) => {
  const stream = call.replyStream(turn);
  for await (const token of myLLM.stream(turn.text)) {
    if (stream.aborted) break;
    stream.write(token);
  }
  stream.end();
});

await pc.connect();
```

---

## CLI

The Pinecall CLI is included with the SDK — install once, use anywhere.

### Commands

| Command | Description |
|---|---|
| `pinecall agent [--es\|--lang=xx]` | Start an inbound voice agent (OpenAI) |
| `pinecall dial <number> [--es]` | Make an outbound call |
| `pinecall test` | Smoke test (WebSocket + REST APIs) |
| `pinecall voices [--provider=xx]` | List available TTS voices |
| `pinecall phone-numbers` | List your phone numbers |
| `pinecall help` | Show help |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PINECALL_API_KEY` | **Yes** | Your Pinecall API key (`pk_...`) |
| `OPENAI_API_KEY` | For agent/dial | OpenAI API key |
| `PINECALL_PHONE` | No | Default phone number |
| `PINECALL_URL` | No | Server URL (default: `wss://voice.pinecall.io/client`) |

---

## SDK

### Connection

```typescript
const pc = new Pinecall({
  apiKey: "pk_...",
  url: "wss://voice.pinecall.io/client",   // default
  reconnect: true,
});

await pc.connect();
```

### Agent

```typescript
const agent = pc.agent("sales-bot", {
  voice: "elevenlabs:IKne3meq5aSn9XLyUdCD",
  language: "es",
  stt: { provider: "deepgram", model: "nova-3" },
  turnDetection: "smart_turn",
  interruption: false,   // disable barge-in
});
```

**Config shortcuts** — concise alternatives to nested config:

| Shortcut | Example | Maps To |
|----------|---------|---------|
| `voice` | `"elevenlabs:voiceId"` | `tts.provider` + `tts.voice_id` |
| `language` | `"es"` | `stt.language` + `tts.language` |
| `stt` | `"deepgram"` | `stt.provider` |
| `turnDetection` | `"smart_turn"` | `turn_detection.mode` |
| `interruption` | `false` | `interruption.enabled = false` |

### Channels

```typescript
agent.addChannel("phone", "+19035551234");
agent.addChannel("phone", "+34607123456", { voice: "cartesia:uuid" });
agent.addChannel("webrtc");
```

### Calls

```typescript
// Inbound
agent.on("call.started", (call) => {
  call.say("Hello!");
});

// Outbound
const call = await agent.dial({
  to: "+14155551234",
  from: "+19035551234",
  greeting: "Hi! This is Pinecall.",
});

// Common operations
call.reply("Sure!");
call.forward("+1800SUPPORT");
call.sendDTMF("123#");
call.hold();
call.unhold();
call.mute();
call.unmute();
call.hangup();
```

### Streaming Replies

```typescript
agent.on("turn.end", async (turn, call) => {
  const stream = call.replyStream(turn);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: turn.text }],
    stream: true,
  });

  for await (const chunk of completion) {
    if (stream.aborted) break;
    const token = chunk.choices[0]?.delta?.content;
    if (token) stream.write(token);
  }

  stream.end();
});
```

### Eager Turn

`eager.turn` fires as soon as the turn detector _thinks_ the user has stopped
speaking — before waiting for the full silence confirmation that `turn.end`
requires. This lets you start generating a response immediately, shaving
hundreds of milliseconds off perceived latency.

If the user **keeps talking**, the reply stream is automatically aborted
(`stream.aborted` becomes `true`), so no stale audio is sent.

```typescript
agent.on("eager.turn", async (turn, call) => {
  const stream = call.replyStream(turn);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      { role: "system", content: "You are a helpful voice assistant." },
      { role: "user", content: turn.text },
    ],
    stream: true,
  });

  for await (const chunk of completion) {
    if (stream.aborted) break;
    const token = chunk.choices[0]?.delta?.content;
    if (token) stream.write(token);
  }

  stream.end();
});
```

**When to use it:**

| ✅ Good fit | ❌ Avoid |
|---|---|
| Small, fast models (`gpt-4.1-nano`, `gpt-4.1-mini`) | Large / expensive models (`o3`, `o4‑mini`) |
| Conversational assistants where speed matters | Code-generation or reasoning-heavy tasks |
| Short answers (1–2 sentences) | Long-form responses where wasted tokens are costly |

> **Tip:** Pair `eager.turn` with `smart_turn` detection for the best balance
> between responsiveness and accuracy.

---

## Events

| Event | Callback | When |
|---|---|---|
| `call.started` | `(call) => void` | New call connected |
| `call.ended` | `(call, reason) => void` | Call terminated |
| `turn.end` | `(turn, call) => void` | ✅ **User finished — reply here** |
| `eager.turn` | `(turn, call) => void` | Early turn signal (lowest latency) |
| `user.speaking` | `(event, call) => void` | Interim transcript |
| `user.message` | `(event, call) => void` | Final transcript |
| `bot.speaking` | `(event, call) => void` | Bot audio started |
| `bot.finished` | `(event, call) => void` | Bot finished speaking |
| `bot.interrupted` | `(event, call) => void` | Bot interrupted (barge-in) |
| `turn.continued` | `(event, call) => void` | User kept talking — abort reply |
| `reply.rejected` | `(event, call) => void` | Reply rejected (stale) |

---

## Multi-Agent

```typescript
const sales = pc.agent("sales", { voice: "elevenlabs:abc", language: "en" });
sales.addChannel("phone", "+19035551234");

const support = pc.agent("support", { voice: "elevenlabs:def", language: "es" });
support.addChannel("phone", "+34607123456");

sales.on("call.started", (call) => call.say("Welcome to Sales!"));
support.on("call.started", (call) => call.say("¡Bienvenido a Soporte!"));

await pc.connect();
```

---

## License

MIT © [Pinecall](https://pinecall.io)
