<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="logo/logo-light.png">
    <img src="logo/logo-dark.png" alt="Pinecall" width="350" />
  </picture>
</p>

<h3 align="center">@pinecall/sdk</h3>

<p align="center">
  <strong>Build AI voice agents in minutes.</strong><br/>
  TypeScript SDK + CLI for real-time voice over phone, WebRTC, or browser.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#cli">CLI</a> •
  <a href="#sdk-reference">SDK</a> •
  <a href="#configuration-reference">Configuration</a> •
  <a href="#events">Events</a> •
  <a href="#protocol">Protocol</a>
</p>

---

## Setup

```bash
npm install @pinecall/sdk
```

```bash
export PINECALL_API_KEY=pk_...
export OPENAI_API_KEY=sk-...     # for agent/dial commands
```

> Get your API key at [app.pinecall.io](https://app.pinecall.io)

---

## Quickstart

### CLI (fastest way to try)

```bash
pinecall agent                    # Start an inbound voice agent
pinecall agent --es               # Start in Spanish
pinecall dial +14155551234        # Make an outbound call
pinecall run agent.js             # Run a custom GPTAgent file
pinecall voices                   # List available voices
pinecall phones                   # List your phone numbers
pinecall test                     # Smoke test (connect + APIs)
```

### GPTAgent (recommended)

Define your agent as a class — zero boilerplate:

```javascript
// agent.js
import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class USPhone extends Phone {
    number = "+13186330963";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    greeting = "Hey! How can I help you?";
    stt = { provider: "deepgram-flux", language: "en" };
    turnDetection = "native";
}

class MyAgent extends GPTAgent {
    model = "gpt-4.1-nano";
    phone = new USPhone();
    instructions = "You are a helpful voice assistant. Be concise.";
}

export default MyAgent;
```

```bash
pinecall run agent.js
```

### SDK (low-level, full control)

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

The CLI is included with the SDK — install once, use anywhere.

### Commands

| Command | Description |
|---|---|
| `pinecall agent [--es\|--lang=xx]` | Start an inbound voice agent (OpenAI) |
| `pinecall dial <number> [--from=xx] [--es]` | Make an outbound call |
| `pinecall run <agent.js>` | Run a custom GPTAgent class file |
| `pinecall test` | Smoke test (WebSocket + REST APIs) |
| `pinecall voices [--provider=xx]` | List available TTS voices |
| `pinecall phones` | List your phone numbers |
| `pinecall help` | Show help |

### Interactive Commands

While a call is active, type these in the terminal:

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/instructions` | Edit system prompt in `$EDITOR` |
| `/hangup` | Hang up all active calls |
| `/hold` / `/unhold` | Put calls on hold (plays music) / resume |
| `/mute` / `/unmute` | Mute/unmute microphone |
| `/calls` | List active calls |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PINECALL_API_KEY` | **Yes** | Your Pinecall API key (`pk_...`) |
| `OPENAI_API_KEY` | For agent/dial | OpenAI API key |
| `PINECALL_URL` | No | Server URL (default: `wss://voice.pinecall.io/client`) |

---

## GPTAgent (`@pinecall/sdk/ai`)

A high-level class-based abstraction that wires together Pinecall + OpenAI + conversation history + tool calling. Separate subpath — `openai` is an optional peer dependency.

```bash
npm install openai    # required only for GPTAgent
```

### Agent Config

All config is set via class fields:

```javascript
import { GPTAgent, Phone, WebRTC } from "@pinecall/sdk/ai";

class MyAgent extends GPTAgent {
    // ── LLM ──
    model = "gpt-4.1-nano";
    instructions = "You are helpful.";
    greeting = "Hello!";
    temperature = 0.7;
    maxTokens = 150;
    turnEvent = "eager.turn";        // "eager.turn" or "turn.end"

    // ── Voice / TTS (string shortcut OR full config) ──
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    // or full config for speed/stability:
    // voice = {
    //     provider: "elevenlabs",
    //     voice_id: "EXAVITQu4vr4xnSDxMaL",
    //     speed: 1.05,
    //     stability: 0.55,
    //     similarity_boost: 0.8,
    // };

    // ── STT (with keyterms, model, etc.) ──
    stt = {
        provider: "deepgram",
        model: "nova-3",
        language: "es",
        keywords: ["Pinecall"],
        keyterms: ["GPT Agent"],
    };

    // ── Turn detection ──
    turnDetection = "smart_turn";

    // ── Interruption / barge-in ──
    interruption = {
        enabled: true,
        energy_threshold_db: -35.0,  // min audio energy (dB)
        min_duration_ms: 300,        // min speech before interrupting
    };

    // ── Channels ──
    phone = "+13186330963";
    // phones = [new USPhone(), new ESPhone()];
    // webrtc = new WebRTC();
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `"gpt-4.1-nano"` | OpenAI model |
| `voice` | string/object | — | Voice shortcut or full TTS config |
| `language` | string | — | Language code |
| `stt` | string/object | — | STT config (provider, model, keywords...) |
| `turnDetection` | string/object | — | Turn detection mode or full config |
| `interruption` | boolean/object | — | `false` to disable, or `{ energy_threshold_db, min_duration_ms }` |
| `instructions` | string | `"You are a helpful voice assistant."` | System prompt |
| `greeting` | string | — | Fallback greeting (channel greeting takes priority) |
| `turnEvent` | string | `"eager.turn"` | Which turn event triggers the LLM |
| `temperature` | number | — | LLM temperature |
| `maxTokens` | number | — | Max response tokens |
| `defaults` | object | — | Agent-level defaults (apply to all channels) |
| `phone` | string/Phone | — | Single phone channel |
| `phones` | (string/Phone)[] | — | Multiple phone channels |
| `webrtc` | WebRTC | — | WebRTC channel |
| `channels` | Channel[] | — | Additional channels (generic) |

### Phone & Channel Classes

Declare reusable, per-channel config as classes:

```javascript
import { Phone, WebRTC } from "@pinecall/sdk/ai";

// Phone with full TTS config + STT keyterms
class USPhone extends Phone {
    number = "+13186330963";
    greeting = "Hey! How can I help you?";
    voice = {
        provider: "elevenlabs",
        voice_id: "EXAVITQu4vr4xnSDxMaL",
        speed: 1.0,
        stability: 0.5,
    };
    stt = {
        provider: "deepgram-flux",
        language: "en",
        eot_threshold: 0.7,
    };
    turnDetection = "native";
    interruption = { enabled: true, min_duration_ms: 300 };
}

// Phone for Spanish
class ESPhone extends Phone {
    number = "+34607123456";
    language = "es";
    greeting = "¡Hola! ¿En qué puedo ayudarte?";
    voice = {
        provider: "elevenlabs",
        voice_id: "VmejBeYhbrcTPwDniox7",
        speed: 1.05,
        stability: 0.55,
    };
    stt = { provider: "deepgram", model: "nova-3", language: "es", keywords: ["Pinecall"] };
    turnDetection = "smart_turn";
}

class MyAgent extends GPTAgent {
    model = "gpt-4.1-nano";
    phones = [new USPhone(), new ESPhone()];  // multiple phones
    webrtc = new WebRTC();                     // WebRTC channel
    instructions = "You are helpful.";
}
```

**Channel fields:** `voice`, `greeting`, `language`, `stt`, `turnDetection`, `interruption`, `config`

### Shared Defaults

Use `defaults` for agent-level config that applies to all channels:

```javascript
class MyAgent extends GPTAgent {
    defaults = {
        voice: { provider: "elevenlabs", voice_id: "abc", speed: 1.05 },
        stt: { provider: "deepgram", model: "nova-3" },
        turnDetection: "smart_turn",
        interruption: { enabled: true, min_duration_ms: 300 },
    };
    phones = [new Phone("+13186330963"), new Phone("+34607123456")];
    webrtc = new WebRTC();
}
```

Or share config across Phone + WebRTC via constructor:

```javascript
const sharedConfig = {
    voice: { provider: "elevenlabs", voice_id: "abc", speed: 1.05 },
    stt: { provider: "deepgram", model: "nova-3" },
};
phones = [new Phone("+13186330963", sharedConfig)];
webrtc = new WebRTC(sharedConfig);
```

### Tool Calling

Tools are class methods. Register schemas with `defineTool()`:

```javascript
class Receptionist extends GPTAgent {
    model = "gpt-4.1-nano";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    phone = "+13186330963";
    instructions = "You are a restaurant receptionist.";
    greeting = "Welcome! How can I help?";

    async bookReservation({ date, time, guests, name }) {
        const result = await bookingAPI.create({ date, time, guests, name });
        return { confirmed: true, id: result.id };
    }

    async checkAvailability({ date, time }) {
        return await bookingAPI.check({ date, time });
    }
}

Receptionist.defineTool("bookReservation", "Book a table", {
    date:   { type: "string", description: "Date (YYYY-MM-DD)" },
    time:   { type: "string", description: "Time (HH:MM)" },
    guests: { type: "number", description: "Party size" },
    name:   { type: "string", description: "Name for reservation" },
});

Receptionist.defineTool("checkAvailability", "Check table availability", {
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
    time: { type: "string", description: "Time (HH:MM)" },
});

export default Receptionist;
```

### Custom LLM / No OpenAI

Override `onTurn()` to use any LLM or skip AI entirely:

```javascript
class SimpleBot extends GPTAgent {
    phone = "+13186330963";
    greeting = "Hello!";

    async onTurn(turn, call, history) {
        // Use your own LLM
        const reply = await myLLM.generate(history.toMessages());
        call.reply(reply);
    }
}
```

### Raw Event Access

GPTAgent does **not** replace `agent.on()`. Access the underlying Agent for raw events:

```javascript
const bot = new MyAgent({ apiKey: "pk_..." });
bot.agent.on("user.message", (event) => console.log("User said:", event.text));
bot.agent.on("bot.interrupted", (event) => console.log("Interrupted!"));
await bot.start();
```

### Running GPTAgent

```javascript
// Programmatic
const agent = new MyAgent({ apiKey: "pk_..." });
await agent.start();

// Outbound call
const call = await agent.dial({ to: "+14155551234", from: "+13186330963" });

// Shutdown
await agent.stop();
```

---

## ConversationHistory

Tracks messages with automatic interruption handling. Part of the core SDK (no OpenAI dependency).

```typescript
import { ConversationHistory } from "@pinecall/sdk";

// Auto-wire to a Call (recommended)
const history = ConversationHistory.forCall(call, "You are helpful.");

// Or manual
const history = new ConversationHistory();
history.addSystem("You are helpful.");
history.addUser("Hello", "msg_1");
history.addAssistant("Hi there!", "msg_2");

// Get messages in OpenAI format
const messages = history.toMessages();
// [{ role: "system", content: "..." }, { role: "user", content: "..." }, ...]
```

### Interruption Handling

When auto-wired via `forCall()`, history automatically handles:

| Event | Action |
|-------|--------|
| `user.message` | `addUser(text, messageId)` |
| `bot.speaking` | Track pending bot text |
| `bot.finished` | `addAssistant(text, messageId)` |
| `bot.interrupted` reason=`"user_spoke"` | Add with `[interrupted]` marker |
| `bot.interrupted` reason=`"continuation"` | Discard entirely |
| `turn.continued` | Remove last user entry (will be re-sent) |

### Extensibility

```typescript
// Hook into every mutation (for persistence, logging, etc.)
history.onUpdate = (messages) => {
    db.save("conversation", messages);
};

// Serialize / restore
const json = history.toJSON();
const restored = ConversationHistory.fromJSON(json);
```

---

## SDK Reference

### Connection

```typescript
const pc = new Pinecall({
  apiKey: "pk_...",
  url: "wss://voice.pinecall.io/client",   // optional
  reconnect: true,                          // auto-reconnect (default)
  pingInterval: 30000,                      // keepalive interval (default)
});

await pc.connect();

// Connection events
pc.on("connected", () => {});
pc.on("disconnected", (reason) => {});
pc.on("reconnecting", (attempt) => {});
pc.on("error", (err) => {});

// Graceful shutdown
await pc.disconnect();
```

### Agent

```typescript
const agent = pc.agent("sales-bot", {
  voice: "elevenlabs:IKne3meq5aSn9XLyUdCD",
  language: "es",
  stt: { provider: "deepgram", model: "nova-3" },
  turnDetection: "smart_turn",
  interruption: false,
});
```

**Config shortcuts** — concise alternatives to nested config:

| Shortcut | Example | Expands To |
|----------|---------|-----------|
| `voice` | `"elevenlabs:voiceId"` | `tts.provider` + `tts.voice_id` |
| `voice` | `{ provider: "cartesia", voice_id: "uuid" }` | Full TTS config |
| `language` | `"es"` | `stt.language` + `tts.language` |
| `stt` | `"deepgram"` | `stt.provider` |
| `stt` | `{ provider: "deepgram", model: "nova-3" }` | Full STT config |
| `turnDetection` | `"smart_turn"` | `turn_detection.mode` |
| `interruption` | `false` | `interruption.enabled = false` |

### Channels

```typescript
// Phone — routes incoming calls by number
agent.addChannel("phone", "+19035551234");

// Phone with per-channel config override
agent.addChannel("phone", "+34607123456", {
  voice: "cartesia:uuid",
  stt: { provider: "deepgram", language: "es" },
});

// WebRTC — browser audio
agent.addChannel("webrtc");
```

Each phone number is **exclusively owned** by one agent. Adding a phone already in use by another agent returns `PHONE_IN_USE`.

### Calls

```typescript
// Inbound
agent.on("call.started", (call) => {
  console.log(`${call.direction} call: ${call.from} → ${call.to}`);
  call.say("Hello!");
});

// Outbound
const call = await agent.dial({
  to: "+14155551234",
  from: "+19035551234",
  greeting: "Hi! This is Pinecall.",
});

// Call control
call.reply("Sure, I can help!");       // Send a complete reply
call.forward("+1800SUPPORT");          // Transfer to another number
call.sendDTMF("123#");                // Send touch tones
call.hold();                          // Hold (plays music)
call.unhold();                        // Resume from hold
call.mute();                          // Mute mic (buffers transcripts)
call.unmute();                        // Unmute mic
call.hangup();                        // End the call

// Per-session config updates (hot-reload)
call.updateConfig({ voice: "cartesia:uuid" });
```

### Streaming Replies

The primary way to send LLM responses. Tokens are buffered into sentences and sent to TTS as soon as a sentence boundary (`.`, `!`, `?`) is detected.

```typescript
agent.on("turn.end", async (turn, call) => {
  const stream = call.replyStream(turn);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: turn.text }],
    stream: true,
  });

  for await (const chunk of completion) {
    if (stream.aborted) break;   // user interrupted — stop
    const token = chunk.choices[0]?.delta?.content;
    if (token) stream.write(token);
  }

  stream.end();
});
```

### Eager Turn (Lowest Latency)

`eager.turn` fires as soon as the turn detector _thinks_ the user has stopped speaking — before the full silence confirmation that `turn.end` requires. This shaves **hundreds of milliseconds** off perceived latency.

If the user **keeps talking**, the reply stream is automatically aborted (`stream.aborted` becomes `true`), so no stale audio is sent.

```typescript
agent.on("eager.turn", async (turn, call) => {
  const stream = call.replyStream(turn);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: history,
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

### REST API Helpers

```typescript
// Static — no connection needed
const voices = await Pinecall.fetchVoices({ provider: "elevenlabs", language: "es" });
const phones = await Pinecall.fetchPhones({ apiKey: "pk_..." });

// Instance — auto-injects apiKey
const voices = await pc.fetchVoices({ provider: "cartesia" });
const phones = await pc.fetchPhones();
```

---

## Configuration Reference

Configuration applies at three levels (highest priority wins):

1. **Channel config** — specific to one phone/channel
2. **Agent config** — defaults for all channels on this agent
3. **Server defaults** — global defaults

### STT (Speech-to-Text)

#### Deepgram (Nova-3)

Best for most languages. 30+ languages.

```typescript
stt: {
  provider: "deepgram",
  language: "en",
  model: "nova-3",
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | string | — | `"deepgram"` |
| `language` | string | `"en"` | ISO language code |
| `model` | string | `"nova-3"` | Deepgram model |
| `interim_results` | bool | `true` | Send partial transcripts |
| `smart_format` | bool | `true` | Smart formatting |
| `punctuate` | bool | `false` | Add punctuation (⚠️ adds latency) |
| `keywords` | string[] | `[]` | Boost recognition of specific words |
| `keyterms` | string[] | `[]` | Multi-word keyword phrases |

#### Deepgram Flux

Ultra-low latency. **English only.** Built-in turn detection.

```typescript
stt: { provider: "deepgram-flux" }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `eot_threshold` | float | `0.7` | End-of-turn confidence |
| `eager_eot_threshold` | float | `0.5` | Early turn detection threshold |
| `eot_timeout_ms` | int | `2000` | Max silence (ms) before forcing end |

#### Gladia

Best for **Arabic and Hebrew**. Model: `solaria-1`.

```typescript
stt: { provider: "gladia", language: "ar" }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `language` | string | `"ar"` | Language code |
| `model` | string | `"solaria-1"` | Gladia model |
| `endpointing` | float | `0.3` | Silence (seconds) before endpoint |

#### AWS Transcribe

30+ languages. Uses AWS credentials.

```typescript
stt: { provider: "transcribe", language: "en-US" }
```

---

### TTS (Text-to-Speech)

#### ElevenLabs

High quality. Word-level timestamps. Multilingual.

```typescript
voice: "elevenlabs:IKne3meq5aSn9XLyUdCD"
// or full config:
config: {
  tts: {
    provider: "elevenlabs",
    voice_id: "IKne3meq5aSn9XLyUdCD",
    model: "eleven_flash_v2_5",
    speed: 1.0,
    stability: 0.5,
    similarity_boost: 0.8,
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `voice_id` | string | — | ElevenLabs voice ID |
| `model` | string | `"eleven_flash_v2_5"` | TTS model |
| `speed` | float | `1.0` | Speech speed (0.7–1.2) |
| `stability` | float | `0.5` | Voice stability (0.0–1.0) |
| `similarity_boost` | float | `0.8` | Voice similarity (0.0–1.0) |
| `language` | string | `null` | Language for multilingual models |

#### Cartesia

Low latency. Emotion support. 40+ languages.

```typescript
voice: "cartesia:87748186-..."
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `voice_id` | string | — | Cartesia voice ID (UUID) |
| `model` | string | `"sonic-3"` | TTS model |
| `speed` | float | `1.0` | Speech speed (0.6–1.5) |
| `emotion` | string | `null` | `"neutral"`, `"happy"`, `"calm"`, etc. |

#### AWS Polly

Economic. SSML support. Neural voices.

```typescript
config: {
  tts: { provider: "polly", voice_id: "Joanna", engine: "neural" }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `voice_id` | string | `"Joanna"` | Polly voice name |
| `engine` | string | `"neural"` | `"neural"` or `"standard"` |
| `language` | string | `"en-US"` | AWS language code |

---

### VAD (Voice Activity Detection)

```typescript
config: {
  vad: {
    provider: "silero",
    threshold: 0.5,
    min_speech_ms: 250,
    min_silence_ms: 350,
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | string | `"silero"` | `"silero"` (ML) or `"native"` (STT built-in) |
| `threshold` | float | `0.5` | Speech sensitivity (0.0–1.0). Lower = more sensitive |
| `min_speech_ms` | int | `250` | Min speech duration before considered real |
| `min_silence_ms` | int | `350` | Silence before triggering turn analysis |
| `speech_end_delay_ms` | int | `300` | Additional delay after speech ends |

---

### Turn Detection

Controls **when the server decides the user has finished speaking**.

```typescript
turnDetection: "smart_turn"
// or full config:
config: {
  turn_detection: {
    mode: "smart_turn",
    smart_turn_threshold: 0.7,
    max_silence_seconds: 2.0,
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | `"smart_turn"` | Turn detection strategy |
| `smart_turn_threshold` | float | `0.7` | Probability threshold. Higher = more patient |
| `max_silence_seconds` | float | `2.0` | Force `turn.end` after this much silence |

#### Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `"smart_turn"` | ML-based prosody analysis (Pipecat SmartTurn) | Most use cases |
| `"native"` | STT provider's built-in detection (Flux, Deepgram) | Lowest latency |
| `"silence"` | Pure silence timeout | Simple bots |

---

### Interruption / Barge-In

```typescript
interruption: false
// or full config:
config: {
  interruption: {
    enabled: true,
    energy_threshold_db: -35.0,
    min_duration_ms: 300,
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | bool | `true` | Allow user to interrupt the bot |
| `energy_threshold_db` | float | `-35.0` | Min audio energy (dB) to trigger |
| `min_duration_ms` | int | `300` | Min speech duration (ms) before interrupting |

Both conditions must be met simultaneously.

---

### Speaker Filter

Filters out non-speech audio (background noise, music).

```typescript
config: {
  speaker_filter: {
    enabled: true,
    energy_threshold_db: -35.0,
    warmup_seconds: 2.0,
  }
}
```

---

### Analysis / Metrics

```typescript
config: {
  analysis: {
    send_audio_metrics: true,
    audio_metrics_interval_ms: 100,
    send_turn_audio: false,
    send_bot_audio: false,
  }
}
```

---

### Hot-Reload Support

You can update config during an active call:

```typescript
// Update agent defaults (affects new calls)
agent.configure({ voice: "cartesia:uuid", language: "fr" });

// Update active session (affects current call)
agent.configureSession(call.id, { voice: "cartesia:uuid" });
```

| ✅ Hot-reload supported | ❌ Requires new session |
|---|---|
| TTS provider, voice, speed | Audio encoding |
| STT provider, language, model | |
| Turn detection mode/thresholds | |

---

## Events

### Call Lifecycle

| Event | Callback | Description |
|---|---|---|
| `call.started` | `(call) => void` | New call connected |
| `call.ended` | `(call, reason) => void` | Call terminated |

Reasons: `"hangup"`, `"disconnected"`, `"error"`, `"client_hangup"`, `"shutdown"`.

### Turn Events

| Event | Callback | Description |
|---|---|---|
| `turn.end` | `(turn, call) => void` | ✅ **User finished — reply here** |
| `eager.turn` | `(turn, call) => void` | Early turn signal (lowest latency) |
| `turn.pause` | `(event, call) => void` | User might continue — don't reply yet |
| `turn.resumed` | `(event, call) => void` | User continued after a pause |
| `turn.continued` | `(event, call) => void` | User kept talking — **abort your reply** |

### Transcript Events

| Event | Callback | Description |
|---|---|---|
| `user.speaking` | `(event, call) => void` | Interim (partial) transcript |
| `user.message` | `(event, call) => void` | Final transcript with `message_id` |

### Speech Events

| Event | Callback | Description |
|---|---|---|
| `speech.started` | `(event, call) => void` | VAD detected user started speaking |
| `speech.ended` | `(event, call) => void` | VAD detected user stopped speaking |

### Bot Events

| Event | Callback | Description |
|---|---|---|
| `bot.speaking` | `(event, call) => void` | Bot audio started playing |
| `bot.word` | `(event, call) => void` | Word-level timestamp (for subtitles) |
| `bot.finished` | `(event, call) => void` | Bot finished speaking normally |
| `bot.interrupted` | `(event, call) => void` | User interrupted the bot |

#### Interruption Reasons

| Reason | Meaning | Add to history? |
|--------|---------|-----------------|
| `"user_spoke"` | Interrupted after 2s | ✅ With `[interrupted]` marker |
| `"continuation"` | Interrupted before 2s | ❌ Discard entirely |
| `"cancelled"` | Your app sent `bot.cancel` | ❌ Discard |

### Confirmation Events

| Event | Callback | Description |
|---|---|---|
| `message.confirmed` | `(event, call) => void` | Bot message played successfully |
| `reply.rejected` | `(event, call) => void` | Reply rejected — `in_reply_to` doesn't match |

### Connection Events

| Event | Callback | Description |
|---|---|---|
| `connected` | `() => void` | WebSocket authenticated |
| `disconnected` | `(reason) => void` | Connection lost |
| `reconnecting` | `(attempt) => void` | Attempting reconnection |
| `error` | `(err) => void` | Connection or call error |

---

## Protocol

### The `in_reply_to` Protocol

Every `user.message` includes a `message_id`. When you reply, the SDK automatically includes `in_reply_to` matching that ID. The server **rejects stale replies**.

```
← user.message  (message_id: "A")     You start generating for "A"
← turn.continued                       User kept talking! Abort "A"
← user.message  (message_id: "B")     Generate for "B" instead
→ bot.reply.stream (in_reply_to: "B")  ✅ Accepted
```

### Conversation History

Pinecall does **not** manage your LLM's conversation history. You maintain it:

| Event | Action |
|-------|--------|
| `user.message` | Add `{ role: "user", content: text }` |
| `bot.finished` | Add `{ role: "assistant", content: text }` |
| `bot.interrupted` reason=`"user_spoke"` | Add assistant with `[interrupted]` tag |
| `bot.interrupted` reason=`"continuation"` | **Discard** — don't add to history |
| `turn.continued` | Remove last user entry (will be re-sent with updated text) |

### Phone Exclusivity

Each phone number is exclusively owned by one agent. If the same `agent_id` reconnects, the old connection is displaced (`disconnected` event with reason `displaced:...`).

---

## Multi-Agent

A single connection can host multiple agents, each with their own channels, voices, and event streams.

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

## Supported Languages

| Language | STT Provider | Notes |
|----------|-------------|-------|
| English | Deepgram Nova-3, Deepgram Flux | Flux = ultra-low latency |
| Spanish | Deepgram Nova-3 | |
| Portuguese | Deepgram Nova-3 | |
| French | Deepgram Nova-3 | |
| German | Deepgram Nova-3 | |
| Arabic | Gladia Solaria-1 | Best Arabic support |
| Hebrew | Gladia Solaria-1 | Best Hebrew support |
| Japanese | Deepgram Nova-3 | |
| Chinese | Deepgram Nova-3 | |
| 30+ others | AWS Transcribe | |

---

## License

MIT © [Pinecall](https://pinecall.io)
