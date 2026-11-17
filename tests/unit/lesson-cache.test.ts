import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedLesson, clearLessonCache } from "../../src/lib/server/lesson-cache";
import { sampleLesson } from "../../src/lib/sample";

beforeEach(clearLessonCache);
afterEach(() => {
  clearLessonCache();
  vi.useRealTimers();
});
describe("completed lesson cache", () => {
  it("reuses completed lessons without spending another provider request", async () => {
    const generate = vi.fn().mockResolvedValue(sampleLesson.content);
    expect(await cachedLesson("technology", generate)).toBe(sampleLesson.content);
    expect(await cachedLesson("  technology  ", generate)).toBe(sampleLesson.content);
    expect(generate).toHaveBeenCalledOnce();
  });
  it("does not cache failed generations", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValue(sampleLesson.content);
    await expect(cachedLesson("topic", generate)).rejects.toThrow("quota");
    await cachedLesson("topic", generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("expires old entries and bounds the cache to ten topics", async () => {
    vi.useFakeTimers();
    const generate = vi.fn().mockResolvedValue(sampleLesson.content);
    for (let i = 0; i < 11; i++) await cachedLesson(`topic ${i}`, generate);
    await cachedLesson("topic 0", generate);
    expect(generate).toHaveBeenCalledTimes(12);
    vi.advanceTimersByTime(31 * 60_000);
    await cachedLesson("topic 0", generate);
    expect(generate).toHaveBeenCalledTimes(13);
  });
});
