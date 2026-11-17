import { post } from "./client-api";

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class SpeechCache {
  private clips = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private abort = new AbortController();
  private disposed = false;

  get(text: string): Promise<string> {
    if (this.disposed) return Promise.reject(new DOMException("Disposed", "AbortError"));
    const cached = this.clips.get(text);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(text);
    if (existing) return existing;
    const pendingSignal = this.abort.signal;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await wait(Math.max(0, 6500 - (Date.now() - this.lastStart)), pendingSignal);
        this.lastStart = Date.now();
        const signal = AbortSignal.any([pendingSignal, AbortSignal.timeout(18_000)]);
        const response = await post("/api/speech", { text }, signal);
        const blob = await response.blob();
        if (this.disposed || pendingSignal.aborted)
          throw new DOMException("Disposed", "AbortError");
        if (blob.size < 44 || !response.headers.get("content-type")?.includes("audio/wav"))
          throw new Error("The voice service returned unusable audio.");
        const url = URL.createObjectURL(blob);
        this.clips.set(text, url);
        return url;
      })
      .finally(() => {
        if (this.pending.get(text) === task) this.pending.delete(text);
      });
    this.pending.set(text, task);
    this.queue = task;
    return task;
  }

  cancelPending() {
    this.abort.abort();
    this.abort = new AbortController();
    this.pending.clear();
  }

  dispose() {
    this.disposed = true;
    this.cancelPending();
    this.clips.forEach((url) => URL.revokeObjectURL(url));
    this.clips.clear();
  }
}
