<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="logo/logo-light.png">
    <img src="logo/logo-dark.png" alt="Pinecall" width="350" />
  </picture>
</p>

<h3 align="center">@pinecall/sdk</h3>

<p align="center">
  Build AI voice agents in minutes.<br/>
  TypeScript SDK + CLI for real-time voice over phone, WebRTC, or browser.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#gptagent">GPTAgent</a> ·
  <a href="#sdk">SDK</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#events">Events</a>
</p>

---

## Installation

```bash
npm install @pinecall/sdk
```

```bash
export PINECALL_API_KEY=pk_...
```

> Get your API key at [app.pinecall.io](https://app.pinecall.io)

---

## Quickstart

### 1. Define your agent

```javascript
// Receptionist.js
import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Receptionist extends GPTAgent {
    model = "gpt-4.1-nano";  // runs server-side (no API key needed)
    phone = new Phone({
        number: "+13186330963",
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        greeting: "Hey! How can I help you?",
        // stt defaults to "deepgram-flux", turnDetection defaults to "native"
    });
    instructions = "You are a helpful voice assistant. Be concise.";
}

export default Receptionist;
```

### 2. Run it

```bash
pinecall run Receptionist                    # inbound — wait for calls
pinecall run Receptionist --dial +1415555..  # outbound — dial from agent's phone
```

### Raw SDK

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

Included with the SDK.

### Commands

| Command | Description |
|---------|-------------|
| `pinecall run <Agent>` | Run an Agent / GPTAgent file |
| `pinecall run <Agent> --dial <number>` | Run + make an outbound call |
| `pinecall test` | Smoke test (WebSocket + REST) |
| `pinecall voices [--provider=xx]` | List available TTS voices |
| `pinecall phones` | List your phone numbers |
| `pinecall help` | Show help |

### Keyboard Shortcuts

While a call is active:

| Key | Description |
|-----|-------------|
| `Ctrl+O` | Open command palette (Hangup, Hold, DTMF, Forward, Say…) |
| `Ctrl+T` | Type a slash command (e.g. `/hangup`, `/hold`) |
| `Ctrl+Y` | Copy LLM history to clipboard |
| `↑` `↓` | Navigate between active calls |
| `Ctrl+C` | Quit |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PINECALL_API_KEY` | Yes | Your Pinecall API key |
| `PINECALL_URL` | No | Custom server URL |

---

## GPTAgent

`@pinecall/sdk/ai` — class-based agent with **server-side LLM**, conversation history, and tool calling.

The LLM runs entirely on the Pinecall server — zero SDK round-trips, no API key management. The SDK only handles tool execution locally.

```
User speaks → Server (STT → LLM → TTS) → audio back
                ↕ tool calls via WebSocket ↕
              SDK executes tools locally
```

### Agent Fields

```javascript
import { GPTAgent, Phone, WebRTC } from "@pinecall/sdk/ai";

class MyAgent extends GPTAgent {
    // LLM (runs server-side)
    model = "gpt-4.1-nano";
    instructions = "You are helpful.";
    temperature = 0.7;
    maxTokens = 150;

    // Audio (agent-level = defaults for all channels)
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    stt = "deepgram:nova-3";                              // string shortcut
    turnDetection = "smart_turn";
    interruption = { enabled: true, min_duration_ms: 300 };

    // Channels
    phone = new Phone({ number: "+13186330963", greeting: "Hello!" });
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `"gpt-4.1-nano"` | OpenAI model (runs server-side) |
| `instructions` | string | `"You are a helpful voice assistant."` | System prompt |
| `greeting` | string | — | Fallback greeting (channel greeting takes priority) |
| `temperature` | number | — | LLM temperature |
| `maxTokens` | number | — | Max response tokens |
| `voice` | string / object | — | Voice shortcut or full TTS config |
| `language` | string | — | Language code |
| `stt` | string / object | — | STT config |
| `turnDetection` | string / object | — | Turn detection mode |
| `interruption` | bool / object | — | Interruption config or `false` to disable |
| `phone` | Phone | — | Single phone channel |
| `channels` | (Phone / WebRTC)[] | — | Multiple channels |

### Defaults & Overrides

Agent-level fields are **defaults for all channels**. Each channel only overrides what it needs:

```javascript
class MyAgent extends GPTAgent {
    // Defaults — apply to every channel
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    stt = "deepgram:nova-3";
    turnDetection = "smart_turn";

    channels = [
        new Phone({ number: "+13186330963", greeting: "Hello!" }),              // inherits defaults
        new Phone({ number: "+34607", language: "es", stt: "deepgram:nova-3:es" }), // overrides stt
        new WebRTC(),                                                           // inherits defaults
    ];
}
```

### Phone & Channel Classes

For complex per-channel config, subclass Phone or WebRTC:

```javascript
class USPhone extends Phone {
    number = "+13186330963";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    greeting = "Hey! How can I help you?";
    stt = { provider: "deepgram-flux", eot_threshold: 0.7 };
    turnDetection = "native";
    interruption = { enabled: true, min_duration_ms: 300 };
}

class ESPhone extends Phone {
    number = "+34607123456";
    voice = { provider: "elevenlabs", voice_id: "VmejBeYhbrcTPwDniox7", speed: 1.05 };
    greeting = "¡Hola! ¿En qué puedo ayudarte?";
    stt = "deepgram:nova-3:es";
    turnDetection = "smart_turn";
}

class MyAgent extends GPTAgent {
    channels = [new USPhone(), new ESPhone(), new WebRTC()];
}
```

**Channel fields:** `voice`, `greeting`, `language`, `stt`, `turnDetection`, `interruption`, `config`

### Tool Calling

Tools are class methods. Register schemas with `defineTool()`.

Tool methods receive `(args, call)` — use `this.log(call, ...)` to log to the TUI.

During tool execution, the call is automatically placed **on hold** with music until the tool returns and the LLM generates a follow-up response.

```javascript
class Receptionist extends GPTAgent {
    model = "gpt-4.1-nano";
    phone = new Phone({
        number: "+13186330963",
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        greeting: "Welcome to La Piña Dorada! How can I help?",
    });
    instructions = "You are a restaurant receptionist. Be concise.";

    async bookReservation({ date, time, guests, name }, call) {
        this.log(call, `📅 Booking for ${name} on ${date}`);
        const result = await bookingAPI.create({ date, time, guests, name });
        return { confirmed: true, id: result.id };
    }
}

Receptionist.defineTool("bookReservation", "Book a table", {
    date:   { type: "string", description: "Date (YYYY-MM-DD)" },
    time:   { type: "string", description: "Time (HH:MM)" },
    guests: { type: "number", description: "Party size" },
    name:   { type: "string", description: "Name for reservation" },
});

export default Receptionist;
```

#### Tool Calling Flow

```
1. User speaks → server runs STT + sends to OpenAI with tool schemas
2. OpenAI returns tool_calls → server sends "llm.tool_call" to SDK
3. Call goes ON HOLD (music plays) while SDK executes tool locally
4. SDK sends "llm.tool_result" → server passes result to OpenAI
5. OpenAI generates follow-up → call goes OFF HOLD → TTS plays response
6. Repeat up to maxToolRounds (default: 5)
```

> Tools always execute **locally** in your SDK process — your code, your database, your APIs. The server only proxies the LLM ↔ tool communication.

### Agent Base Class (BYO LLM)

`GPTAgent` extends `Agent`. Use `Agent` directly with any LLM:

```javascript
import { Agent, Phone } from "@pinecall/sdk/ai";

class MyBot extends Agent {
    phone = new Phone({ number: "+13186330963", greeting: "Hello!" });
    instructions = "You are helpful.";

    async onTurn(turn, call, history) {
        const messages = history.toMessages();
        const reply = await anthropic.complete(messages);
        call.reply(reply);
        history.addAssistant(reply);
    }

    onCallStarted(call) {}
    onCallEnded(call, reason) {}
    onUserMessage(event, call) {}
    onBotFinished(event, call) {}
    onBotInterrupted(event, call) {}
    // ... all events available as class methods
}
```

You can also set `model` on `Agent` directly for server-side LLM with tools (same as GPTAgent but without the default model):

```javascript
class Minimal extends Agent {
    model = "gpt-4.1-nano";    // server handles everything
    phone = new Phone({ number: "+13186330963", greeting: "Hello!" });
    instructions = "You are a helpful voice assistant. Be concise.";
}

export default Minimal;
```

### Running

```javascript
// Programmatic
const agent = new MyAgent({ apiKey: "pk_..." });
await agent.start();

// Outbound call
const call = await agent.dial({ to: "+14155551234", from: "+13186330963" });

// Shutdown
await agent.stop();
```

```bash
# CLI
pinecall run agent.js
```

---

## SDK

The low-level SDK for full control. No opinions on LLM, history, or architecture.

### Connection

```typescript
const pc = new Pinecall({
    apiKey: "pk_...",
    url: "wss://voice.pinecall.io/client",   // optional
    reconnect: true,                          // default
});

await pc.connect();

pc.on("connected", () => {});
pc.on("disconnected", (reason) => {});
pc.on("reconnecting", (attempt) => {});
pc.on("error", (err) => {});

await pc.disconnect();
```

### Agent

```typescript
const agent = pc.agent("sales-bot", {
    voice: "elevenlabs:IKne3meq5aSn9XLyUdCD",
    language: "es",
    stt: "deepgram:nova-3:es",
    turnDetection: "smart_turn",
    interruption: false,
});
```

### Channels

```typescript
agent.addChannel("phone", "+19035551234");

agent.addChannel("phone", "+34607123456", {
    voice: "cartesia:uuid",
    stt: "deepgram:nova-3:es",
});

agent.addChannel("webrtc");
```

Each phone number is exclusively owned by one agent.

### Calls

```typescript
// Inbound
agent.on("call.started", (call) => {
    console.log(`${call.direction}: ${call.from} → ${call.to}`);
    call.say("Hello!");
});

// Outbound
const call = await agent.dial({
    to: "+14155551234",
    from: "+19035551234",
    greeting: "Hi! This is Pinecall.",
});

// Call control
call.reply("Sure, I can help!");
call.forward("+1800SUPPORT");
call.sendDTMF("123#");
call.hold();
call.unhold();
call.mute();
call.unmute();
call.hangup();
```

### Streaming Replies

Tokens are buffered into sentences and sent to TTS at sentence boundaries (`.` `!` `?`).

```typescript
agent.on("eager.turn", async (turn, call) => {
    const stream = call.replyStream(turn);

    for await (const chunk of llmStream) {
        if (stream.aborted) break;
        stream.write(chunk);
    }

    stream.end();
});
```

### Eager Turn (Lowest Latency)

`eager.turn` fires as soon as the model thinks the user stopped — before the full silence confirmation. If the user keeps talking, `stream.aborted` becomes `true` automatically.

> **Note (Flux native mode):** When using `deepgram-flux` with `turnDetection: "native"`, `eager.turn` is deferred to `EndOfTurn` instead of firing at `EagerEndOfTurn`. Flux's speculative text changes frequently, so the server waits for the final confirmed transcript before triggering LLM generation. This adds ~200ms latency but eliminates wasted tokens and race conditions.

| ✅ Good fit | ❌ Avoid |
|-------------|---------|
| Fast models (`gpt-4.1-nano`, `gpt-4.1-mini`) | Expensive models (`o3`, `o4-mini`) |
| Conversational assistants | Reasoning-heavy tasks |
| Short answers (1–2 sentences) | Long-form responses |

> **Tip:** Pair `eager.turn` with `smart_turn` detection for the best balance.

### Conversation History

History is managed **automatically on the server** — all user messages, bot responses, tool calls, and interruptions are tracked. The SDK provides methods on `Call` to read and manipulate the history mid-call:

```typescript
// Fetch the current conversation history (OpenAI-compatible format)
const messages = await call.getHistory();
// [{ role: "system", content: "..." }, { role: "user", content: "Hello" }, ...]

// Inject context (e.g. CRM data, prior interactions)
await call.addHistory([
  { role: "system", content: "Customer: Bernardo Castro, VIP tier, last order: March 10" },
  { role: "user",   content: "I called about my order" },
  { role: "assistant", content: "Looking into your order now..." },
]);

// Update the system prompt mid-call (takes effect on next LLM request)
await call.setInstructions("You are now in Spanish support mode. Respond in Spanish.");

// Clear all messages (system prompt is preserved)
await call.clearHistory();
```

| Method | Returns | Description |
|--------|---------|-------------|
| `call.getHistory()` | `{ role, content }[]` | Fetch current messages in OpenAI format |
| `call.addHistory(messages)` | `number` (count) | Inject messages into history |
| `call.clearHistory()` | `number` (count) | Clear all messages (system prompt preserved) |
| `call.setInstructions(text)` | `number` (count) | Update system prompt mid-call |

### Dynamic Agents — `pc.deploy()`

Create agents at runtime from plain config objects — no class files needed:

```typescript
const pc = new Pinecall({ apiKey: "pk_..." });
await pc.connect();

const agent = pc.deploy("support", {
  model: "gpt-4.1-nano",
  voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
  language: "es",
  instructions: "You are a customer support agent. Be helpful and concise.",
  phones: ["+13186330963"],
});

agent.on("call.started", (call) => console.log("Call started!"));
```

Agents are stored client-side and **auto-restored on server restart** — the `Reconnector` re-creates all agents and re-registers their phone channels automatically.

#### Building a Dashboard (Vapi-like)

```typescript
// Load agents from YOUR database on startup
const configs = await db.agents.findAll();
const pc = new Pinecall({ apiKey: "pk_..." });
await pc.connect();

for (const config of configs) {
  pc.deploy(config.name, config);
}

// User creates new agent from dashboard UI
app.post("/agents", async (req, res) => {
  await db.agents.create(req.body);
  pc.deploy(req.body.name, req.body);
  res.json({ ok: true });
});

// User updates agent live
app.patch("/agents/:name", async (req, res) => {
  await db.agents.update(req.params.name, req.body);
  pc.agents.get(req.params.name)?.configure(req.body); // Hot-reload
  res.json({ ok: true });
});
```

### Live Configuration

Update voice, STT, turn detection, or model **mid-call**:

```typescript
// Change voice mid-call
call.configure({ voice: "cartesia:abc123" });

// Switch STT language
call.configure({ stt: "deepgram:nova-3:fr", language: "fr" });

// Adjust turn detection sensitivity
call.configure({ turnDetection: { mode: "smart_turn", silenceMs: 600 } });

// Update system prompt (takes effect on next LLM request)
await call.setInstructions("Now respond in French.");
```

Update agent defaults for **all future calls**:

```typescript
agent.configure({
  voice: "elevenlabs:newVoice",
  model: "gpt-4.1",
});
```

### Multi-Agent

A single connection can host multiple agents:

```typescript
const sales = pc.agent("sales", { voice: "elevenlabs:abc", language: "en" });
sales.addChannel("phone", "+19035551234");

const support = pc.agent("support", { voice: "elevenlabs:def", language: "es" });
support.addChannel("phone", "+34607123456");

await pc.connect();
```

### REST API

```typescript
const voices = await Pinecall.fetchVoices({ provider: "elevenlabs", language: "es" });
const phones = await Pinecall.fetchPhones({ apiKey: "pk_..." });

// Or via instance
const voices = await pc.fetchVoices({ provider: "cartesia" });
const phones = await pc.fetchPhones();
```

### EventServer — WebSocket + REST API

Expose all agent events over WebSocket and manage agents via REST API. **Opt-in** — import from `@pinecall/sdk/server`:

```typescript
import { EventServer } from "@pinecall/sdk/server";

const server = new EventServer({
  port: 4100,          // single port for REST + WS (default: 4100)
  host: "127.0.0.1",   // bind address
  requireAuth: true,   // require token in headers
  pinecall: pc,        // Pinecall client (enables POST /agents, GET /phones)
});

const token = server.attach(agent);  // returns "evt_..." token
server.start();
```

#### Events Forwarded

All events are JSON with `event`, `agent_id`, and (when applicable) `call_id`:

```jsonc
{ "event": "call.started", "agent_id": "support", "call_id": "CA...", "from": "+1...", "direction": "inbound" }
{ "event": "user.message", "agent_id": "support", "call_id": "CA...", "text": "Hello" }
{ "event": "llm.token",   "agent_id": "support", "call_id": "CA...", "token": "Sure" }
{ "event": "call.muted",   "agent_id": "support", "call_id": "CA..." }
{ "event": "call.ended",   "agent_id": "support", "call_id": "CA...", "reason": "completed" }
```

| Category | Events |
|----------|--------|
| **Call lifecycle** | `call.started`, `call.ended` |
| **Call state** | `call.held`, `call.unheld`, `call.muted`, `call.unmuted` |
| **Channels** | `channel.added`, `channel.configured`, `channel.removed` |
| **Speech** | `speech.started`, `speech.ended`, `user.speaking`, `user.message` |
| **Turns** | `eager.turn`, `turn.end`, `turn.pause`, `turn.continued`, `turn.resumed` |
| **Bot** | `bot.speaking`, `bot.word`, `bot.finished`, `bot.interrupted` |
| **Replies** | `message.confirmed`, `reply.rejected` |
| **Metrics** | `audio.metrics` |
| **LLM** | `llm.start`, `llm.token`, `llm.done`, `llm.tool_call`, `llm.tool_result`, `llm.error` |

#### SDK API

| Method | Description |
|--------|-------------|
| `new EventServer({ port?, host?, requireAuth?, allowedOrigins?, pinecall? })` | Create server |
| `server.attach(agent)` → `string` | Subscribe + get agent token (`evt_...`) |
| `server.detach(agent)` | Unsubscribe + revoke token |
| `server.createToken(...agents)` → `string` | Multi-agent token (dashboard) |
| `server.revokeToken(token)` | Revoke a token |
| `server.start()` | Start WS + REST servers |
| `server.stop()` | Stop all servers |
| `server.clients` | Connected WS client count |
| `server.listening` | Whether running |

#### REST API (built-in)

Available via `pinecall server` or `EventServer`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Deploy new agent `{ name, voice?, stt?, ... }` |
| `PATCH` | `/agents/:name` | Configure agent `{ voice?, stt?, ... }` |
| `DELETE` | `/agents/:name` | Remove agent |
| `POST` | `/agents/:name/dial` | Outbound call `{ to, from, greeting? }` |
| `GET` | `/calls` | List active calls |
| `PATCH` | `/calls/:id` | Configure call `{ voice?, language? }` |
| `POST` | `/calls/:id/hangup` | Hang up call |
| `GET` | `/phones` | List account phone numbers |
| `GET` | `/voices?provider=elevenlabs` | List TTS voices |

#### Production Security

Two layers: **origin allowlisting** + **per-agent tokens**.

```typescript
const eventServer = new EventServer({
  port: 4100,
  host: "0.0.0.0",
  requireAuth: true,
  allowedOrigins: ["https://dashboard.myapp.com", "http://localhost:3000"],
});

const salesToken = eventServer.attach(salesAgent);     // "evt_a1b2c3..."
const supportToken = eventServer.attach(supportAgent); // "evt_d4e5f6..."
const adminToken = eventServer.createToken(salesAgent, supportAgent);
eventServer.start();
```

```typescript
// Agent-scoped: only sees events from "sales" agent
const ws = new WebSocket("ws://localhost:4100", {
  headers: { Authorization: `Bearer ${salesToken}` }
});

// Admin: sees all agents
const adminWs = new WebSocket("ws://localhost:4100", {
  headers: { Authorization: `Bearer ${adminToken}` }
});
```

- **Without `requireAuth`** (default): all clients see all events — ideal for local dev
- **With `requireAuth: true`**: token required, events scoped to token's agents
- **`allowedOrigins`**: rejected at handshake if origin not in list

```
┌──────────────────────────────────────────────┐
│              Your Server (Node.js)           │
│                                              │
│  REST API :3000 ── agents, calls, phones     │
│  WS Events :4100 ── real-time events         │
│  Pinecall SDK ──── voice agent runtime       │
└──────────────────────────────────────────────┘
         ↑                    ↑
    Dashboard UI         Pinecall Cloud
  (your domain)        (voice infra)
```

#### Bidirectional WS Protocol

The EventServer is **bidirectional** — the UI receives events AND can send commands:

```typescript
const ws = new WebSocket("ws://localhost:4100");

// ── Events: Server → UI ─────────────────────────────────────
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  switch (event.event) {
    case "server.connected": console.log("Agents:", event.agents); break;
    case "call.started":     addCall(event); break;
    case "user.message":     showTranscript(event.call_id, event.text); break;
    case "llm.token":        appendToken(event.call_id, event.token); break;
    case "bot.speaking":     showBotSpeaking(event.call_id); break;
    case "bot.word":         addWord(event.call_id, event.word); break;
    case "call.held":        markHeld(event.call_id); break;
    case "call.muted":       markMuted(event.call_id); break;
    case "audio.metrics":    updateMetrics(event.call_id, event); break;
    case "call.ended":       removeCall(event.call_id); break;
  }
};

// ── Commands: UI → Server ────────────────────────────────────
ws.send(JSON.stringify({ action: "dial", agent_id: "sales", to: "+1234567890", from: "+0987654321" }));
ws.send(JSON.stringify({ action: "hangup", call_id: "CA..." }));
ws.send(JSON.stringify({ action: "configure", call_id: "CA...", voice: "elevenlabs:newvoice" }));
ws.send(JSON.stringify({ action: "agents" }));   // → agents.list response
ws.send(JSON.stringify({ action: "calls" }));     // → calls.list response
```

| Action | Payload | Response |
|--------|---------|----------|
| `dial` | `agent_id`, `to`, `from`, `greeting?` | `action.ok` + `call.started` event |
| `hangup` | `call_id` | `action.ok` + `call.ended` event |
| `configure` | `call_id`, `voice?`, `stt?`, `language?` | `action.ok` |
| `agents` | — | `agents.list` with ids, channels, calls |
| `calls` | — | `calls.list` with call details |

#### `pinecall run` vs `pinecall server`

| | `pinecall run` | `pinecall server` |
|---|---|---|
| **Purpose** | Dev & debugging | Production |
| **UI** | Interactive TUI | Web dashboard |
| **Events** | Console + colors | WS + REST API |
| **Multi-agent** | One TUI | Each agent gets token |
| **Dashboard** | — | Built-in React UI at `http://localhost:4100` |

```bash
# Dev mode — interactive TUI with slash commands
pinecall run Agent.js
pinecall run ./agents

# Server mode — headless with REST + WS + Dashboard UI
pinecall server Agent.js
pinecall server ./agents --port=4100
```

#### Dashboard UI

`pinecall server` includes a built-in web dashboard at the server URL (default `http://localhost:4100`).

Features:
- **Live call monitoring** — see active calls, user/bot transcripts in real-time
- **Agent management** — view deployed agents and their channels
- **Event log** — debug WebSocket events as they flow
- **Call controls** — dial, hangup, hold/unhold from the UI

The dashboard connects via WebSocket to the same EventServer and displays all forwarded events. No additional setup needed.

#### CLI Slash Commands

Available inside `pinecall run`:

| Command | Description |
|---------|-------------|
| `/phones` | List account phone numbers |
| `/voices [provider]` | List TTS voices |
| `/play <name\|id>` | Play voice preview (Ctrl+C to stop) |
| `/dial [agent] +number ["greeting"]` | Make outbound call |
| `/calls` | List active calls |
| `/switch <1\|sid>` | Select active call |
| `/config <key> <value>` | Change call config (voice, stt, turn, lang) |
| `/hangup` | Hang up selected call |
| `/hold` / `/unhold` | Hold / resume call |
| `/mute` / `/unmute` | Mute / unmute microphone |
| `/history` | Show raw LLM history (JSON) |
| `/help` | Context-aware help (shows call commands only when active) |

#### Vapi-Mode: Custom Server

```typescript
import { Pinecall } from "@pinecall/sdk";
import { EventServer } from "@pinecall/sdk/server";
import db from "./db.js";

const pc = new Pinecall({ apiKey: process.env.PINECALL_API_KEY });
await pc.connect();

const eventServer = new EventServer({
  port: 4100,
  host: "0.0.0.0",
  requireAuth: true,
  pinecall: pc,
});

for (const config of await db.agents.findAll()) {
  const agent = pc.agent(config.name, config);
  if (config.phone) agent.addChannel("phone", config.phone);
  const token = eventServer.attach(agent);
  console.log(`${config.name}: ${token}`);
}

eventServer.start();
// Server at http://0.0.0.0:4100 — REST + WS on same port
```

---

## Configuration

Config hierarchy (highest priority wins):

1. **Channel config** — per phone/WebRTC
2. **Agent config** — defaults for all channels
3. **Server defaults**

### STT (Speech-to-Text)

**String shortcut** — `"provider:model:language"`:

```typescript
stt: "deepgram:nova-3:es"     // → { provider: "deepgram", model: "nova-3", language: "es" }
stt: "deepgram:nova-3"         // → { provider: "deepgram", model: "nova-3" }
stt: "deepgram-flux"           // simple provider name
```

Or use the full object form for extra parameters (keywords, thresholds, etc.).

#### Deepgram Nova-3

30+ languages. Best general-purpose.

```typescript
stt: "deepgram:nova-3:en"   // shortcut
stt: { provider: "deepgram", language: "en", model: "nova-3" }   // full
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | string | — | `"deepgram"` |
| `language` | string | `"en"` | ISO language code |
| `model` | string | `"nova-3"` | Deepgram model |
| `keywords` | string[] | `[]` | Boost word recognition |
| `keyterms` | string[] | `[]` | Multi-word phrases |
| `interim_results` | bool | `true` | Partial transcripts |
| `smart_format` | bool | `true` | Formatting |
| `punctuate` | bool | `false` | Punctuation (adds latency) |

#### Deepgram Flux

English only. Ultra-low latency. Built-in turn detection.

> **Default for `Phone`** — `new Phone({ number: "..." })` uses Flux automatically. Pair with `turnDetection: "native"` (also the `Phone` default) for end-to-end lowest latency.

> **Deferred eager.turn:** In native mode, the server does NOT start LLM generation on Flux's `EagerEndOfTurn` — the speculative text changes too frequently. Instead, the server waits for `EndOfTurn` (final confirmed transcript) before emitting `eager.turn` + `user.message` + `turn.end`. This adds ~200ms latency but produces correct responses with stable text every time.

```typescript
stt: { provider: "deepgram-flux" }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `eot_threshold` | float | `0.7` | End-of-turn confidence |
| `eager_eot_threshold` | float | `0.5` | Early turn threshold |
| `eot_timeout_ms` | int | `2000` | Max silence before forcing end |

#### Gladia

Best for Arabic and Hebrew. Model: `solaria-1`.

```typescript
stt: { provider: "gladia", language: "ar" }
```

#### AWS Transcribe

30+ languages.

```typescript
stt: { provider: "transcribe", language: "en-US" }
```

### TTS (Text-to-Speech)

#### ElevenLabs

High quality. Word-level timestamps. Multilingual.

```typescript
voice: "elevenlabs:IKne3meq5aSn9XLyUdCD"

// Full config:
voice: {
    provider: "elevenlabs",
    voice_id: "IKne3meq5aSn9XLyUdCD",
    model: "eleven_flash_v2_5",
    speed: 1.0,
    stability: 0.5,
    similarity_boost: 0.8,
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `voice_id` | string | — | Voice ID |
| `model` | string | `"eleven_flash_v2_5"` | TTS model |
| `speed` | float | `1.0` | Speed (0.7–1.2) |
| `stability` | float | `0.5` | Stability (0–1) |
| `similarity_boost` | float | `0.8` | Similarity (0–1) |

#### Cartesia

Low latency. Emotion support. 40+ languages.

```typescript
voice: "cartesia:87748186-..."
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `voice_id` | string | — | Voice UUID |
| `model` | string | `"sonic-3"` | Model |
| `speed` | float | `1.0` | Speed (0.6–1.5) |
| `emotion` | string | `null` | `"neutral"`, `"happy"`, `"calm"` |

#### AWS Polly

Economic. Neural voices. SSML support.

```typescript
config: { tts: { provider: "polly", voice_id: "Joanna", engine: "neural" } }
```

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
| `threshold` | float | `0.5` | Sensitivity (0–1, lower = more sensitive) |
| `min_speech_ms` | int | `250` | Min speech duration |
| `min_silence_ms` | int | `350` | Silence before turn analysis |

### Turn Detection

```typescript
turnDetection: "smart_turn"

// Object form with options:
turnDetection: {
    mode: "smart_turn",
    silenceMs: 400,              // silence before analysis (default: 400)
    threshold: 0.7,              // end-of-turn probability threshold
    maxSilenceSeconds: 3.0,      // force end after this much silence
}
```

| Mode | Description | Best For |
|------|-------------|----------|
| `"smart_turn"` | ML prosody analysis | Most use cases |
| `"native"` | STT built-in (Flux, Deepgram) | Lowest latency |
| `"silence"` | Pure silence timeout | Simple bots |

#### SmartTurn Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `silenceMs` | int | `400` | Milliseconds of silence before running ML analysis |
| `threshold` | float | `0.7` | Probability threshold — higher = more patient |
| `maxSilenceSeconds` | float | `3.0` | Force turn end after this silence duration |

### Interruption

```typescript
interruption: false                     // disable
interruption: { enabled: true, min_duration_ms: 300 }

// Full config:
config: {
    interruption: {
        enabled: true,
        energy_threshold_db: -35.0,
        min_duration_ms: 300,
    }
}
```

### Hot-Reload

Update config during an active call:

```typescript
agent.configure({ voice: "cartesia:uuid", language: "fr" });
agent.configureSession(call.id, { voice: "cartesia:uuid" });
```

| ✅ Hot-reload supported | ❌ Requires new session |
|-------------------------|------------------------|
| TTS provider, voice, speed | Audio encoding |
| STT provider, language, model | |
| Turn detection mode/thresholds | |

---

## Events

### Call Lifecycle

| Event | Callback | Description |
|-------|----------|-------------|
| `call.started` | `(call)` | Call connected |
| `call.ended` | `(call, reason)` | Call terminated |

Reasons: `"hangup"`, `"disconnected"`, `"error"`, `"client_hangup"`, `"shutdown"`

### Turn Events

| Event | Callback | Description |
|-------|----------|-------------|
| `turn.end` | `(turn, call)` | **User finished — reply here** |
| `eager.turn` | `(turn, call)` | Early turn signal (lowest latency) |
| `turn.pause` | `(event, call)` | User might continue |
| `turn.resumed` | `(event, call)` | User continued after pause |
| `turn.continued` | `(event, call)` | User kept talking — abort reply |

### Transcript Events

| Event | Callback | Description |
|-------|----------|-------------|
| `user.speaking` | `(event, call)` | Interim transcript |
| `user.message` | `(event, call)` | Final transcript with `message_id` |

### Speech Events

| Event | Callback | Description |
|-------|----------|-------------|
| `speech.started` | `(event, call)` | User started speaking |
| `speech.ended` | `(event, call)` | User stopped speaking |

### Bot Events

| Event | Callback | Description |
|-------|----------|-------------|
| `bot.speaking` | `(event, call)` | Bot audio playing |
| `bot.word` | `(event, call)` | Word timestamp (subtitles) |
| `bot.finished` | `(event, call)` | Bot finished speaking |
| `bot.interrupted` | `(event, call)` | User interrupted bot |

Interruption reasons:

| Reason | Meaning | History |
|--------|---------|---------|
| `"user_spoke"` | After 2s | ✅ Add with `[interrupted]` |
| `"continuation"` | Before 2s | ❌ Discard |
| `"cancelled"` | App sent `bot.cancel` | ❌ Discard |

### Confirmation Events

| Event | Callback | Description |
|-------|----------|-------------|
| `message.confirmed` | `(event, call)` | Bot message confirmed |
| `reply.rejected` | `(event, call)` | Reply rejected (stale) |

### Connection Events

| Event | Callback | Description |
|-------|----------|-------------|
| `connected` | `()` | Authenticated |
| `disconnected` | `(reason)` | Connection lost |
| `reconnecting` | `(attempt)` | Reconnecting |
| `error` | `(err)` | Error |

---

## Protocol

### The `in_reply_to` Protocol

Every `user.message` has a `message_id`. Replies include `in_reply_to` to match. The server rejects stale replies automatically.

```
← user.message  (id: "A")        Start generating for "A"
← turn.continued                  User kept talking — abort "A"
← user.message  (id: "B")        Generate for "B" instead
→ bot.reply      (in_reply_to: "B")  ✅ Accepted
```

### Phone Exclusivity

Each phone number is exclusively owned by one agent. Reconnecting with the same `agent_id` displaces the previous connection.

---

## Supported Languages

| Language | STT Provider | Notes |
|----------|-------------|-------|
| English | Deepgram Nova-3, Flux | Flux = ultra-low latency |
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
