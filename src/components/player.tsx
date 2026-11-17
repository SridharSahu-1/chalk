"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  LoaderCircle,
} from "lucide-react";
import type { Lesson } from "@/lib/lesson";
import { PlaybackController, type Voice } from "@/lib/playback";
import { SpeechCache } from "@/lib/speech-cache";
import { audioSource, browserSource } from "@/lib/speech-adapters";
import { Whiteboard } from "./whiteboard";

export function LessonPlayer({
  lesson,
  onSelect,
  onController,
}: {
  lesson: Lesson;
  onSelect: (label: string) => void;
  onController: (controller: PlaybackController | null) => void;
}) {
  const [controller, setController] = useState<PlaybackController | null>(null);
  useEffect(() => {
    let preferred: Voice = "ai";
    try {
      if (localStorage.getItem("chalk-voice-v1") === "browser") preferred = "browser";
    } catch {
      /* Storage is optional. */
    }
    const cache = new SpeechCache();
    const playback = new PlaybackController(lesson, preferred, {
      getClip: (text) => cache.get(text),
      audio: audioSource,
      browser: browserSource,
      cancelPending: () => cache.cancelPending(),
    });
    // Trigger platform voice discovery and keep its lifecycle scoped to this player.
    window.speechSynthesis?.getVoices();
    const discover = () => window.speechSynthesis.getVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", discover);
    setController(playback);
    onController(playback);
    return () => {
      onController(null);
      playback.dispose();
      cache.dispose();
      window.speechSynthesis?.removeEventListener("voiceschanged", discover);
    };
  }, [lesson, onController]);
  if (!controller)
    return (
      <div className="player-preparing">
        <LoaderCircle className="spin" size={22} /> Preparing your whiteboard…
      </div>
    );
  return <PlayerContent lesson={lesson} controller={controller} onSelect={onSelect} />;
}

function PlayerContent({
  lesson,
  controller,
  onSelect,
}: {
  lesson: Lesson;
  controller: PlaybackController;
  onSelect: (label: string) => void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [choice, setChoice] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const diagram = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = diagram.current;
    const concept = viewport?.querySelector<SVGGElement>(".node-active");
    if (!viewport || !concept || viewport.scrollWidth <= viewport.clientWidth) return;
    const bounds = concept.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + bounds.left - frame.left - (frame.width - bounds.width) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [state.index]);
  useEffect(() => {
    if (!state.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.retryAt]);
  const sceneIndex = lesson.content.scenes.findIndex(
    (scene) => scene.id === lesson.content.steps[state.index].sceneId,
  );
  const scene = lesson.content.scenes[sceneIndex];
  const running = state.status === "playing" || state.status === "loading";
  const cooling = now < state.retryAt;
  const setVoice = (voice: Voice) => {
    controller.setVoice(voice);
    try {
      localStorage.setItem("chalk-voice-v1", voice);
    } catch {
      /* Keep playback usable without storage. */
    }
  };
  return (
    <>
      <div className="board-toolbar">
        <div className="board-heading">
          <span className="live-dot" />
          <span>{lesson.source === "sample" ? "SAMPLE WHITEBOARD" : "YOUR WHITEBOARD"}</span>
        </div>
        <div className="voice-switch" aria-label="Narration voice">
          <Volume2 size={14} aria-hidden="true" />
          <button
            aria-pressed={state.preferred === "ai"}
            onClick={() => setVoice("ai")}
            disabled={cooling}
          >
            AI voice <span>✧</span>
          </button>
          <button aria-pressed={state.preferred === "browser"} onClick={() => setVoice("browser")}>
            Browser
          </button>
        </div>
      </div>
      <div className="board-paper">
        <div className="scene-caption">
          <span>
            0{sceneIndex + 1} <span className="caption-divider">/</span> 04
          </span>
          <h2>{scene.title}</h2>
        </div>
        <div
          ref={diagram}
          className="diagram-viewport"
          tabIndex={0}
          role="region"
          aria-label="Scrollable lesson diagram"
        >
          <Whiteboard lesson={lesson} index={state.index} onSelect={onSelect} />
        </div>
        <div className="board-hint">
          <span className="desktop-hint">Click a concept to explore it together</span>
          <span className="mobile-hint">Swipe to explore · tap a concept to ask</span>{" "}
          <span>↗</span>
        </div>
      </div>
      <div className="narration" aria-label="Narration captions">
        <div
          className={`narration-icon ${state.status === "playing" ? "speaking" : ""}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
          <i />
        </div>
        <p>{lesson.content.steps[state.index].narration}</p>
        <span className="source-label">{state.active === "ai" ? "AI voice" : "Browser voice"}</span>
      </div>
      <div className="playback-controls">
        <button
          className="icon-button restart"
          aria-label="Restart lesson"
          title="Restart lesson"
          onClick={controller.restart}
        >
          <RotateCcw size={18} />
        </button>
        <div className="transport">
          <button
            className="icon-button"
            aria-label="Previous step"
            disabled={state.index === 0}
            onClick={() => controller.seek(state.index - 1)}
          >
            <ChevronLeft size={21} />
          </button>
          <button
            className="play-button"
            aria-label={
              running ? "Pause lesson" : state.status === "ended" ? "Replay lesson" : "Play lesson"
            }
            onClick={running ? controller.pause : controller.play}
          >
            {state.status === "loading" ? (
              <LoaderCircle size={22} className="spin" />
            ) : running ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Next step"
            disabled={state.index === lesson.content.steps.length - 1}
            onClick={() => controller.seek(state.index + 1)}
          >
            <ChevronRight size={21} />
          </button>
        </div>
        <span className="step-count">
          {state.index + 1}
          <span> / {lesson.content.steps.length} steps</span>
        </span>
        <label className="timeline">
          <span className="sr-only">Lesson step</span>
          <input
            type="range"
            min="0"
            max={lesson.content.steps.length - 1}
            value={state.index}
            onChange={(event) => controller.seek(Number(event.target.value))}
            aria-valuetext={`Step ${state.index + 1} of ${lesson.content.steps.length}`}
            style={
              {
                "--progress": `${(state.index / (lesson.content.steps.length - 1)) * 100}%`,
              } as React.CSSProperties
            }
          />
        </label>
        <span className="playback-status">
          {state.status === "loading"
            ? "Preparing voice"
            : state.status === "playing"
              ? "Playing"
              : state.status === "ended"
                ? "Complete"
                : "Press play"}
        </span>
      </div>
      {state.message ? (
        <div className="voice-notice" role="status">
          <Volume2 size={15} />
          <span>{state.message}</span>
          {state.active === "browser" && state.preferred === "ai" ? (
            <button onClick={() => setVoice("ai")} disabled={cooling}>
              {cooling
                ? `Retry in ${Math.max(1, Math.ceil((state.retryAt - now) / 1000))}s`
                : "Retry AI voice"}
            </button>
          ) : null}
        </div>
      ) : null}
      {state.status === "ended" ? (
        <section className="knowledge-check" aria-labelledby="check-title">
          <span className="eyebrow">LET’S MAKE IT STICK</span>
          <h3 id="check-title">{lesson.content.check.question}</h3>
          <div className="answer-choices">
            {lesson.content.check.choices.map((answer, index) => (
              <button
                key={answer}
                aria-pressed={choice === index}
                className={choice === index ? "chosen" : ""}
                onClick={() => setChoice(index)}
              >
                <span>{String.fromCharCode(65 + index)}</span>
                {answer}
              </button>
            ))}
          </div>
          {choice !== null ? (
            <p className="answer-feedback" role="status">
              <strong>
                {choice === lesson.content.check.correctIndex
                  ? "You’ve got it. "
                  : "Almost — let’s look at why. "}
              </strong>
              {lesson.content.check.explanation}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
