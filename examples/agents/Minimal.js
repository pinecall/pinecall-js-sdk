/**
 * Simplest possible GPTAgent — one phone, one prompt.
 *
 * Usage: pinecall run examples/agents/Minimal.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Minimal extends GPTAgent {
    model = "gpt-4.1-nano";
    phone = new Phone({ number: "+13186330963" });
    instructions = "You are a helpful voice assistant. Be concise.";
}

export default Minimal;
