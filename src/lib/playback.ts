import type { Lesson } from "./lesson";
import { ApiError } from "./client-api";

export type Voice = "ai" | "browser";
export type Status = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export type PlaybackState = {
  index: number;
  status: Status;
  preferred: Voice;
  active: Voice;
  message: string;
  retryAt: number;
  started: boolean;
};
export type SpeechEvents = { start: () => void; end: () => void; error: (error: Error) => void };
export interface SpeechSource {
  play(events: SpeechEvents): void;
  pause(): void;
  resume(): void;
  stop(): void;
}
export interface PlaybackDependencies {
  getClip(text: string): Promise<string>;
  audio(url: string): SpeechSource;
  browser(text: string): SpeechSource;
  cancelPending(): void;
}

// No React or browser globals: all side effects are supplied by the adapters.
export class PlaybackController {
  private state: PlaybackState;
  private listeners = new Set<() => void>();
  private source: SpeechSource | null = null;
  private generation = 0;
  private wantsPlay = false;
  private fallback = false;
  private disposed = false;

  constructor(
    private lesson: Lesson,
    preferred: Voice,
    private deps: PlaybackDependencies,
  ) {
    this.state = {
      index: 0,
      status: "idle",
      preferred,
      active: preferred,
      message: "",
      retryAt: 0,
      started: false,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<PlaybackState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private stop() {
    this.generation++;
    this.source?.stop();
    this.source = null;
  }
  private current(generation: number) {
    return !this.disposed && this.generation === generation;
  }

  play = () => {
    if (this.disposed || this.wantsPlay) return;
    this.wantsPlay = true;
    if (this.state.status === "ended") this.update({ index: 0 });
    if (this.source && this.state.status === "paused") {
      this.update({ status: "playing" });
      this.source.resume();
    } else void this.startStep();
  };

  pause = () => {
    this.wantsPlay = false;
    this.source?.pause();
    if (this.state.status !== "ended" && this.state.status !== "idle")
      this.update({ status: "paused" });
  };

  seek = (index: number) => {
    this.stop();
    this.update({
      index: Math.max(0, Math.min(index, this.lesson.content.steps.length - 1)),
      status: "paused",
      started: true,
    });
    if (this.wantsPlay) void this.startStep();
  };

  restart = () => {
    this.seek(0);
  };

  setVoice = (voice: Voice) => {
    if (voice === "ai" && Date.now() < this.state.retryAt) return;
    this.stop();
    this.deps.cancelPending();
    this.fallback = false;
    this.update({
      preferred: voice,
      active: voice,
      message: "",
      status: this.state.started ? "paused" : "idle",
    });
    if (this.wantsPlay) void this.startStep();
  };

  private useFallback(error: unknown, next: boolean) {
    this.fallback = true;
    const retryAfter = error instanceof ApiError ? error.retryAfter : undefined;
    this.update({
      retryAt: retryAfter ? Date.now() + retryAfter * 1000 : 0,
      message:
        error instanceof ApiError && error.code === "RATE_LIMITED"
          ? `AI voice reached its free limit. ${next ? "Browser voice will continue at the next step." : "Continuing with browser voice."}`
          : `AI voice is unavailable. ${next ? "Browser voice will continue at the next step." : "Continuing with browser voice."}`,
    });
  }

  private async startStep() {
    this.stop();
    const generation = this.generation;
    const narration = this.lesson.content.steps[this.state.index].narration;
    const active: Voice = this.state.preferred === "ai" && !this.fallback ? "ai" : "browser";
    this.update({ active, status: "loading" });
    try {
      let source: SpeechSource;
      if (active === "ai") {
        let url: string;
        try {
          url = await this.deps.getClip(narration);
        } catch (error) {
          if (!this.current(generation)) return;
          this.useFallback(error, false);
          if (this.wantsPlay) void this.startStep();
          return;
        }
        if (!this.current(generation) || !this.wantsPlay) return;
        source = this.deps.audio(url);
      } else source = this.deps.browser(narration);
      if (!this.current(generation) || !this.wantsPlay) return;
      this.source = source;
      let completed = false;
      source.play({
        start: () => {
          if (!this.current(generation)) return;
          if (!this.wantsPlay) {
            source.pause();
            return;
          }
          this.update({ status: "playing", started: true });
          const next = this.lesson.content.steps[this.state.index + 1];
          if (active === "ai" && next && !this.fallback) {
            void this.deps.getClip(next.narration).catch((error) => {
              if (this.current(generation) && !this.fallback) this.useFallback(error, true);
            });
          }
        },
        end: () => {
          if (!this.current(generation) || completed) return;
          completed = true;
          this.source = null;
          if (this.state.index === this.lesson.content.steps.length - 1) {
            this.wantsPlay = false;
            this.update({ status: "ended" });
          } else {
            this.update({ index: this.state.index + 1, status: "paused" });
            if (this.wantsPlay) void this.startStep();
          }
        },
        error: (error) => {
          if (!this.current(generation)) return;
          if (error.name === "NotAllowedError") {
            this.stop();
            this.wantsPlay = false;
            this.update({
              status: "paused",
              message: "Your browser needs a click to start audio. Press Play to continue.",
            });
          } else if (active === "ai") {
            this.stop();
            this.useFallback(error, false);
            if (this.wantsPlay) void this.startStep();
          } else {
            this.stop();
            this.wantsPlay = false;
            this.update({
              status: "error",
              message:
                "Browser speech is unavailable. Read the captions and use the step controls to continue.",
            });
          }
        },
      });
    } catch (error) {
      if (!this.current(generation)) return;
      if (active === "ai") {
        this.useFallback(error, false);
        if (this.wantsPlay) void this.startStep();
      } else {
        this.wantsPlay = false;
        this.update({
          status: "error",
          message: "Speech is not supported here. Read the captions and use the step controls.",
        });
      }
    }
  }

  dispose() {
    this.wantsPlay = false;
    this.stop();
    this.disposed = true;
    this.deps.cancelPending();
    this.listeners.clear();
  }
}
