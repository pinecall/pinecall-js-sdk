/**
 * Stripe-style message ID generator.
 *
 *   generateId()       → "msg_a1b2c3d4e5f6"
 *   generateId("greet") → "greet_a1b2c3d4e5f6"
 */

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(len = 12): string {
    let result = "";
    for (let i = 0; i < len; i++) {
        result += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return result;
}

export function generateId(prefix = "msg"): string {
    return `${prefix}_${randomSuffix()}`;
}
