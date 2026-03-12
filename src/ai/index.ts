/**
 * @pinecall/sdk/ai — High-level GPTAgent for building voice agents with OpenAI.
 *
 * @example
 * ```typescript
 * import { GPTAgent, Phone } from "@pinecall/sdk/ai";
 *
 * class USPhone extends Phone {
 *   number = "+13186330963";
 *   stt = { provider: "deepgram-flux", language: "en" };
 *   turnDetection = "native";
 * }
 *
 * class MyAgent extends GPTAgent {
 *   model = "gpt-4.1-nano";
 *   voice = "elevenlabs:abc";
 *   phone = new USPhone();
 *   instructions = "You are helpful.";
 *   greeting = "Hello!";
 * }
 *
 * export default MyAgent;
 * ```
 */

export { GPTAgent } from "./gpt-agent.js";
export type { ToolDef, GPTAgentOptions } from "./gpt-agent.js";

export { Channel, Phone, WebRTC } from "./channel.js";
