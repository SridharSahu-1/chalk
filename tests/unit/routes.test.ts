import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as generate } from "../../src/app/api/lesson/route";
import { POST as speech } from "../../src/app/api/speech/route";
import { POST as answer } from "../../src/app/api/follow-up/route";
import { sampleLesson } from "../../src/lib/sample";
import { lessonSchema } from "../../src/lib/lesson";
import { clearLessonCache } from "../../src/lib/server/lesson-cache";
import { clearProviderCooldowns } from "../../src/lib/server/text";

const request = (path: string, data: unknown) =>
  new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
const completion = (content: unknown, finish = "stop") =>
  Response.json({
    choices: [
      {
        finish_reason: finish,
        message: { content: typeof content === "string" ? content : JSON.stringify(content) },
      },
    ],
  });

beforeEach(() => {
  clearLessonCache();
  clearProviderCooldowns();
  vi.stubEnv("GROQ_API_KEY", "test-key-not-real");
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("API contracts with an isolated provider", () => {
  it("validates structured provider output and stamps a live lesson envelope", async () => {
    const provider = vi.fn().mockResolvedValue(completion(sampleLesson.content));
    vi.stubGlobal("fetch", provider);
    const response = await generate(request("lesson", { topic: "Photosynthesis" }));
    expect(response.status).toBe(200);
    const lesson = lessonSchema.parse(await response.json());
    expect(lesson.source).toBe("ai");
    expect(lesson.id).not.toBe(sampleLesson.id);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.required).toContain("steps");
  });
  it("repairs invalid lesson output once and never retries a quota failure", async () => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(completion({}))
      .mockResolvedValueOnce(completion(sampleLesson.content));
    vi.stubGlobal("fetch", provider);
    expect((await generate(request("lesson", { topic: "Photosynthesis" }))).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    const limited = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    clearLessonCache();
    vi.stubGlobal("fetch", limited);
    expect((await generate(request("lesson", { topic: "Photosynthesis" }))).status).toBe(429);
    expect(limited).toHaveBeenCalledOnce();
  });
  it("rejects incomplete provider output instead of presenting a partial lesson", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(completion(sampleLesson.content, "length"))),
    );
    const response = await generate(request("lesson", { topic: "Photosynthesis" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INVALID_OUTPUT");
  });
  it("repairs caption-length narration with specific feedback rather than accepting a short lesson", async () => {
    const short = structuredClone(sampleLesson.content);
    short.steps.forEach((step) => {
      step.narration = "Plants use light to make food.";
    });
    const provider = vi
      .fn()
      .mockResolvedValueOnce(completion(short))
      .mockResolvedValueOnce(completion(sampleLesson.content));
    vi.stubGlobal("fetch", provider);
    expect((await generate(request("lesson", { topic: "Photosynthesis" }))).status).toBe(200);
    const repair = JSON.parse(provider.mock.calls[1][1].body);
    expect(repair.messages[0].content).toContain("Narration must contain 200–320 words");
    expect(repair.messages[0].content).toContain("21–23 spoken words");
  });
  it("retries a provider JSON validation failure and keeps hard bounds in local validation", async () => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "json_validate_failed" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(completion(sampleLesson.content));
    vi.stubGlobal("fetch", provider);
    const response = await generate(request("lesson", { topic: "technology" }));
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    const schema = JSON.parse(provider.mock.calls[0][1].body).response_format.json_schema.schema;
    const narration = schema.properties.steps.items.properties.narration;
    expect(narration).not.toHaveProperty("minLength");
    expect(narration).not.toHaveProperty("maxLength");
    expect(narration.description).toContain("maxLength: 180");
    const oversized = structuredClone(sampleLesson);
    oversized.content.steps[0].narration = "x".repeat(181);
    expect(lessonSchema.safeParse(oversized).success).toBe(false);
  });
  it("returns WAV bytes and rejects a fake or corrupted audio payload", async () => {
    const wav = new Uint8Array(100);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(wav)));
    const response = await speech(request("speech", { text: "A leaf captures sunlight." }));
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect((await response.arrayBuffer()).byteLength).toBe(100);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not audio")));
    expect((await speech(request("speech", { text: "A leaf captures sunlight." }))).status).toBe(
      502,
    );
  });
  it("uses current-step context for follow-ups and returns plain answers", async () => {
    const provider = vi
      .fn()
      .mockResolvedValue(completion("Sunlight supplies energy, while water provides material."));
    vi.stubGlobal("fetch", provider);
    const response = await answer(
      request("follow-up", {
        topic: sampleLesson.topic,
        narration: sampleLesson.content.steps.map((step) => step.narration),
        currentStep: 3,
        labels: ["Water"],
        history: [],
        question: "What does water do?",
      }),
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('"currentStep":3');
    expect(body.messages.at(-1).content).toBe("What does water do?");
    expect(await response.json()).toEqual({
      answer: "Sunlight supplies energy, while water provides material.",
    });
  });
});
