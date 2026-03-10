/**
 * Pinecall REST API — fetch voices and phone numbers.
 *
 * These are simple HTTP helpers that talk to the Pinecall management API.
 * They do NOT require a WebSocket connection.
 */

// ─── Types ───────────────────────────────────────────────────────────────

/** A voice available for TTS. */
export interface Voice {
    /** Provider-specific voice ID (use in config `tts.voice_id`). */
    id: string;
    /** Human-readable name. */
    name: string;
    /** TTS provider (e.g. "elevenlabs", "cartesia"). */
    provider: string;
    /** Gender label. */
    gender?: string;
    /** Style label (e.g. "professional", "friendly"). */
    style?: string;
    /** Languages this voice supports. */
    languages: VoiceLanguage[];
    /** Description of the voice characteristics. */
    description?: string;
    /** URL to a preview audio clip. */
    preview_url?: string;
}

export interface VoiceLanguage {
    code: string;
    name: string;
    flag?: string;
    nativeName?: string;
    region?: string;
}

/** A phone number associated with your account. */
export interface Phone {
    /** E.164 format: +12705173618 */
    number: string;
    /** Display name: (270) 517-3618 */
    name: string;
    /** Twilio SID. */
    sid: string;
    /** Whether this phone was registered via SDK. */
    isSdk?: boolean;
}

// ─── Options ─────────────────────────────────────────────────────────────

export interface FetchVoicesOptions {
    /** TTS provider to list voices for. Default: `"elevenlabs"`. */
    provider?: string;
    /** Filter by language code (e.g. `"es"`, `"en"`). */
    language?: string;
    /** API base URL. Default: `"https://app.pinecall.io"`. */
    apiUrl?: string;
}

export interface FetchPhonesOptions {
    /** Your Pinecall API key. */
    apiKey: string;
    /** API base URL. Default: `"https://app.pinecall.io"`. */
    apiUrl?: string;
}

// ─── API ─────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = "https://app.pinecall.io";

/**
 * Fetch available TTS voices from the Pinecall API.
 *
 * @example
 * ```ts
 * const voices = await fetchVoices({ provider: "elevenlabs", language: "es" });
 * voices.forEach(v => console.log(`${v.name} (${v.id})`));
 * ```
 */
export async function fetchVoices(opts: FetchVoicesOptions = {}): Promise<Voice[]> {
    const provider = opts.provider ?? "elevenlabs";
    const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;

    const url = `${apiUrl}/api/sdk/voices?provider=${encodeURIComponent(provider)}`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch voices: HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data.success || !Array.isArray(data.voices)) {
        return [];
    }

    let voices: Voice[] = data.voices.map((v: any) => ({
        id: v.id ?? v.voice_id ?? "",
        name: v.name ?? "Unknown",
        provider,
        gender: v.gender,
        style: v.style,
        languages: Array.isArray(v.languages)
            ? v.languages.map((l: any) =>
                typeof l === "string"
                    ? { code: l, name: l }
                    : { code: l.code ?? "", name: l.name ?? "", flag: l.flag, nativeName: l.nativeName, region: l.region },
            )
            : [],
        description: v.description,
        preview_url: v.preview_url,
    }));

    // Filter by language if requested
    if (opts.language) {
        const lang = opts.language.toLowerCase();
        voices = voices.filter((v) =>
            v.languages.some((l) => l.code.toLowerCase().startsWith(lang)),
        );
    }

    return voices;
}

/**
 * Fetch phone numbers associated with your Pinecall account.
 *
 * @example
 * ```ts
 * const phones = await fetchPhones({ apiKey: "pk_..." });
 * phones.forEach(p => console.log(`${p.name} → ${p.number}`));
 * ```
 */
export async function fetchPhones(opts: FetchPhonesOptions): Promise<Phone[]> {
    const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;

    const url = `${apiUrl}/api/sdk/phone-numbers`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch phone numbers: HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data.success) {
        return [];
    }

    const raw: any[] = data.phones ?? data.phoneNumbers ?? [];

    return raw.map((p: any) => ({
        number: p.number ?? "",
        name: p.name ?? p.number ?? "",
        sid: p.sid ?? "",
        isSdk: p.isSdk ?? false,
    }));
}
