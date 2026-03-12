/**
 * Receptionist agent with tool calling.
 *
 * Usage: pinecall run examples/receptionist.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class Receptionist extends GPTAgent {
    model = "gpt-4.1-nano";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    phone = new Phone("+13186330963");
    turnDetection = "smart_turn";
    instructions = `You are a friendly restaurant receptionist for "La Piña Dorada".
You help customers book tables, answer questions about the menu, and provide directions.
Be concise — 1-2 sentences max. Be warm and professional.`;
    greeting = "Welcome to La Piña Dorada! How can I help you today?";

    async bookReservation({ date, time, guests, name }) {
        console.log(`  📅 Booking: ${guests} guests for ${name} on ${date} at ${time}`);
        return { confirmed: true, reservation_id: `RES-${Date.now()}`, date, time, guests, name };
    }

    async checkAvailability({ date, time }) {
        const available = Math.random() > 0.3;
        return { date, time, available, alternative: available ? null : "8:00 PM" };
    }
}

Receptionist.defineTool("bookReservation", "Book a table at the restaurant", {
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
    time: { type: "string", description: "Time (HH:MM)" },
    guests: { type: "number", description: "Number of guests" },
    name: { type: "string", description: "Name for the reservation" },
});

Receptionist.defineTool("checkAvailability", "Check table availability", {
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
    time: { type: "string", description: "Time (HH:MM)" },
});

export default Receptionist;
