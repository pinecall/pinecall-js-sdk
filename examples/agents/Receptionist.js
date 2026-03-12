/**
 * Receptionist agent with tool calling and in-memory JSON "database".
 *
 * Usage: pinecall run examples/agents/Receptionist.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

// ── Fictional restaurant database ────────────────────────────────────────

const db = {
    reservations: [
        { id: "RES-001", name: "García", date: "2026-03-13", time: "20:00", guests: 4, status: "confirmed" },
        { id: "RES-002", name: "Müller", date: "2026-03-13", time: "21:00", guests: 2, status: "confirmed" },
        { id: "RES-003", name: "Smith", date: "2026-03-14", time: "19:30", guests: 6, status: "confirmed" },
    ],
    menu: {
        starters: ["Ceviche de corvina", "Empanadas de carne", "Guacamole con chips"],
        mains: ["Lomo saltado", "Paella de mariscos", "Pollo a la brasa", "Risotto de hongos"],
        desserts: ["Tres leches", "Churros con chocolate", "Flan de caramelo"],
        drinks: ["Pisco sour", "Sangría", "Agua de jamaica", "Limonada de maracuyá"],
    },
    hours: { weekdays: "12:00 - 23:00", weekends: "11:00 - 00:00" },
    address: "Calle Gran Vía 42, Madrid",
    maxCapacity: 60,
    tablesAvailable: (date, time) => {
        const booked = db.reservations.filter(r => r.date === date && r.time === time);
        const bookedGuests = booked.reduce((sum, r) => sum + r.guests, 0);
        return db.maxCapacity - bookedGuests;
    },
};

// ── Agent ────────────────────────────────────────────────────────────────

class Receptionist extends GPTAgent {
    model = "gpt-4.1-nano";

    phone = new Phone({
        number: "+13186330963",
        language: "es",
        voice: "elevenlabs:VmejBeYhbrcTPwDniox7",
        greeting: "¡Bienvenido a La Piña Dorada! ¿En qué puedo ayudarle?",
        stt: "deepgram:nova-3:es",
        turnDetection: "smart_turn",
    });

    instructions = `You are the receptionist at "La Piña Dorada", a Latin American restaurant in Madrid.

Your responsibilities:
- Book reservations using bookReservation (always ask for name, date, time, and number of guests)
- Check table availability using checkAvailability before booking
- Answer questions about the menu using getMenu
- Provide restaurant info (hours, address) using getRestaurantInfo

Rules:
- Always check availability BEFORE booking a table
- Be warm and concise — 1-2 sentences max
- Say something brief BEFORE calling a tool ("Déjame verificar…", "Un momento…")
- If no availability, suggest the nearest available time
- Speak in Spanish`;

    // ── Tools ────────────────────────────────────────────────────────

    async checkAvailability({ date, time }, call) {
        this.log(call, `🔍 Checking availability: ${date} ${time}`);
        const seats = db.tablesAvailable(date, time);
        const available = seats > 0;
        this.log(call, `   ${available ? "✓" : "✗"} ${seats} seats available`);
        return { date, time, available, seatsLeft: seats };
    }

    async bookReservation({ date, time, guests, name }, call) {
        const seats = db.tablesAvailable(date, time);
        if (seats < guests) {
            this.log(call, `❌ Not enough seats: ${seats} < ${guests}`);
            return { confirmed: false, reason: `Only ${seats} seats available at ${time}` };
        }

        const reservation = {
            id: `RES-${String(db.reservations.length + 1).padStart(3, "0")}`,
            name, date, time, guests: Number(guests),
            status: "confirmed",
        };
        db.reservations.push(reservation);
        this.log(call, `📅 Booked: ${reservation.id} — ${guests} guests for ${name}`);
        return { confirmed: true, ...reservation };
    }

    async getMenu(_args, call) {
        this.log(call, `📋 Menu requested`);
        return db.menu;
    }

    async getRestaurantInfo(_args, call) {
        this.log(call, `ℹ️  Info requested`);
        return { hours: db.hours, address: db.address };
    }
}

// ── Tool definitions ─────────────────────────────────────────────────────

Receptionist.defineTool("checkAvailability", "Check table availability for a date and time", {
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
    time: { type: "string", description: "Time (HH:MM)" },
});

Receptionist.defineTool("bookReservation", "Book a table at the restaurant", {
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
    time: { type: "string", description: "Time (HH:MM)" },
    guests: { type: "number", description: "Number of guests" },
    name: { type: "string", description: "Name for the reservation" },
});

Receptionist.defineTool("getMenu", "Get the restaurant menu", {});

Receptionist.defineTool("getRestaurantInfo", "Get restaurant hours and address", {});

export default Receptionist;
