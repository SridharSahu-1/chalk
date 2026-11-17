import { test, expect, type Page } from "@playwright/test";
import { sampleLesson } from "../../src/lib/sample";

const liveLesson = { ...sampleLesson, id: "test-live-lesson", source: "ai" };

test("shows a cooldown before retrying when all free providers are limited", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/lesson", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 429,
          json: {
            error: {
              code: "RATE_LIMITED",
              message: "All free providers are cooling down.",
              retryAfter: 2,
            },
          },
        })
      : route.fulfill({ json: liveLesson });
  });
  await page.goto("/");
  await page.getByLabel("LET’S START WITH A QUESTION").fill("technology");
  await page.getByRole("button", { name: /Let’s learn something/ }).click();
  await expect(page.getByRole("button", { name: /Try again in/ })).toBeDisabled();
  await expect(page.getByLabel("LET’S START WITH A QUESTION")).toHaveValue("technology");
  await expect(page.getByRole("button", { name: /Let’s learn something/ })).toBeEnabled({
    timeout: 5000,
  });
  await page.getByRole("button", { name: /Let’s learn something/ }).click();
  await expect(page.getByText("YOUR AI LESSON IS READY")).toBeVisible();
  expect(attempts).toBe(2);
});

test("real API boundaries reject invalid requests before contacting a provider", async ({
  request,
}) => {
  const headers = { Origin: "http://127.0.0.1:3000" };
  const lesson = await request.post("/api/lesson", { headers, data: { topic: "a" } });
  expect(lesson.status()).toBe(400);
  const speech = await request.post("/api/speech", { headers, data: { text: "x".repeat(181) } });
  expect(speech.status()).toBe(400);
  const question = await request.post("/api/follow-up", { headers, data: { question: "why" } });
  expect(question.status()).toBe(400);
  const foreign = await request.post("/api/lesson", {
    headers: { Origin: "https://foreign.example" },
    data: { topic: "a" },
  });
  expect(foreign.status()).toBe(403);
});

async function mockSpeech(page: Page) {
  await page.addInitScript(`
    window.Audio = class {
      constructor(url) { this.src = url; window.__audio = this; }
      play() { setTimeout(() => this.onplaying?.(), 0); return Promise.resolve(); }
      pause() {} load() {} removeAttribute() {}
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const synth = {
      speaking: false, paused: false,
      getVoices: () => [], addEventListener() {}, removeEventListener() {},
      speak(utterance) { window.__utterance = utterance; this.speaking = true; setTimeout(() => utterance.onstart?.(), 0); },
      pause() { this.paused = true; }, resume() { this.paused = false; },
      cancel() { this.speaking = false; this.paused = false; }
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  `);
}

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Explore a sample lesson/ }).click();
  await expect(page.getByText("PREWRITTEN SAMPLE LESSON")).toBeVisible();
}

test("generates a fresh lesson and asks a contextual follow-up", async ({ page }) => {
  await mockSpeech(page);
  await page.route("**/api/lesson", (route) => route.fulfill({ json: liveLesson }));
  await page.route("**/api/follow-up", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.topic).toBe(sampleLesson.topic);
    expect(body.narration.length).toBe(12);
    expect(body.question).toBe("Why do plants need sunlight?");
    expect(body).not.toHaveProperty("scenes");
    await route.fulfill({ json: { answer: "Light supplies the energy used to make sugar." } });
  });
  await page.goto("/");
  await page.getByLabel("LET’S START WITH A QUESTION").fill("How photosynthesis works");
  await page.getByRole("button", { name: /Let’s learn something/ }).click();
  await expect(page.getByText("YOUR AI LESSON IS READY")).toBeVisible();
  await page.getByLabel("Ask a follow-up question").fill("Why do plants need sunlight?");
  await page.getByRole("button", { name: "Send follow-up question" }).click();
  await expect(page.getByText("Light supplies the energy used to make sugar.")).toBeVisible();
});

test("defaults to AI audio, supports pause, and toggles without losing the step", async ({
  page,
}) => {
  await mockSpeech(page);
  const wav = Buffer.alloc(100);
  wav.write("RIFF", 0);
  wav.write("WAVE", 8);
  await page.route("**/api/speech", (route) =>
    route.fulfill({ body: wav, contentType: "audio/wav" }),
  );
  await openSample(page);
  await expect(page.getByRole("button", { name: "AI voice", exact: false })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Play lesson" }).click();
  await expect(page.locator(".playback-status")).toHaveText("Playing");
  await page.getByRole("button", { name: "Pause lesson" }).click();
  await expect(page.getByRole("button", { name: "Play lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await expect(page.locator(".step-count")).toContainText("1 / 12 steps");
  await expect(page.getByRole("button", { name: "Play lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Play lesson" }).click();
  await expect(page.locator(".source-label")).toHaveText("Browser voice");
});

test("automatically falls back on quota, seeks, restarts, completes, and checks understanding", async ({
  page,
}) => {
  await mockSpeech(page);
  await page.route("**/api/speech", (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: "RATE_LIMITED", message: "Free quota exhausted", retryAfter: 60 } },
    }),
  );
  await openSample(page);
  await page.getByRole("button", { name: "Play lesson" }).click();
  await expect(page.locator(".source-label")).toHaveText("Browser voice");
  await expect(page.getByRole("status")).toContainText("free limit");
  await page.getByRole("button", { name: "Pause lesson" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator(".step-count")).toContainText("2 / 12 steps");
  await page.getByRole("button", { name: "Restart lesson" }).click();
  await expect(page.locator(".step-count")).toContainText("1 / 12 steps");
  await page.getByRole("slider", { name: "Lesson step" }).fill("11");
  await expect(
    page.getByRole("heading", { name: "Put the whole picture together", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play lesson" }).click();
  await expect(page.locator(".playback-status")).toHaveText("Playing");
  await page.evaluate("window.__utterance.onend()");
  await expect(page.getByText("LET’S MAKE IT STICK")).toBeVisible();
  await page.getByRole("button", { name: "A Sunlight" }).click();
  await expect(page.getByText("You’ve got it.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Replay lesson" }).click();
  await expect(page.locator(".step-count")).toContainText("1 / 12 steps");
});

test("keeps failed inputs, restores lessons paused, and shows no horizontal mobile overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSpeech(page);
  await page.route("**/api/lesson", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "NOT_CONFIGURED", message: "Live AI is not configured yet." } },
    }),
  );
  await page.goto("/");
  const topic = page.getByLabel("LET’S START WITH A QUESTION");
  await topic.fill("Quantum mechanics");
  await page.getByRole("button", { name: /Let’s learn something/ }).click();
  await expect(page.locator(".error-message[role=alert]")).toContainText("not configured");
  await expect(topic).toHaveValue("Quantum mechanics");
  await page.getByRole("button", { name: /Explore a sample lesson/ }).click();
  await page.reload();
  await expect(page.getByText("Restored from this tab.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play lesson" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect
    .poll(() => page.locator(".diagram-viewport").evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(100);
  const board = await page.locator(".board-panel").boundingBox();
  const chat = await page.locator(".chat-panel").boundingBox();
  expect(board!.y).toBeLessThan(chat!.y);
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close explanation" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
