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
  - [Dynamic Greeting](#dynamic-greeting)
  - [Server-Side LLM](#server-side-llm)
  - [History Management](#history-management)
  - [Tool Calling](#tool-calling)
  - [ConversationHistory](#conversationhistory)
- [CLI](#cli)
  - [`pinecall console`](#pinecall-console)
  - [`pinecall server`](#pinecall-server)
- [Server (`@pinecall/sdk/server`)](#server)
  - [EventServer](#eventserver)
  - [REST API](#rest-api)
  - [WebSocket Commands](#websocket-commands)
  - [WebSocket Events](#websocket-events)
  - [Authentication](#authentication)
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
- [Agent Database (Beta)](#agent-database-beta)
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
pinecall console MyBot.ts      # Interactive console with TUI
pinecall server MyBot.ts       # Production server + Dashboard UI
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

### 3. Server Mode with Config File

Create `pinecall.config.json` to configure the server:

```json
{
  "port": 4100,
  "host": "0.0.0.0",
  "ui": true,
  "agentsDir": "./agents"
}
```

```bash
pinecall server              # starts server, loads agents from ./agents/
pinecall server ./agents     # explicit agents directory
pinecall server --disable-ui # API only, no Dashboard
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Your Agent Code                      │
│  (GPTAgent subclass, Agent subclass, or dynamic API)      │
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
  apiKey: "pk_...",
  url: "wss://...",           // optional custom URL
  reconnect: true,            // true | false | ReconnectOptions
  pingInterval: 30000,        // ms, 0 to disable
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

#### Utility Methods

```typescript
// Static — fetch voices (no connection required)
const voices = await Pinecall.fetchVoices({ provider: "elevenlabs" });

// Static — fetch phone numbers (requires apiKey)
const phones = await Pinecall.fetchPhones({ apiKey: "pk_..." });

// Instance — fetch phones using the client's apiKey
const phones = await pc.fetchPhones();
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
});

// Add channels
agent.addChannel("phone", "+19035551234");
agent.addChannel("phone", "+19035555678", { voice: "cartesia:xyz" });
agent.addChannel("webrtc");

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
  call.say("Hello! How can I help you?");
});

agent.on("turn.end", (turn, call) => {
  console.log(`User said: "${turn.text}" (confidence: ${turn.confidence})`);
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

High-level agent classes that handle connection, channels, history, and the LLM loop.

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
    const response = await myLLM(history.toMessages());
    call.reply(response);
    history.addAssistant(response);
  }
}
```

#### Agent Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string` | — | LLM model (e.g., `"gpt-4.1-nano"`) |
| `instructions` | `string \| ((call) => string \| Promise<string>)` | `"You are a helpful voice assistant."` | System prompt. Supports callbacks |
| `greeting` | `string \| ((call) => string \| Promise<string>)` | — | Auto-spoken on call start. Supports async callbacks |
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

Extends `Agent` with server-side OpenAI integration. The server handles LLM calls — zero SDK round-trips.

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

// Phone channel with per-channel config
const phone = new Phone("+13186330963");
phone.voice = "elevenlabs:JBFqnCBsd6RMkjVDRZzb";
phone.greeting = "Hello from this number!";

// Multiple channels on one agent
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

#### Dynamic Greeting

`greeting` can be a callback for personalized greetings:

```typescript
class MyBot extends GPTAgent {
  model = "gpt-4.1-nano";
  phone = new Phone("+13186330963");

  // Time-based
  greeting = (call) => {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning!" : "Good afternoon!";
  };

  // Async — DB lookup by caller
  greeting = async (call) => {
    const user = await db.findByPhone(call.from);
    return user ? `Welcome back, ${user.name}!` : "Hello! How can I help?";
  };
}
```

The callback receives the full `Call` object with `call.from`, `call.to`, `call.direction`, and `call.metadata`.

#### Dynamic Instructions

`instructions` also supports callbacks for per-call system prompts:

```typescript
class MyBot extends GPTAgent {
  model = "gpt-4.1-nano";

  // Personalize system prompt per caller
  instructions = async (call) => {
    const user = await db.findByPhone(call.from);
    return user
      ? `You are helping ${user.name} (${user.plan} plan). Be friendly.`
      : "You are a helpful assistant. Ask for their name first.";
  };
}
```

When `instructions` is a callback, a default prompt is sent at registration and `call.setInstructions()` is called automatically when the call starts.

---

### Server-Side LLM

The Pinecall server can run LLM inference directly — the SDK only needs to define the model, instructions, and tools. This eliminates SDK round-trips for LLM calls and provides the lowest latency.

**Enable server-side LLM by setting `model`:**

```typescript
class MyBot extends GPTAgent {
  model = "gpt-4.1-nano";            // enables server-side LLM
  instructions = "You are a helpful receptionist.";
  greeting = "Hello! How can I help?";
  temperature = 0.7;                   // LLM temperature
  maxTokens = 150;                     // max response tokens
}
```

With `GPTAgent`, the server handles everything: receiving user turns, calling OpenAI, streaming TTS, and managing tool calls. No `onTurn()` override is needed.

**LLM is optional.** If you don't set `model`, you handle LLM calls yourself in `onTurn()`:

```typescript
class CustomBot extends Agent {
  // No model — you control the LLM
  async onTurn(turn, call, history) {
    const response = await myCustomLLM(turn.text);
    call.reply(response);
  }
}
```

#### LLM Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string` | — | LLM model name (e.g., `"gpt-4.1-nano"`, `"gpt-4o-mini"`) |
| `instructions` | `string \| ((call) => string \| Promise<string>)` | `"You are a helpful voice assistant."` | System prompt |
| `temperature` | `number` | — | Sampling temperature (0-2) |
| `maxTokens` | `number` | — | Maximum response tokens |
| `greeting` | `string \| ((call) => string \| Promise<string>)` | — | Auto-spoken on call start |
| `turnEvent` | `string` | `"eager.turn"` | When to invoke LLM: `"eager.turn"` or `"turn.end"` |

#### LLM Events

When using server-side LLM, these events are emitted and streamed to WS clients:

| Event | Description |
|-------|-------------|
| `llm.stream` | Streaming LLM response chunk (text token) |
| `llm.tool_call` | LLM invoked a tool (name + arguments) |
| `llm.tool_result` | Tool execution result returned to LLM |

#### History Management

The server maintains conversation history per call. You can read, inject, clear, or update the system prompt mid-call using these `Call` methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `call.getHistory()` | `Promise<Message[]>` | Fetch full conversation history (OpenAI format) |
| `call.setHistory(messages)` | `Promise<number>` | Replace entire history (for restoring saved state) |
| `call.addHistory(messages)` | `Promise<number>` | Inject messages into history (e.g. CRM context) |
| `call.clearHistory()` | `Promise<number>` | Clear history (system prompt preserved) |
| `call.setInstructions(text)` | `Promise<number>` | Update system prompt mid-call |

**Examples:**

```typescript
// Inject CRM context when call starts
agent.on("call.started", async (call) => {
  const customer = await db.findByPhone(call.from);
  if (customer) {
    await call.addHistory([
      { role: "system", content: `Customer: ${customer.name}, Plan: ${customer.plan}` }
    ]);
  }
});

// Change personality mid-call
await call.setInstructions("You are now a technical support agent. Be detailed.");

// Read current history
const messages = await call.getHistory();
console.log(`${messages.length} messages in history`);

// Reset conversation
await call.clearHistory(); // keeps system prompt
```

**Cross-call persistence (you manage storage):**

```typescript
// Restore previous conversation on call start
agent.on("call.started", async (call) => {
  const saved = await myDb.get(call.from);
  if (saved) await call.setHistory(saved);
});

// Save conversation when call ends
agent.on("call.ended", async (call) => {
  const history = await call.getHistory();
  await myDb.save(call.from, history);
});
```

All history methods use a request/response protocol (`history.get` → `history.data`, etc.) and return the updated message count.

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

**Tool call events** (`llm.tool_call`, `llm.tool_result`) are streamed to the Dashboard UI and WebSocket clients in real-time, so you can observe tool invocations and their results live.

---

### ConversationHistory

Automatically tracks conversation messages. Available in `onTurn()`:

```typescript
async onTurn(turn, call, history) {
  const messages = history.toMessages(); // OpenAI-compatible format

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

### `pinecall console`

Interactive agent console with a TUI (Terminal User Interface) for development.

```bash
pinecall console MyBot.ts           # single agent file
pinecall console ./agents/          # directory of agents
pinecall console MyBot.ts --dial=+12025551234  # auto-dial on start
pinecall console MyBot.ts --phone=+13186330963 # specify phone
```

**TUI Features:**
- Live conversation view (user/bot bubbles)
- LLM response pane
- Audio waveform
- Interactive command prompt

#### Console Commands

Once inside the console, use `/` commands:

| Command | Args | Description |
|---------|------|-------------|
| `/help` | | Show all available commands |
| `/phones` | | List available phone numbers |
| `/voices` | `[provider]` | List TTS voices (default: elevenlabs) |
| `/play` | `<name\|id> [provider]` | Play a voice preview |
| `/dial` | `[agent] +number ["greeting"]` | Make an outbound call |
| `/calls` | | List active calls |
| `/switch` | `<number\|sid>` | Select active call (multi-call) |
| `/config` | `<voice\|stt\|turn\|lang> <val>` | Change call config mid-call |
| `/hangup` | | Hang up selected call (or all) |
| `/hold` | | Put selected call on hold |
| `/unhold` | | Resume held call |
| `/mute` | | Mute microphone |
| `/unmute` | | Unmute microphone |
| `/history` | | Show raw LLM conversation history (JSON) |

**Config examples:**

```
/config voice elevenlabs:JBFqnCBsd6RMkjVDRZzb
/config stt deepgram:nova-3:es
/config turn smart_turn 600
/config lang fr
```

**Dial examples:**

```
/dial +12025551234
/dial sales +12025551234
/dial sales +12025551234 "Hello, this is support."
```

---

### `pinecall server`

Start a headless production server with REST API, WebSocket events, and Dashboard UI.

```bash
pinecall server MyBot.ts                       # single agent file
pinecall server ./agents/                      # directory of agents
pinecall server                                # auto-detect pinecall.config.json
pinecall server --config=custom.json           # custom config file
pinecall server --port=4100                    # custom port (default: 4100)
pinecall server --host=0.0.0.0                 # bind address (default: 0.0.0.0)
pinecall server --disable-ui                   # disable Dashboard UI
```

**Features:**
- REST API for agent management and call control
- WebSocket for real-time events and commands
- Built-in Dashboard UI (auto-opens in browser)
- Dynamic agent deployment via POST `/agents`
- Config-driven with `pinecall.config.json`

---

## Server

### EventServer

The server component that bridges your agents with external clients via REST and WebSocket.

```typescript
import { EventServer } from "@pinecall/sdk/server";

const server = new EventServer({
  port: 4100,
  host: "0.0.0.0",
  pinecall: pc,
  ui: true,
  requireAuth: false,
  allowedOrigins: null,
});

const token = server.attach(agent);
console.log("Agent token:", token);

server.start();
```

#### EventServerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `4100` | Server port |
| `host` | `string` | `"127.0.0.1"` | Bind address |
| `pinecall` | `Pinecall` | — | Client instance (needed for REST deploy) |
| `ui` | `boolean` | `true` | Serve built-in Dashboard UI |
| `requireAuth` | `boolean` | `false` | Require Bearer token for WS and REST |
| `allowedOrigins` | `string[]` | `null` | Restrict CORS origins (`null` = allow all) |

---

### REST API

All endpoints return JSON. Base URL: `http://localhost:4100`

#### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents` | List all agents (includes config) |
| `POST` | `/agents` | Deploy a new agent dynamically |
| `PATCH` | `/agents/:name` | Configure an agent |
| `DELETE` | `/agents/:name` | Remove an agent |
| `POST` | `/agents/:name/dial` | Make an outbound call |

**POST /agents** — Deploy agent dynamically:

```bash
curl -X POST http://localhost:4100/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sales",
    "model": "gpt-4.1-nano",
    "phone": "+13186330963",
    "instructions": "You are a sales bot.",
    "voice": "elevenlabs:JBFqnCBsd6RMkjVDRZzb"
  }'
```

**POST /agents/:name/dial** — Outbound call:

```bash
curl -X POST http://localhost:4100/agents/sales/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12025551234", "from": "+13186330963", "greeting": "Hello!"}'
```

**GET /agents** response:

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

#### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/phones` | List available phone numbers |
| `GET` | `/voices` | List TTS voices |
| `GET` | `/voices?provider=cartesia` | Filter by provider |

---

### WebSocket Commands

Connect to `ws://localhost:4100` and send JSON commands.

#### Agent & Call Commands

| Action | Payload | Description |
|--------|---------|-------------|
| `auth` | `{ token }` | Authenticate (required if `requireAuth` is on) |
| `dial` | `{ agent_id, to, from, greeting? }` | Outbound call |
| `hangup` | `{ call_id }` | End a call |
| `configure` | `{ call_id, ...config }` | Configure call |
| `forward` | `{ call_id, to }` | Forward call to number |
| `dtmf` | `{ call_id, digits }` | Send DTMF tones |
| `hold` | `{ call_id }` | Put call on hold |
| `unhold` | `{ call_id }` | Take call off hold |
| `mute` | `{ call_id }` | Mute mic |
| `unmute` | `{ call_id }` | Unmute mic |
| `say` | `{ call_id, text, message_id? }` | Send a standalone message to caller |
| `reply` | `{ call_id, text, in_reply_to?, message_id? }` | Reply to latest user message |
| `agents` | `{}` | List agents |
| `calls` | `{}` | List active calls |

**Example:**

```json
{ "action": "dtmf", "call_id": "CA_abc123", "digits": "123#" }
```

**Response:**

```json
{ "event": "action.ok", "action": "dtmf", "call_id": "CA_abc123" }
```

---

### WebSocket Events

Events are broadcast to connected clients in real-time.

#### Connection

| Event | Description |
|-------|-------------|
| `server.connected` | SDK connected to Pinecall cloud |
| `server.disconnected` | SDK lost connection |
| `server.reconnecting` | SDK reconnecting |

#### Call Lifecycle

| Event | Key Data | Description |
|-------|----------|-------------|
| `call.started` | `call_id, agent_id, from, to, direction` | Call began |
| `call.ended` | `call_id, agent_id, reason` | Call ended |

#### Speech & Turn

| Event | Key Data | Description |
|-------|----------|-------------|
| `speech.started` | `call_id` | User started speaking |
| `speech.ended` | `call_id` | User stopped speaking |
| `user.speaking` | `call_id, text` | Interim transcript |
| `user.message` | `call_id, message_id, text, confidence` | Final transcript |
| `eager.turn` | `call_id, turn_id, message_id, text` | Early turn (before confirmed) |
| `turn.pause` | `call_id, turn_id` | Turn paused |
| `turn.end` | `call_id, turn_id, message_id, text, confidence` | Confirmed turn end |
| `turn.resumed` | `call_id, turn_id` | User continued speaking |
| `turn.continued` | `call_id, turn_id` | Turn continues after pause |

#### Bot

| Event | Key Data | Description |
|-------|----------|-------------|
| `bot.speaking` | `call_id, message_id` | Bot started speaking |
| `bot.word` | `call_id, message_id, word, index` | Word-level TTS sync |
| `bot.finished` | `call_id, message_id` | Bot finished speaking |
| `bot.interrupted` | `call_id, message_id` | Bot was interrupted |
| `message.confirmed` | `call_id, message_id` | Message delivery confirmed |
| `reply.rejected` | `call_id, message_id, reason` | Reply was rejected |

#### LLM & Tool Calling

| Event | Key Data | Description |
|-------|----------|-------------|
| `llm.stream` | `call_id, msg_id, text` | LLM streaming response chunk |
| `llm.tool_call` | `call_id, tool_name, arguments` | Tool invocation by LLM |
| `llm.tool_result` | `call_id, tool_name, result` | Tool execution result |

Tool call events are streamed to the Dashboard UI and WebSocket clients in real-time.

#### Analysis

| Event | Key Data | Description |
|-------|----------|-------------|
| `audio.metrics` | `call_id, rms, peak, energy_db, is_speech, vad_prob` | Audio analytics |

#### Channel

| Event | Key Data | Description |
|-------|----------|-------------|
| `channel.added` | `agent_id, type, ref` | Channel registered |
| `channel.configured` | `agent_id, ref` | Channel configured |
| `channel.removed` | `agent_id, ref` | Channel removed |

---

### Authentication

When `requireAuth: true`, all REST and WebSocket requests must include a Bearer token:

**REST:**

```bash
curl -H "Authorization: Bearer tok_..." http://localhost:4100/agents
```

**WebSocket:**

```json
{ "action": "auth", "token": "tok_..." }
```

Tokens are generated when agents are attached to the EventServer:

```typescript
const token = server.attach(agent);
// Use this token for authenticated requests
```

Each agent gets its own token. Tokens scope access — a client authenticated with an agent's token can only interact with that agent's calls and events. Without auth, the token can optionally be passed via the `Authorization: Bearer <token>` header on WebSocket upgrade for scoped access.

---

### Dashboard UI

The SDK includes a built-in Dashboard UI served by EventServer at `http://localhost:4100`.

**Features:**
- Real-time connection status indicator
- Agent list with collapsible config display (model, voice, language, STT, instructions)
- Live conversation view with user/bot message bubbles & word-level sync
- Call controls: DTMF keypad, Forward, Hold, Mute, Hangup
- Live tool call invocations and results
- Audio waveform visualization
- Outbound dialer with phone keypad
- Event log with JSON detail view
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
  model: "nova-3",
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

> **Note:** `eager.turn` works best with **Nova** + `smart_turn` — the `is_final` transcript fires `eager.turn`, then smart_turn confirms in ~300ms. With **Flux**, use `turnEvent: "turn.end"` instead — Flux transcripts change continuously and `eager.turn` would trigger the LLM on unstable text.

#### Gladia

```typescript
stt: {
  provider: "gladia",
  model: "accurate",
  language: "en",
  endpointing: 300,
  max_duration_without_endpointing: 5000,
  speech_threshold: 0.8,
  code_switching: false,
  audio_enhancer: true,
}

// Shortcut: "gladia"
```

#### Transcribe (AWS)

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
  engine: "neural",
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
  mode: "smart_turn",
  smart_turn_threshold: 0.5,  // 0-1, lower = faster response
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
  energy_threshold_db: -40,
  min_duration_ms: 200,
}

// Shortcut: false (disables interruption)
```

---

### Analysis

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

### Session Config

Full `config` object passed via `agent.configure()` or `call.configure()`:

```typescript
{
  config: {
    stt: { /* STT config */ },
    tts: { /* TTS config */ },
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

Server configuration file. Auto-detected in the current directory. **This file configures the server only** — it does not define agents (see [Agent Database](#agent-database-beta) for dynamic agents).

```json
{
  "port": 4100,
  "host": "0.0.0.0",
  "ui": true,
  "agentsDir": "./agents"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `4100` | Server port |
| `host` | `string` | `"0.0.0.0"` | Bind address |
| `ui` | `boolean` | `true` | Serve Dashboard UI |
| `agentsDir` | `string` | — | Directory of agent `.js/.ts` files |

CLI flags always override config file values:

```bash
pinecall server --port=8080 --disable-ui   # overrides config
```

---

## Agent Database (Beta)

> ⚠️ **Beta Feature** — CRUD for agents without tools. Tools support coming soon.

When running `pinecall server`, agents can be created dynamically via the REST API. The server persists these agents to a JSON file (`agents.db.json`) in the working directory.

**How it works:**

1. `POST /agents` creates an agent and persists it
2. `DELETE /agents/:name` removes and unpersists it
3. On restart, agents are reloaded from `agents.db.json`

**Example:**

```bash
# Create an agent dynamically (persisted to disk)
curl -X POST http://localhost:4100/agents \
  -d '{"name":"sales","model":"gpt-4.1-nano","phone":"+13186330963","instructions":"You sell."}'

# Delete it
curl -X DELETE http://localhost:4100/agents/sales
```

The agent database file location can be specified in `pinecall.config.json`:

```json
{
  "agentsDir": "./agents",
  "agentsDb": "./agents.db.json"
}
```

**Limitations:**
- Tool definitions are not supported via the REST API (use code-based agents for tools)
- The default driver is a simple JSON file — extend with your own persistence layer

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
| `ready` | `() => void` | Agent ready on server |
| `call.started` | `(call: Call) => void` | New call |
| `call.ended` | `(call: Call, reason: string) => void` | Call ended |
| `speech.started` | `(event, call) => void` | User started speaking |
| `speech.ended` | `(event, call) => void` | User stopped speaking |
| `user.speaking` | `(event, call) => void` | Interim transcript |
| `user.message` | `(event, call) => void` | Final transcript |
| `eager.turn` | `(turn, call) => void` | Early turn detection |
| `turn.pause` | `(event, call) => void` | Turn paused |
| `turn.end` | `(turn, call) => void` | Confirmed turn end |
| `turn.resumed` | `(event, call) => void` | User resumed |
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
| `call.held` | `() => void` | Call on hold |
| `call.unheld` | `() => void` | Call off hold |
| `call.muted` | `() => void` | Mic muted |
| `call.unmuted` | `(transcript: string \| null) => void` | Mic unmuted (+ buffered text) |
| `ended` | `(reason: string) => void` | Call ended |

*(Plus all speech/turn/bot events from Agent, scoped to the call)*

---

## License

MIT — Pinecall, Inc.
