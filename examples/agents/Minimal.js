/**
 * Simplest possible GPTAgent — one phone, one prompt.
 *
 * Usage: pinecall run examples/agents/Minimal.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Minimal extends GPTAgent {
  model = "gpt-4.1-nano";

  channels = [
    //new Phone({ 
    //  number: "+13186330963", 
    //  greeting: 'Hello!' 
    //}),

    new Phone({
        number: "+13186330963",
       language: "es",
        voice: "elevenlabs:VmejBeYhbrcTPwDniox7",
        greeting: "¡Bienvenido a La Piña Dorada! ¿En qué puedo ayudarle?",
        stt: "deepgram:nova-3:es",
        turnDetection: "smart_turn",
    })
  ];

  instructions = "You are a helpful voice assistant. Be concise. Generate long responses with .!? so we can evaluate de TTS";
}

export default Minimal;
