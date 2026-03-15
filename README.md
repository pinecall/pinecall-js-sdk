# @pinecall/sdk

Build AI voice agents in minutes — TypeScript SDK + CLI for real-time voice over phone, WebRTC, or browser mic.

```bash
npm install @pinecall/sdk
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [SDK Core](#sdk-core)
  - [Pinecall Client](#pinecall-client)
  - [Agent](#agent)
  - [Call](#call)
  - [ReplyStream](#replystream)
- [AI Agents (`@pinecall/sdk/ai`)](#ai-agents)
  - [Agent Base Class](#agent-base-class)
  - [GPTAgent](#gptagent)
  - [Channels (Phone, WebRTC)](#channels)
  - [Tool Calling](#tool-calling)
  - [ConversationHistory](#conversationhistory)
- [CLI](#cli)
  - [`pinecall run`](#pinecall-run)
  - [`pinecall server`](#pinecall-server)
  - [`pinecall dial`](#pinecall-dial)
  - [`pinecall agent`](#pinecall-agent)
  - [`pinecall test`](#pinecall-test)
- [Server (`@pinecall/sdk/server`)](#server)
  - [EventServer](#eventserver)
  - [REST API](#rest-api)
  - [WebSocket Commands](#websocket-commands)
  - [WebSocket Events](#websocket-events)
  - [Dashboard UI](#dashboard-ui)
- [Configuration Reference](#configuration-reference)
  - [Agent Config](#agent-config)
  - [STT Providers](#stt-providers)
  - [TTS Providers](#tts-providers)
  - [VAD Config](#vad-config)
  - [Turn Detection](#turn-detection)
  - [Interruption](#interruption)
  - [Analysis](#analysis)
  - [Session Config](#session-config)
  - [`pinecall.config.json`](#pinecallconfigjson)
- [Environment Variables](#environment-variables)
- [Events Reference](#events-reference)

---

## Quick Start

### 1. Simple Agent (5 lines)

```typescript
import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class MyBot extends GPTAgent {
  model = "gpt-4.1-nano";
  phone = new Phone("+13186330963");
  instructions = "You are a friendly receptionist. Be concise.";
}

export default MyBot;
```

Run it:

```bash
export PINECALL_API_KEY=pk_...
pinecall run MyBot.ts          # Dev mode with interactive TUI
pinecall server MyBot.ts       # Production headless server + Dashboard
```

### 2. Agent with Tools

```typescript
import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Receptionist extends GPTAgent {
  model = "gpt-4.1-nano";
  phone = new Phone("+13186330963");
  instructions = "You are a restaurant receptionist. Help guests book tables.";
  greeting = "Hello! Welcome to La Bella. How can I help you today?";

  async bookTable({ date, guests, name }: { date: string; guests: number; name: string }) {
    // Your booking logic here
    return { confirmed: true, date, guests, name, table: "A12" };
  }
}

Receptionist.defineTool("bookTable", "Book a table at the restaurant", {
  date: { type: "string", description: "Reservation date (YYYY-MM-DD)" },
  guests: { type: "number", description: "Number of guests" },
  name: { type: "string", description: "Name for the reservation" },
});

export default Receptionist;
```

### 3. Declarative Config (No Code)

Create `pinecall.json`:

```json
{
  "agents": [
    {
      "name": "receptionist",
      "model": "gpt-4.1-nano",
      "phone": "+13186330963",
      "voice": "elevenlabs:JBFqnCBsd6RMkjVDRZzb",
      "language": "en",
      "instructions": "You are a helpful receptionist.",
      "greeting": "Hello! How can I help you?"
    }
  ]
}
```

```bash
pinecall server   # auto-detects pinecall.json
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Your Agent Code                      │
│  (GPTAgent subclass, Agent subclass, or pinecall.json)    │
├──────────────────────────────────────────────────────────┤
│              @pinecall/sdk/ai (Agent, GPTAgent)           │
│         onTurn() hook • tool calling • history            │
├──────────────────────────────────────────────────────────┤
│              @pinecall/sdk (core)                         │
│     Pinecall client • Agent • Call • ReplyStream          │
├──────────────────────────────────────────────────────────┤
│              @pinecall/sdk/server (EventServer)           │
│       REST API • WebSocket events • Dashboard UI          │
├──────────────────────────────────────────────────────────┤
│                   Pinecall Cloud                          │
│     STT • TTS • VAD • Turn Detection • Telephony          │
└──────────────────────────────────────────────────────────┘
```

**Package exports:**

| Import | Description |
|--------|-------------|
| `@pinecall/sdk` | Core: `Pinecall`, `Agent`, `Call`, `ReplyStream` |
| `@pinecall/sdk/ai` | AI Agents: `Agent`, `GPTAgent`, `Phone`, `WebRTC`, `Channel` |
| `@pinecall/sdk/server` | Server: `EventServer` (REST + WS + Dashboard) |

---

## SDK Core

### Pinecall Client

The connection manager. Handles WebSocket auth, reconnection, ping/pong, and multiplexes events to agents.

```typescript
import { Pinecall } from "@pinecall/sdk";

const pc = new Pinecall({
  apiKey: "pk_...",           // required
  url: "wss://...",           // optional, default: wss://voice.pinecall.io/client
  reconnect: true,            // true (default) | false | ReconnectOptions
  pingInterval: 30000,        // ms, default: 30000. Set 0 to disable
});

await pc.connect();

// Create agents
const sales = pc.agent("sales", { voice: "elevenlabs:abc" });
sales.addChannel("phone", "+19035551234");

// Listen for events
pc.on("connected", () => console.log("Connected"));
pc.on("disconnected", (reason) => console.log("Disconnected:", reason));
pc.on("reconnecting", (attempt) => console.log("Reconnecting #", attempt));
pc.on("error", (err) => console.log("Error:", err.message));

// Agent events are proxied to pc for single-agent convenience
pc.on("call.started", (call) => call.say("Hello!"));
pc.on("turn.end", (turn, call) => call.reply("Got it!"));

await pc.disconnect();
```

#### PinecallOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | **Required.** Your Pinecall API key |
| `url` | `string` | `wss://voice.pinecall.io/client` | WebSocket URL |
| `reconnect` | `boolean \| ReconnectOptions` | `true` | Auto-reconnect on disconnect |
| `pingInterval` | `number` | `30000` | Ping interval (ms). `0` to disable |

#### ReconnectOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `Infinity` | Max reconnect attempts |
| `initialDelay` | `number` | `1000` | First retry delay (ms) |
| `maxDelay` | `number` | `30000` | Max retry delay (ms) |
| `backoffMultiplier` | `number` | `2` | Exponential backoff factor |

#### Static Methods

```typescript
// Fetch available voices
const voices = await Pinecall.fetchVoices({ provider: "elevenlabs" });

// Fetch available phone numbers
const phones = await Pinecall.fetchPhones({ apiKey: "pk_..." });
```

---

### Agent

A logical voice agent within a Pinecall connection. Owns channels and receives events.

```typescript
const agent = pc.agent("my-agent", {
  voice: "elevenlabs:JBFqnCBsd6RMkjVDRZzb",
  language: "es",
  stt: "deepgram:nova-3",
  turnDetection: "smart_turn",
  interruption: false,
  llm: "openai:gpt-4.1-nano",
});

// Add channels
agent.addChannel("phone", "+19035551234");
agent.addChannel("phone", "+19035555678", { voice: "cartesia:xyz" });
agent.addChannel("webrtc");
agent.addChannel("mic");

// Dial outbound
const call = await agent.dial({ to: "+12025551234", from: "+19035551234" });

// Configure mid-session
agent.configure({ voice: "cartesia:xyz" });

// Events
agent.on("call.started", (call) => { /* ... */ });
agent.on("turn.end", (turn, call) => { /* ... */ });
```

---

### Call

Per-session handle for interacting with a voice call. Created automatically on `call.started`.

```typescript
agent.on("call.started", (call) => {
  console.log(`Call ${call.id} from ${call.from} to ${call.to} (${call.direction})`);

  // Greeting
  call.say("Hello! How can I help you?");
});

agent.on("turn.end", (turn, call) => {
  console.log(`User said: "${turn.text}" (confidence: ${turn.confidence})`);

  // Reply to latest user message (auto-tracks in_reply_to)
  call.reply("Sure, let me check that for you.");
});
```

#### Call Methods

| Method | Description |
|--------|-------------|
| `call.say(text)` | Send a standalone message (greeting, announcement) |
| `call.reply(text, opts?)` | Reply to the latest user message (auto `in_reply_to`) |
| `call.replyStream(turn?)` | Create a streaming reply (returns `ReplyStream`) |
| `call.cancel(messageId?)` | Cancel a specific or current message |
| `call.clear()` | Clear all queued audio |
| `call.hangup()` | End the call |
| `call.forward(to, opts?)` | Forward to another number |
| `call.sendDTMF(digits)` | Send DTMF tones (e.g., `"1234#"`) |
| `call.configure(opts)` | Update config mid-call |
| `call.hold()` | Put on hold (plays hold music) |
| `call.unhold()` | Take off hold |
| `call.mute()` | Mute mic (transcripts buffered) |
| `call.unmute()` | Unmute (flushes buffered transcripts) |

#### Call Properties

| Property | Type | Description |
|----------|------|-------------|
| `call.id` | `string` | Call/session ID |
| `call.from` | `string` | Caller number |
| `call.to` | `string` | Callee number |
| `call.direction` | `"inbound" \| "outbound"` | Call direction |
| `call.metadata` | `Record<string, unknown>` | Custom metadata |
| `call.lastMessageId` | `string \| null` | Latest user message ID |

#### ForwardOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `message` | `string` | `""` | Message to play before forwarding |
| `announce` | `boolean` | `false` | Announce the forward to the caller |

---

### ReplyStream

Streaming reply — write tokens incrementally, TTS speaks as tokens arrive.

```typescript
agent.on("turn.end", async (turn, call) => {
  const stream = call.replyStream(turn);

  // Stream from LLM
  for await (const chunk of llmStream) {
    stream.write(chunk.text);
  }
  stream.end();
});
```

| Method | Description |
|--------|-------------|
| `stream.write(text)` | Send a text chunk |
| `stream.end()` | Finalize the stream |
| `stream.abort()` | Cancel the stream |

---

## AI Agents

High-level agent classes that handle connection, channels, conversation history, and the LLM loop.

```typescript
import { Agent, GPTAgent, Phone, WebRTC, Channel } from "@pinecall/sdk/ai";
```

### Agent Base Class

Override `onTurn()` to plug in any LLM.

```typescript
import { Agent, Phone } from "@pinecall/sdk/ai";

class MyBot extends Agent {
  phone = new Phone("+13186330963");
  instructions = "You are helpful.";
  turnEvent = "turn.end"; // or "eager.turn" (default)

  async onTurn(turn, call, history) {
    // Call your LLM
    const response = await myLLM(history.toMessages());

    // Reply
    call.reply(response);
    history.addAssistant(response);
  }
}
```

#### Agent Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string` | — | LLM model (e.g., `"gpt-4.1-nano"`) |
| `instructions` | `string` | `"You are a helpful voice assistant."` | System prompt |
| `greeting` | `string` | — | Auto-spoken on call start |
| `voice` | `string \| object` | — | TTS voice (`"elevenlabs:id"` or config) |
| `language` | `string` | — | Language code (`"en"`, `"es"`, `"fr"`, ...) |
| `stt` | `string \| object` | — | STT provider (`"deepgram"`, `"deepgram:nova-3"`, ...) |
| `turnDetection` | `string \| object` | — | `"smart_turn"`, `"native"`, `"silence"` |
| `interruption` | `boolean \| object` | — | `false` to disable, or config object |
| `temperature` | `number` | — | LLM temperature (server-side) |
| `maxTokens` | `number` | — | Max response tokens (server-side) |
| `turnEvent` | `string` | `"eager.turn"` | Which event triggers `onTurn()` |
| `phone` | `Phone` | — | Single phone channel shortcut |
| `channels` | `Channel[]` | — | Multiple channels |

#### Agent Methods

| Method | Description |
|--------|-------------|
| `agent.start()` | Connect and start listening |
| `agent.stop()` | Disconnect |
| `agent.dial({ to, from, greeting? })` | Make an outbound call |
| `agent.addPhone(number, config?)` | Add a phone channel |
| `agent.addChannel(type, ref?, config?)` | Add any channel type |

---

### GPTAgent

Extends `Agent` with server-side OpenAI integration. The server handles LLM calls directly — zero SDK round-trips.

```typescript
import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Sales extends GPTAgent {
  model = "gpt-4.1-nano";     // Always server-side
  phone = new Phone("+13186330963");
  instructions = "You are a sales agent.";
  greeting = "Hi! How can I help?";
  temperature = 0.7;
  maxTokens = 150;
}

export default Sales;
```

**No `onTurn()` override needed** — the server handles OpenAI calls. Define tools as class methods.

---

### Channels

```typescript
import { Phone, WebRTC, Channel } from "@pinecall/sdk/ai";

// Phone channel
const phone = new Phone("+13186330963");
phone.voice = "elevenlabs:JBFqnCBsd6RMkjVDRZzb";
phone.greeting = "Hello from this number!";

// WebRTC channel
const webrtc = new WebRTC();

// Multiple channels
class Multi extends GPTAgent {
  model = "gpt-4.1-nano";
  channels = [
    new Phone("+13186330963"),
    new Phone("+12025551234", { voice: "cartesia:xyz" }),
    new WebRTC(),
  ];
}
```

#### Channel Config

Each channel can override agent-level config:

```typescript
const phone = new Phone("+13186330963");
phone.voice = "elevenlabs:voiceId";
phone.language = "es";
phone.stt = "deepgram:nova-3";
phone.greeting = "¡Hola!";
phone.turnDetection = { mode: "smart_turn", smart_turn_threshold: 0.6 };
```

---

### Tool Calling

Define tools as class methods + register with `defineTool()`:

```typescript
class Agent extends GPTAgent {
  model = "gpt-4.1-nano";
  instructions = "You help book appointments.";

  async bookAppointment({ date, time }: { date: string; time: string }) {
    const result = await db.book(date, time);
    return { success: true, confirmationId: result.id };
  }

  async getWeather({ city }: { city: string }) {
    const data = await weatherApi.get(city);
    return { temp: data.temp, condition: data.condition };
  }
}

Agent.defineTool("bookAppointment", "Book an appointment", {
  date: { type: "string", description: "Date (YYYY-MM-DD)" },
  time: { type: "string", description: "Time (HH:MM)" },
});

Agent.defineTool("getWeather", "Get current weather", {
  city: { type: "string", description: "City name" },
});
```

Tool parameters follow [JSON Schema](https://json-schema.org/) format. The return value is sent back to the LLM as the tool result.

---

### ConversationHistory

Automatically tracks conversation messages. Available in `onTurn()`:

```typescript
async onTurn(turn, call, history) {
  // Access messages
  const messages = history.toMessages(); // OpenAI-compatible format

  // Manual management
  history.addUser("User said this");
  history.addAssistant("Bot replied this");
  history.addSystem("System note");
}
```

---

## CLI

```bash
npm install -g @pinecall/sdk   # or use npx
```

### `pinecall run`

Run an agent in **dev mode** with an interactive TUI (terminal UI).

```bash
pinecall run MyBot.ts                          # single file
pinecall run ./agents/                         # directory of agents
pinecall run MyBot.ts --port=4200              # custom port
pinecall run MyBot.ts --es                     # Spanish preset
pinecall run MyBot.ts --lang=fr                # French preset
```

**TUI Features:**
- Live conversation view (user/bot bubbles)
- LLM pane (streaming responses)
- Audio waveform
- In-CLI commands: `/phones`, `/voices`, `/dial`, `/config`, `/help`
- Keyboard shortcuts: `Ctrl+O` command palette, `Ctrl+T` text input, `Ctrl+Y` copy

---

### `pinecall server`

Start a headless production server with REST API, WebSocket events, and Dashboard UI.

```bash
pinecall server MyBot.ts                       # single agent file
pinecall server ./agents/                      # directory of agents
pinecall server                                # auto-detect pinecall.json
pinecall server --config=custom.json           # custom config file
pinecall server --port=4100                    # custom port (default: 4100)
pinecall server --host=0.0.0.0                 # bind address (default: 0.0.0.0)
pinecall server --disable-ui                   # disable Dashboard UI
```

**Features:**
- REST API for agent management and call control
- WebSocket for real-time events and commands
- Built-in Dashboard UI (auto-opens in browser)
- Config persistence with `pinecall.json`
- Hot-deploy agents via POST `/agents`

---

### `pinecall dial`

Make an outbound call.

```bash
pinecall dial +12025551234                     # dial a number
pinecall dial +12025551234 --from=+13186330963 # specify caller ID
```

---

### `pinecall agent`

Start a simple inbound voice agent.

```bash
pinecall agent                                 # start with defaults
pinecall agent --es                            # Spanish mode
```

---

### `pinecall test`

Run a connectivity smoke test.

```bash
pinecall test
```

---

## Server

### EventServer

The server component that bridges your agents with external clients via REST and WebSocket.

```typescript
import { EventServer } from "@pinecall/sdk/server";

const server = new EventServer({
  port: 4100,              // default: 4100
  host: "0.0.0.0",         // default: "127.0.0.1"
  pinecall: pc,            // Pinecall client instance
  ui: true,                // serve Dashboard UI (default: true)
  requireAuth: false,      // require Bearer token (default: false)
  allowedOrigins: null,    // CORS origins (default: allow all)
});

// Attach agents
const token = server.attach(agent);
console.log("Agent token:", token);

// Detach agents
server.detach(agent);

// Start
server.start();
```

#### EventServerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `4100` | Server port |
| `host` | `string` | `"127.0.0.1"` | Bind address |
| `pinecall` | `Pinecall` | — | Client instance (needed for REST) |
| `ui` | `boolean` | `true` | Serve built-in Dashboard UI |
| `requireAuth` | `boolean` | `false` | Require token auth for WS |
| `allowedOrigins` | `string[]` | `null` | Restrict CORS origins |

---

### REST API

All endpoints return JSON. Base URL: `http://localhost:4100`

#### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents` | List all agents (with config) |
| `POST` | `/agents` | Deploy a new agent |
| `PATCH` | `/agents/:name` | Configure an agent |
| `DELETE` | `/agents/:name` | Remove an agent |
| `POST` | `/agents/:name/dial` | Make an outbound call |

**POST /agents** — Deploy agent:

```bash
curl -X POST http://localhost:4100/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"sales","model":"gpt-4.1-nano","phone":"+13186330963","instructions":"You are a sales bot."}'
```

**POST /agents/:name/dial** — Outbound call:

```bash
curl -X POST http://localhost:4100/agents/sales/dial \
  -H "Content-Type: application/json" \
  -d '{"to":"+12025551234","from":"+13186330963","greeting":"Hello!"}'
```

**GET /agents** — List agents (includes config):

```json
{
  "agents": [
    {
      "id": "sales",
      "channels": ["+13186330963"],
      "calls": ["CA_abc123"],
      "token": "tok_...",
      "config": {
        "voice": "elevenlabs:JBFqnCBsd6RMkjVDRZzb",
        "llm": { "model": "gpt-4.1-nano", "instructions": "..." }
      }
    }
  ]
}
```

#### Calls

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/calls` | List active calls |
| `PATCH` | `/calls/:id` | Configure a call mid-session |
| `POST` | `/calls/:id/hangup` | Hang up a call |

**PATCH /calls/:id** — Configure mid-call:

```bash
curl -X PATCH http://localhost:4100/calls/CA_abc123 \
  -H "Content-Type: application/json" \
  -d '{"voice":"cartesia:xyz","language":"es"}'
```

#### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/phones` | List available phone numbers |
| `GET` | `/voices` | List TTS voices |
| `GET` | `/voices?provider=cartesia` | Filter by provider |

---

### WebSocket Commands

Connect to `ws://localhost:4100` and send JSON commands.

#### Connection

Authenticate with a token on connect:

```json
{ "action": "auth", "token": "tok_..." }
```

#### Agent & Call Commands

| Action | Payload | Description |
|--------|---------|-------------|
| `dial` | `{ agent_id, to, from, greeting? }` | Outbound call |
| `hangup` | `{ call_id }` | End a call |
| `configure` | `{ call_id, ...config }` | Configure call |
| `forward` | `{ call_id, to }` | Forward call to number |
| `dtmf` | `{ call_id, digits }` | Send DTMF tones |
| `hold` | `{ call_id }` | Put call on hold |
| `unhold` | `{ call_id }` | Take call off hold |
| `mute` | `{ call_id }` | Mute mic |
| `unmute` | `{ call_id }` | Unmute mic |
| `agents` | `{}` | List agents |
| `calls` | `{}` | List active calls |

**Example:**

```json
{ "action": "dtmf", "call_id": "CA_abc123", "digits": "123#" }
```

**Responses:**

```json
{ "event": "action.ok", "action": "dtmf", "call_id": "CA_abc123" }
{ "event": "error", "action": "dtmf", "message": "Call not found: CA_xyz" }
```

---

### WebSocket Events

Events are broadcast to connected clients in real-time.

#### Connection Lifecycle

| Event | Data | Description |
|-------|------|-------------|
| `server.connected` | `{}` | SDK connected to cloud |
| `server.disconnected` | `{}` | SDK lost connection |
| `server.reconnecting` | `{}` | SDK reconnecting |

#### Call Lifecycle

| Event | Data | Description |
|-------|------|-------------|
| `call.started` | `{ call_id, agent_id, from, to, direction }` | Call began |
| `call.ended` | `{ call_id, agent_id, reason }` | Call ended |

#### Speech & Turn

| Event | Data | Description |
|-------|------|-------------|
| `speech.started` | `{ call_id }` | User started speaking |
| `speech.ended` | `{ call_id }` | User stopped speaking |
| `user.speaking` | `{ call_id, text }` | Interim transcript |
| `user.message` | `{ call_id, message_id, text, confidence }` | Final transcript |
| `eager.turn` | `{ call_id, turn_id, message_id, text }` | Early turn (before confirmed) |
| `turn.pause` | `{ call_id, turn_id }` | Turn paused (silence) |
| `turn.end` | `{ call_id, turn_id, message_id, text, confidence }` | Confirmed turn end |
| `turn.resumed` | `{ call_id, turn_id }` | User continued speaking |
| `turn.continued` | `{ call_id, turn_id }` | Turn continues after pause |

#### Bot

| Event | Data | Description |
|-------|------|-------------|
| `bot.speaking` | `{ call_id, message_id }` | Bot started speaking |
| `bot.word` | `{ call_id, message_id, word, index }` | Word-level TTS sync |
| `bot.finished` | `{ call_id, message_id }` | Bot finished speaking |
| `bot.interrupted` | `{ call_id, message_id }` | Bot was interrupted |
| `message.confirmed` | `{ call_id, message_id }` | Message delivery confirmed |
| `reply.rejected` | `{ call_id, message_id, reason }` | Reply was rejected |

#### Analysis

| Event | Data | Description |
|-------|------|-------------|
| `audio.metrics` | `{ call_id, rms, peak, energy_db, is_speech, vad_prob }` | Audio analytics |

#### Channel

| Event | Data | Description |
|-------|------|-------------|
| `channel.added` | `{ agent_id, type, ref }` | Channel registered |
| `channel.configured` | `{ agent_id, ref }` | Channel configured |
| `channel.removed` | `{ agent_id, ref }` | Channel removed |

---

### Dashboard UI

The SDK includes a built-in Dashboard UI served by EventServer at `http://localhost:4100`.

**Features:**
- Real-time connection status
- Agent list with config display (model, voice, language, STT, instructions)
- Live conversation view with user/bot message bubbles
- Active call controls: DTMF keypad, Forward, Hold, Mute, Hangup
- Audio waveform visualization
- Outbound dialer with phone keypad
- Event log with JSON detail modal
- Phone numbers list

**Disable:**

```bash
pinecall server --disable-ui
```

Or in `pinecall.config.json`:

```json
{ "ui": false }
```

---

## Configuration Reference

### Agent Config

Shortcut syntax for quick configuration:

```typescript
const agent = pc.agent("bot", {
  voice: "elevenlabs:JBFqnCBsd6RMkjVDRZzb",   // provider:id
  stt: "deepgram:nova-3",                       // provider:model
  language: "en",
  turnDetection: "smart_turn",                   // mode name
  interruption: false,                           // disable
  llm: "openai:gpt-4.1-nano",                   // provider:model
});
```

Or full config objects:

```typescript
const agent = pc.agent("bot", {
  voice: {
    provider: "elevenlabs",
    voice_id: "JBFqnCBsd6RMkjVDRZzb",
    model: "eleven_turbo_v2_5",
    speed: 1.1,
    stability: 0.5,
    similarity_boost: 0.8,
  },
  stt: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
    smart_format: true,
    endpointing_ms: 300,
  },
  turnDetection: {
    mode: "smart_turn",
    smart_turn_threshold: 0.5,
  },
  interruption: {
    enabled: true,
    energy_threshold_db: -40,
    min_duration_ms: 200,
  },
});
```

---

### STT Providers

#### Deepgram

```typescript
stt: {
  provider: "deepgram",
  model: "nova-3",              // default
  language: "en",
  interim_results: true,
  smart_format: true,
  punctuate: true,
  profanity_filter: false,
  use_native_vad: false,
  endpointing_ms: 300,
  utterance_end_ms: 1000,
  keywords: ["pinecall"],
  keyterms: ["appointment"],
  min_confidence: null,
}

// Shortcut: "deepgram" or "deepgram:nova-3" or "deepgram:nova-3:es"
```

#### Deepgram Flux

```typescript
stt: {
  provider: "deepgram-flux",
  language: "multi",
  eot_threshold: 0.5,
  eager_eot_threshold: 0.7,
  eot_timeout_ms: 2000,
  keyterms: ["pinecall"],
  min_confidence: null,
}

// Shortcut: "deepgram-flux" or "flux"
```

> **Note:** When using Deepgram Flux in native mode, `eager.turn` events are deferred until the `turn.end` confirmation is received. This prevents premature LLM invocation on partial transcripts.

#### Gladia

```typescript
stt: {
  provider: "gladia",
  model: "accurate",             // or "fast"
  language: "en",
  endpointing: 300,
  max_duration_without_endpointing: 5000,
  speech_threshold: 0.8,
  code_switching: false,
  audio_enhancer: true,
}

// Shortcut: "gladia"
```

#### Transcribe (Azure)

```typescript
stt: {
  provider: "transcribe",
  language: "en-US",
}

// Shortcut: "transcribe"
```

---

### TTS Providers

#### ElevenLabs

```typescript
voice: {
  provider: "elevenlabs",
  voice_id: "JBFqnCBsd6RMkjVDRZzb",
  model: "eleven_turbo_v2_5",
  speed: 1.0,
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
  language: null,
}

// Shortcut: "elevenlabs:JBFqnCBsd6RMkjVDRZzb"
```

#### Cartesia

```typescript
voice: {
  provider: "cartesia",
  voice_id: "a0e99841-438c-4a64-b679-ae501e7d6091",
  model: "sonic",
  speed: 1.0,
  volume: 1.0,
  emotion: null,
  language: "en",
}

// Shortcut: "cartesia:a0e99841-438c-4a64-b679-ae501e7d6091"
```

#### AWS Polly

```typescript
voice: {
  provider: "polly",
  voice_id: "Joanna",
  engine: "neural",          // or "standard"
  language: "en-US",
  rate: null,
  volume: null,
  pitch: null,
}

// Shortcut: "polly:Joanna"
```

---

### VAD Config

```typescript
config: {
  vad: {
    provider: "silero",        // or "native"
    threshold: 0.5,
    min_speech_ms: 250,
    min_silence_ms: 200,
    speech_end_delay_ms: 400,
  }
}
```

---

### Turn Detection

```typescript
turnDetection: {
  mode: "smart_turn",         // "smart_turn" | "native" | "silence"
  smart_turn_threshold: 0.5,  // sensitivity (0-1, lower = faster)
  native_silence_ms: 500,     // for native mode
  max_silence_seconds: 2,     // for silence mode
}

// Shortcuts: "smart_turn", "native", "silence"
```

| Mode | Description |
|------|-------------|
| `smart_turn` | AI-powered turn detection (recommended) |
| `native` | STT provider's built-in endpointing |
| `silence` | Simple silence timer |

---

### Interruption

```typescript
interruption: {
  enabled: true,
  energy_threshold_db: -40,    // minimum audio energy to interrupt
  min_duration_ms: 200,        // minimum speech duration to interrupt
}

// Shortcut: false (disables interruption)
```

---

### Analysis

```typescript
config: {
  analysis: {
    send_audio_metrics: true,       // emit audio.metrics events
    audio_metrics_interval_ms: 100, // metrics interval
    send_turn_audio: false,         // include raw audio in turn events
    send_bot_audio: false,          // include bot audio data
  }
}
```

---

### Session Config

Full `config` object passed via `agent.configure()` or `call.configure()`:

```typescript
{
  config: {
    stt: { /* STT provider config */ },
    tts: { /* TTS provider config */ },
    vad: { /* VAD config */ },
    turn_detection: { /* Turn detection config */ },
    interruption: { /* Interruption config */ },
    speaker_filter: {
      enabled: true,
      energy_threshold_db: -45,
      warmup_seconds: 3,
    },
    analysis: { /* Analysis config */ },
  }
}
```

---

### `pinecall.config.json`

Server configuration file. Auto-detected in the current directory.

```json
{
  "port": 4100,
  "host": "0.0.0.0",
  "ui": true,
  "agentsDir": "./agents",
  "agents": [
    {
      "name": "receptionist",
      "model": "gpt-4.1-nano",
      "phone": "+13186330963",
      "voice": "elevenlabs:JBFqnCBsd6RMkjVDRZzb",
      "language": "en",
      "stt": "deepgram:nova-3",
      "turnDetection": "smart_turn",
      "interruption": true,
      "instructions": "You are a helpful receptionist.",
      "greeting": "Hello! How can I help you?"
    },
    {
      "name": "spanish-bot",
      "model": "gpt-4.1-nano",
      "phone": "+12025551234",
      "voice": "elevenlabs:xyz",
      "language": "es",
      "instructions": "Eres un asistente amable.",
      "greeting": "¡Hola! ¿En qué puedo ayudarte?"
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `4100` | Server port |
| `host` | `string` | `"0.0.0.0"` | Bind address |
| `ui` | `boolean` | `true` | Serve Dashboard UI |
| `agentsDir` | `string` | — | Directory of agent `.js/.ts` files |
| `agents` | `AgentConfig[]` | `[]` | Inline agent declarations |

#### Agent Config Fields (JSON)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | **Required.** Agent name |
| `model` | `string` | LLM model (`"gpt-4.1-nano"`, `"gpt-4o-mini"`, etc.) |
| `phone` | `string` | Phone number to register |
| `voice` | `string` | TTS voice (`"elevenlabs:id"`) |
| `language` | `string` | Language code |
| `stt` | `string` | STT provider (`"deepgram"`, `"deepgram-flux"`, etc.) |
| `instructions` | `string` | System prompt |
| `greeting` | `string` | Auto-spoken on call start |
| `turnDetection` | `string` | Turn detection mode |
| `interruption` | `boolean` | Enable/disable interruption |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PINECALL_API_KEY` | ✅ | Your Pinecall API key |
| `OPENAI_API_KEY` | For AI agents | OpenAI API key (server-side LLM) |
| `PINECALL_URL` | No | Custom WebSocket URL |
| `PINECALL_LOG` | No | Path to protocol debug log file |

---

## Events Reference

### Connection Events (Pinecall client)

| Event | Callback | Description |
|-------|----------|-------------|
| `connected` | `() => void` | Connected to cloud |
| `disconnected` | `(reason: string) => void` | Connection lost |
| `reconnecting` | `(attempt: number) => void` | Reconnecting |
| `error` | `(error: PinecallError) => void` | Error occurred |

### Agent Events

| Event | Callback | Description |
|-------|----------|-------------|
| `ready` | `() => void` | Agent registered on server |
| `call.started` | `(call: Call) => void` | New call |
| `call.ended` | `(call: Call, reason: string) => void` | Call ended |
| `speech.started` | `(event, call) => void` | User started speaking |
| `speech.ended` | `(event, call) => void` | User stopped speaking |
| `user.speaking` | `(event, call) => void` | Interim transcript |
| `user.message` | `(event, call) => void` | Final transcript |
| `eager.turn` | `(turn, call) => void` | Early turn detection |
| `turn.pause` | `(event, call) => void` | Turn paused |
| `turn.end` | `(turn, call) => void` | Confirmed turn end |
| `turn.resumed` | `(event, call) => void` | User resumed speaking |
| `turn.continued` | `(event, call) => void` | Turn continues |
| `bot.speaking` | `(event, call) => void` | Bot started TTS |
| `bot.word` | `(event, call) => void` | Word-level TTS sync |
| `bot.finished` | `(event, call) => void` | Bot finished TTS |
| `bot.interrupted` | `(event, call) => void` | Bot interrupted |
| `message.confirmed` | `(event, call) => void` | Message confirmed |
| `reply.rejected` | `(event, call) => void` | Reply rejected |
| `audio.metrics` | `(event, call) => void` | Audio analytics |
| `channel.added` | `(type, ref) => void` | Channel registered |
| `channel.configured` | `(ref) => void` | Channel configured |
| `channel.removed` | `(ref) => void` | Channel removed |

### Call Events

| Event | Callback | Description |
|-------|----------|-------------|
| `call.held` | `() => void` | Call put on hold |
| `call.unheld` | `() => void` | Call taken off hold |
| `call.muted` | `() => void` | Mic muted |
| `call.unmuted` | `(transcript: string \| null) => void` | Mic unmuted |
| `ended` | `(reason: string) => void` | Call ended |

*(Plus all speech/turn/bot events from Agent, scoped to the specific call)*

---

## License

MIT — Pinecall, Inc.
