/**
 * Multi-phone agent with per-channel config.
 *
 * Two phones (EN + ES), each with its own voice, greeting, STT,
 * and turn detection. Shows the full power of Channel classes.
 *
 * Usage: pinecall run examples/agents/multilingual.js
 */

import { GPTAgent, Phone, WebRTC } from "@pinecall/sdk/ai";


class EnglishPhone extends Phone {
  number = "+13186330963";
  greeting = "Hey! How can I help you?";
  voice = {
    provider: "elevenlabs",
    voice_id: "EXAVITQu4vr4xnSDxMaL",  // Sarah
    model: "eleven_flash_v2_5",
    speed: 1.0,
    stability: 0.5,
  };
  stt = {
    provider: "deepgram-flux",
    language: "en",
    eot_threshold: 0.7,
    eager_eot_threshold: 0.5,
  };
  turnDetection = "native";
  interruption = { enabled: true, min_duration_ms: 300 };
}

class SpanishPhone extends Phone {
  number = "+34607123456";
  language = "es";
  greeting = "¡Hola! ¿En qué te puedo ayudar?";
  voice = {
    provider: "elevenlabs",
    voice_id: "VmejBeYhbrcTPwDniox7",   // Lina
    model: "eleven_flash_v2_5",
    speed: 1.05,
    stability: 0.55,
    similarity_boost: 0.8,
    language: "es",
  };
  stt = {
    provider: "deepgram",
    model: "nova-3",
    language: "es",
    keywords: ["Pinecall", "GPTAgent"],
  };
  turnDetection = "smart_turn";
  interruption = {
    enabled: true,
    energy_threshold_db: -35.0,
    min_duration_ms: 300,
  };
}

class MultilingualAgent extends GPTAgent {
  model = "gpt-4.1-nano";
  channels = [
    new EnglishPhone(), 
    new SpanishPhone(), 
    new WebRTC() 
  ];
  prompt = "You are a friendly, conversational voice assistant. Respond naturally in 2-3 sentences. Be warm and professional.";
}

export default MultilingualAgent;
