/**
 * Simplest possible GPTAgent — one phone, one prompt.
 *
 * Usage: pinecall run examples/agents/Minimal.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Minimal extends GPTAgent {
  model = "gpt-4.1-nano";

  phone = new Phone({ 
    number: "+13186330963", 
    greeting: 'Hello!' 
  });

  instructions = "You are a helpful voice assistant. Be concise. Generate long responses with .!? so we can evaluate de TTS";
}

export default Minimal;
