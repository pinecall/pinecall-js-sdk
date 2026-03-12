import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveEnv, requireOpenAI } from "../cli/lib/env";
import { CliError } from "../cli/lib/errors";

describe("resolveEnv", () => {
    afterEach(() => {
        delete process.env.PINECALL_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.PINECALL_URL;
    });

    it("throws CliError when PINECALL_API_KEY is missing", () => {
        delete process.env.PINECALL_API_KEY;
        expect(() => resolveEnv()).toThrow(CliError);
    });

    it("resolves env vars correctly", () => {
        process.env.PINECALL_API_KEY = "pk_test123";
        process.env.OPENAI_API_KEY = "sk_test456";

        const env = resolveEnv();
        expect(env.apiKey).toBe("pk_test123");
        expect(env.openaiKey).toBe("sk_test456");
        expect(env.url).toContain("pinecall.io");
    });

    it("uses custom PINECALL_URL", () => {
        process.env.PINECALL_API_KEY = "pk_test";
        process.env.PINECALL_URL = "wss://custom.example.com";

        const env = resolveEnv();
        expect(env.url).toBe("wss://custom.example.com");
    });
});

describe("requireOpenAI", () => {
    it("throws CliError when openaiKey is missing", () => {
        const env = { apiKey: "pk_test", url: "wss://test" };
        expect(() => requireOpenAI(env)).toThrow(CliError);
    });

    it("does not throw when openaiKey is present", () => {
        const env = { apiKey: "pk_test", openaiKey: "sk_test", url: "wss://test" };
        expect(() => requireOpenAI(env)).not.toThrow();
    });
});
