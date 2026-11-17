import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechCache } from "../../src/lib/speech-cache";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("speech cache", () => {
  it("deduplicates pending clips and reuses them for replay", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array(100), { headers: { "content-type": "audio/wav" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    const cache = new SpeechCache();
    const first = cache.get("Some narration");
    expect(cache.get("Some narration")).toBe(first);
    await vi.runAllTimersAsync();
    const url = await first;
    expect(await cache.get("Some narration")).toBe(url);
    expect(fetcher).toHaveBeenCalledOnce();
    cache.dispose();
  });
  it("paces starts and cancels queued work", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(new Uint8Array(100), { headers: { "content-type": "audio/wav" } }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const cache = new SpeechCache();
    const first = cache.get("First narration");
    await vi.advanceTimersByTimeAsync(0);
    await first;
    const second = cache.get("Second narration");
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).toHaveBeenCalledOnce();
    cache.cancelPending();
    await rejected;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledOnce();
    cache.dispose();
  });
});
