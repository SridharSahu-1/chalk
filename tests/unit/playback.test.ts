import { describe, expect, it, vi } from "vitest";
import { PlaybackController, type SpeechEvents, type SpeechSource } from "../../src/lib/playback";
import { ApiError } from "../../src/lib/client-api";
import { sampleLesson } from "../../src/lib/sample";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source() {
  let events!: SpeechEvents;
  const adapter: SpeechSource = {
    play: vi.fn((callbacks) => {
      events = callbacks;
      callbacks.start();
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
  return { adapter, end: () => events.end(), fail: (error: Error) => events.error(error) };
}
function setup(
  getClip = vi.fn<(text: string) => Promise<string>>().mockResolvedValue("blob:clip"),
  preferred: "ai" | "browser" = "ai",
) {
  const audio = source(),
    browser = source();
  const deps = {
    getClip,
    audio: vi.fn(() => audio.adapter),
    browser: vi.fn(() => browser.adapter),
    cancelPending: vi.fn(),
  };
  const controller = new PlaybackController(sampleLesson, preferred, deps);
  return { controller, deps, audio, browser };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("playback and asynchronous races", () => {
  it("defaults to AI and advances only on completion", async () => {
    const { controller, audio } = setup();
    controller.play();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ index: 0, active: "ai", status: "playing" });
    audio.end();
    await settle();
    expect(controller.getSnapshot().index).toBe(1);
    controller.dispose();
  });
  it("does not start after pause while a speech request is pending", async () => {
    const clip = deferred<string>();
    const { controller, deps } = setup(vi.fn(() => clip.promise));
    controller.play();
    controller.pause();
    clip.resolve("blob:clip");
    await settle();
    expect(deps.audio).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("paused");
    controller.play();
    await settle();
    expect(deps.audio).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it("discards a stale clip after seeking", async () => {
    const clip = deferred<string>();
    const getter = vi.fn().mockReturnValueOnce(clip.promise).mockResolvedValue("blob:new");
    const { controller, deps } = setup(getter);
    controller.play();
    controller.seek(3);
    await settle();
    clip.resolve("blob:stale");
    await settle();
    expect(deps.audio).not.toHaveBeenCalledWith("blob:stale");
    expect(controller.getSnapshot().index).toBe(3);
    controller.dispose();
  });
  it("falls back on an active quota failure and preserves AI preference", async () => {
    const { controller, deps } = setup(
      vi.fn().mockRejectedValue(new ApiError("RATE_LIMITED", "quota", 60)),
    );
    controller.play();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      active: "browser",
      preferred: "ai",
      status: "playing",
      index: 0,
    });
    expect(deps.browser).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().retryAt).toBeGreaterThan(Date.now());
    controller.dispose();
  });
  it("finishes working audio before switching on a prefetch failure", async () => {
    const getClip = vi
      .fn()
      .mockResolvedValueOnce("blob:clip")
      .mockRejectedValue(new ApiError("RATE_LIMITED", "quota"));
    const { controller, deps, audio } = setup(getClip);
    controller.play();
    await settle();
    expect(controller.getSnapshot().active).toBe("ai");
    expect(audio.adapter.stop).not.toHaveBeenCalled();
    expect(deps.browser).not.toHaveBeenCalled();
    audio.end();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ active: "browser", index: 1 });
    controller.dispose();
  });
  it("never narrates on quota fallback if paused during generation", async () => {
    const clip = deferred<string>();
    const { controller, deps } = setup(vi.fn(() => clip.promise));
    controller.play();
    controller.pause();
    clip.reject(new ApiError("RATE_LIMITED", "quota"));
    await settle();
    expect(deps.browser).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("paused");
    controller.dispose();
  });
  it("invalidates old engine events after a voice switch", async () => {
    const { controller, audio, browser } = setup();
    controller.play();
    await settle();
    controller.setVoice("browser");
    await settle();
    audio.end();
    expect(controller.getSnapshot().index).toBe(0);
    expect(browser.adapter.play).toHaveBeenCalledOnce();
    controller.pause();
    controller.setVoice("ai");
    expect(controller.getSnapshot().status).toBe("paused");
    controller.dispose();
  });
  it("handles autoplay denial separately from voice failure", async () => {
    const { controller, audio, deps } = setup();
    controller.play();
    await settle();
    const denied = new Error("gesture required");
    denied.name = "NotAllowedError";
    audio.fail(denied);
    expect(controller.getSnapshot()).toMatchObject({ status: "paused", active: "ai" });
    expect(deps.browser).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("provides captions-only navigation if browser speech fails", async () => {
    const { controller, browser } = setup(undefined, "browser");
    controller.play();
    browser.fail(new Error("unsupported"));
    expect(controller.getSnapshot().status).toBe("error");
    controller.seek(3);
    expect(controller.getSnapshot()).toMatchObject({ index: 3, status: "paused" });
    controller.dispose();
  });
  it("completes, replays, and ignores events after disposal", async () => {
    const { controller, browser } = setup(undefined, "browser");
    controller.seek(sampleLesson.content.steps.length - 1);
    controller.play();
    browser.end();
    expect(controller.getSnapshot().status).toBe("ended");
    controller.play();
    expect(controller.getSnapshot().index).toBe(0);
    controller.dispose();
    browser.end();
    expect(controller.getSnapshot().index).toBe(0);
  });
});
