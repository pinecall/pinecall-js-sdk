/**
 * Simplest possible Agent with server-side LLM.
 *
 * The server handles OpenAI calls directly — zero SDK round-trips.
 *
 * Usage: pinecall run examples/agents/Minimal.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Minimal extends GPTAgent {
  // Server-side LLM — the server calls OpenAI directly
  model = "gpt-4.1-nano";

  phone = new Phone({
    number: "+13186330963",
    voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
    greeting: "Hey! I'm a custom agent. Ask me anything!",
  });
  //channels = [
  //  new Phone({
  //      number: "+13186330963",
  //      language: "es",
  //      voice: "elevenlabs:VmejBeYhbrcTPwDniox7",
  //      greeting: "¡Bienvenido a La Piña Dorada! ¿En qué puedo ayudarle?",
  //      stt: "deepgram:nova-3:es",
  //      turnDetection: "smart_turn",
  //  })
  //]

  instructions = "Eres un asistente de voz. Sé conciso. Genera respuestas largas con .!? para evaluar el TTS";
}

export default Minimal;
