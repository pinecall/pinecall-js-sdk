/**
 * DecoratorExample — Agent with @tool decorators.
 *
 * Shows how to use the @tool decorator instead of defineTool().
 * Run: pinecall run examples/agents/DecoratorExample.ts
 */

import { GPTAgent, Phone, WebRTC, tool } from "@pinecall/sdk/ai";

class DecoratorExample extends GPTAgent {
    model = "gpt-4.1-nano";
    channels = [
        new WebRTC(),
    ];
    prompt = "You are a helpful assistant for a restaurant. Help guests check availability and book tables.";
    greeting = "Hello! Welcome to La Bella. Would you like to check availability or make a reservation?";

    @tool("Check table availability for a given date and party size", {
        date: { type: "string", description: "Date (YYYY-MM-DD)" },
        guests: { type: "number", description: "Number of guests" },
    })
    async checkAvailability({ date, guests }: { date: string; guests: number }) {
        // Simulated availability check
        const available = Math.random() > 0.3;
        return {
            available,
            date,
            guests,
            ...(available
                ? { times: ["18:00", "19:30", "21:00"] }
                : { suggestion: "Try the next day" }),
        };
    }

    @tool("Book a table at the restaurant", {
        date: { type: "string", description: "Reservation date (YYYY-MM-DD)" },
        time: { type: "string", description: "Reservation time (HH:MM)" },
        guests: { type: "number", description: "Number of guests" },
        name: { type: "string", description: "Name for the reservation" },
    })
    async bookTable({ date, time, guests, name }: { date: string; time: string; guests: number; name: string }) {
        return {
            confirmed: true,
            date,
            time,
            guests,
            name,
            table: `A${Math.floor(Math.random() * 20) + 1}`,
            confirmationId: `RES-${Date.now().toString(36).toUpperCase()}`,
        };
    }

    @tool("Get the restaurant menu", {})
    async getMenu() {
        return {
            appetizers: ["Bruschetta", "Caprese Salad", "Garlic Bread"],
            mains: ["Margherita Pizza", "Pasta Carbonara", "Grilled Salmon"],
            desserts: ["Tiramisu", "Panna Cotta", "Gelato"],
        };
    }
}

export default DecoratorExample;
