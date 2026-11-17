import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completion, clearProviderCooldowns } from "../../src/lib/server/text";
import { AppError } from "../../src/lib/server/http";

const messages = [{ role: "user", content: "Explain binary search." }];
const reply = (text = "A complete explanation.") =>
  Response.json({ choices: [{ finish_reason: "stop", message: { content: text } }] });
beforeEach(() => {
  clearProviderCooldowns();
  vi.stubEnv("GROQ_API_KEY", "groq-test-key");
  vi.stubEnv("OPENROUTER_API_KEY", "router-test-key");
  vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
});
afterEach(() => {
  clearProviderCooldowns();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("free text-provider failover", () => {
  it("tries the backup when a complete response fails lesson validation", async () => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(reply("invalid lesson"))
      .mockResolvedValueOnce(reply("valid lesson"));
    vi.stubGlobal("fetch", provider);
    const validate = (output: string) => {
      if (output !== "valid lesson") throw new AppError("INVALID_OUTPUT", "Invalid lesson", 502);
    };
    expect(await completion(messages, new AbortController().signal, {}, validate)).toBe(
      "valid lesson",
    );
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("uses Groq first and does not call the backup on success", async () => {
    const provider = vi.fn().mockResolvedValue(reply());
    vi.stubGlobal("fetch", provider);
    expect(await completion(messages, new AbortController().signal)).toBe(
      "A complete explanation.",
    );
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0][0]).toContain("api.groq.com");
  });
  it("falls back after a quota error and skips Groq during its cooldown", async () => {
    const provider = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("api.groq.com")
            ? new Response("", { status: 429, headers: { "Retry-After": "30" } })
            : reply("The backup worked."),
        ),
      );
    vi.stubGlobal("fetch", provider);
    expect(await completion(messages, new AbortController().signal)).toBe("The backup worked.");
    expect(await completion(messages, new AbortController().signal)).toBe("The backup worked.");
    expect(provider.mock.calls.filter(([url]) => url.includes("api.groq.com"))).toHaveLength(1);
    expect(provider.mock.calls.filter(([url]) => url.includes("openrouter.ai"))).toHaveLength(2);
  });
  it("supports OpenRouter alone and sends only a free model with the structured schema", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_MODEL", "");
    const provider = vi.fn().mockResolvedValue(reply("{}"));
    vi.stubGlobal("fetch", provider);
    const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
    await completion(messages, new AbortController().signal, schema);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.model).toBe("particle-ai/particle-1:free");
    expect(body.response_format.json_schema.schema).toEqual(schema);
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.reasoning).toEqual({ enabled: false });
    expect(provider.mock.calls[0][1].headers.Authorization).toBe("Bearer router-test-key");
  });
  it("never selects paid OpenRouter models", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_MODEL", "some/paid-model");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(completion(messages, new AbortController().signal)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it("returns the earliest cooldown when all free providers are limited", async () => {
    const provider = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response("", {
          status: 429,
          headers: { "Retry-After": url.includes("groq") ? "30" : "9" },
        }),
      ),
    );
    vi.stubGlobal("fetch", provider);
    await expect(completion(messages, new AbortController().signal)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfter: 9,
      status: 429,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    await expect(completion(messages, new AbortController().signal)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("retries a provider after its cooldown expires", async () => {
    vi.useFakeTimers();
    const provider = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "9" } }))
      .mockImplementation(() => Promise.resolve(reply()));
    vi.stubGlobal("fetch", provider);
    await completion(messages, new AbortController().signal);
    vi.advanceTimersByTime(10_000);
    await completion(messages, new AbortController().signal);
    expect(provider.mock.calls.at(-1)![0]).toContain("groq");
  });
  it("falls back on network errors and invalid provider output", async () => {
    const provider = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection failed"))
      .mockResolvedValueOnce(reply());
    vi.stubGlobal("fetch", provider);
    expect(await completion(messages, new AbortController().signal)).toBe(
      "A complete explanation.",
    );
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("does not bypass a model refusal by asking another provider", async () => {
    const provider = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ finish_reason: "content_filter", message: {} }] }),
      );
    vi.stubGlobal("fetch", provider);
    await expect(completion(messages, new AbortController().signal)).rejects.toMatchObject({
      code: "REFUSED",
    });
    expect(provider).toHaveBeenCalledOnce();
  });
  it("does not start fallback work after the caller cancels", async () => {
    const abort = new AbortController();
    abort.abort();
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(completion(messages, abort.signal)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(provider).not.toHaveBeenCalled();
  });
});
