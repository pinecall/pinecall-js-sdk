/**
 * Theme — colors, symbols, and ANSI escape helpers.
 * Single source of truth for all terminal styling.
 */

import chalk from "chalk";

// ── Brand colors ─────────────────────────────────────────────────────────

export const BRAND = chalk.hex("#7C3AED");     // pinecall purple
export const ACCENT = chalk.hex("#06B6D4");     // cyan accent
export const OK = chalk.hex("#22C55E");     // green / success
export const WARN = chalk.hex("#F59E0B");     // amber / warning
export const ERR = chalk.hex("#EF4444");     // red / error
export const MUTED = chalk.hex("#6B7280");     // grey / secondary
export const DIM = chalk.dim;

// ── Symbols ──────────────────────────────────────────────────────────────

export const BAR = MUTED("│");
export const CHECK = OK("✓");
export const CROSS = ERR("✗");
export const BULLET = MUTED("•");
export const ARROW = MUTED("→");
export const PHONE = "📞";
export const MIC = "🎙️";
export const SPEAKER = "🔊";
export const SPARKLE = "✨";

// ── ANSI escape sequences ────────────────────────────────────────────────

export const CLEAR_LINE = "\x1B[2K\r";
export const SHOW_CURSOR = "\x1B[?25h";
export const HIDE_CURSOR = "\x1B[?25l";
