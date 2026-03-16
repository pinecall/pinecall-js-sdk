/**
 * Simplest possible Agent with server-side LLM.
 *
 * The server handles OpenAI calls directly — zero SDK round-trips.
 *
 * Usage: pinecall run examples/agents/Minimal.js
 */

import { GPTAgent, Phone, WebRTC } from "@pinecall/sdk/ai";

class Minimal extends GPTAgent {
  // Server-side LLM — the server calls OpenAI directly
  model = "gpt-4.1-nano";

  voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
  greeting = "Hey! I'm a custom agent. Ask me anything!";

  channels = [
    new WebRTC(),
    //new Phone({
    //  number: "+12345",
    //}),
    new Phone({
      number: "+13186330963",
      language: "es",
      voice: "elevenlabs:VmejBeYhbrcTPwDniox7",
      greeting: "¡Bienvenido a La Piña Dorada! ¿En qué puedo ayudarle?",
      stt: "deepgram:nova-3:es",
      turnDetection: "smart_turn"
    })
  ];

  prompt = "You are a helpful voice assistant. Respond naturally in 2-3 sentences. Be warm and professional.";
}

export default Minimal;
