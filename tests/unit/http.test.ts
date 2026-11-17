import { afterEach, describe, expect, it, vi } from "vitest";
import { readBody, errorResponse, AppError } from "../../src/lib/server/http";
import { groq } from "../../src/lib/server/groq";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("server boundaries", () => {
  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])(
    "accepts the browser host %s when Next uses its bind address",
    async (host) => {
      const body = await readBody(
        new Request("http://0.0.0.0:3000/api/lesson", {
          method: "POST",
          headers: { host, origin: `http://${host}` },
          body: '{"topic":"a"}',
        }),
      );
      expect(body).toEqual({ topic: "a" });
    },
  );
  it("accepts the public HTTPS scheme supplied by the deployment proxy", async () => {
    expect(
      await readBody(
        new Request("http://internal:3000/api/lesson", {
          method: "POST",
          headers: {
            host: "chalk.example",
            origin: "https://chalk.example",
            "x-forwarded-proto": "https",
          },
          body: "{}",
        }),
      ),
    ).toEqual({});
  });
  it.each([
    "https://foreign.example",
    "null",
    "not-a-url",
    "http://localhost:3001",
    "http://localhost:3000/path",
  ])("still rejects unrelated or malformed origin %s", async (origin) => {
    await expect(
      readBody(
        new Request("http://0.0.0.0:3000/api/lesson", {
          method: "POST",
          headers: { host: "localhost:3000", origin, "x-forwarded-host": "foreign.example" },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects foreign origins and oversized requests", async () => {
    await expect(
      readBody(
        new Request("http://localhost/api/lesson", {
          method: "POST",
          headers: { origin: "https://foreign.example" },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readBody(
        new Request("http://localhost/api/lesson", { method: "POST", body: "a".repeat(100) }),
        20,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("does not reveal unexpected errors", async () => {
    const response = errorResponse(new Error("secret=value"));
    expect(await response.text()).not.toContain("secret");
  });
  it("maps quota failures and forwards cooldown without exposing provider errors", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-not-a-real-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("provider details", { status: 429, headers: { "retry-after": "30" } }),
        ),
    );
    await expect(groq("audio/speech", {}, new AbortController().signal)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfter: 30,
    });
    const response = errorResponse(new AppError("RATE_LIMITED", "Quota", 429, 30));
    expect(response.headers.get("Retry-After")).toBe("30");
  });
  it("fails honestly when no API key is configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(groq("audio/speech", {}, new AbortController().signal)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });
  it("explains the account setup requirement when voice model terms are pending", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-not-a-real-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "model_terms_required", message: "private provider details" } },
            { status: 400 },
          ),
        ),
    );
    await expect(groq("audio/speech", {}, new AbortController().signal)).rejects.toMatchObject({
      code: "MODEL_TERMS_REQUIRED",
      status: 503,
    });
  });
});
