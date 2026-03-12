/**
 * @pinecall/sdk/ai — Declarative voice agents.
 *
 * Agent: base class with channels, history, onTurn() hook.
 * GPTAgent: extends Agent with OpenAI streaming + tool calling.
 *
 * @example
 * ```typescript
 * import { GPTAgent, Phone } from "@pinecall/sdk/ai";
 *
 * class MyPhone extends Phone {
 *   number = "+13186330963";
 *   voice = "elevenlabs:abc";
 *   greeting = "Hello!";
 *   stt = { provider: "deepgram-flux" };
 *   turnDetection = "native";
 * }
 *
 * class MyAgent extends GPTAgent {
 *   model = "gpt-4.1-nano";
 *   phone = new MyPhone();
 *   instructions = "You are helpful.";
 * }
 *
 * export default MyAgent;
 * ```
 */

// Base agent (no OpenAI dependency)
export { Agent } from "./agent.js";
export type { AgentOptions } from "./agent.js";

// GPTAgent (extends Agent, requires openai)
export { GPTAgent } from "./gpt-agent.js";
export type { ToolDef, GPTAgentOptions } from "./gpt-agent.js";

// Channel classes
export { Channel, Phone, WebRTC } from "./channel.js";

