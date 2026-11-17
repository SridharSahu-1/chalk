"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { lessonSchema, type Lesson, wordCount } from "@/lib/lesson";
import { ApiError, errorMessage, post } from "@/lib/client-api";
import type { PlaybackController } from "@/lib/playback";
import { sampleLesson } from "@/lib/sample";
import { LessonPlayer } from "./player";
import { WelcomeBoard } from "./whiteboard";

type Message = { role: "user" | "assistant"; content: string };
const topics = [
  { icon: "∑", label: "Math", topic: "Explain the Pythagorean theorem with an example" },
  { icon: "⚛", label: "Science", topic: "How does photosynthesis work?" },
  { icon: "⌘", label: "Technology", topic: "How does binary search work?" },
  { icon: "↗", label: "Economics", topic: "How do supply and demand determine prices?" },
];

export function Tutor() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState("");
  const [chatError, setChatError] = useState("");
  const [restored, setRestored] = useState(false);
  const [about, setAbout] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const controller = useRef<PlaybackController | null>(null);
  const generationRequest = useRef<AbortController | null>(null);
  const chatRequest = useRef<AbortController | null>(null);
  const lessonRef = useRef<Lesson | null>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const aboutDialog = useRef<HTMLDialogElement>(null);
  const saveController = useCallback((value: PlaybackController | null) => {
    controller.current = value;
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function respectCooldown(failure: unknown) {
    if (failure instanceof ApiError && failure.code === "RATE_LIMITED") {
      const time = Date.now();
      setNow(time);
      setRetryAt(time + (failure.retryAfter ?? 15) * 1000);
    }
  }

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("chalk-lesson-v1");
      if (stored) {
        const result = lessonSchema.safeParse(JSON.parse(stored));
        if (result.success) {
          setLesson(result.data);
          lessonRef.current = result.data;
          setRestored(true);
        } else sessionStorage.removeItem("chalk-lesson-v1");
      }
    } catch {
      /* Storage is optional. */
    }
    setStorageReady(true);
    return () => {
      generationRequest.current?.abort();
      chatRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try {
      if (lesson) sessionStorage.setItem("chalk-lesson-v1", JSON.stringify(lesson));
      else sessionStorage.removeItem("chalk-lesson-v1");
    } catch {
      /* Keep lessons usable in memory. */
    }
  }, [lesson, storageReady]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, answering]);
  useEffect(() => {
    if (about) aboutDialog.current?.showModal();
    else aboutDialog.current?.close();
  }, [about]);

  const installLesson = (next: Lesson, isRestored = false) => {
    controller.current?.pause();
    chatRequest.current?.abort();
    chatRequest.current = null;
    lessonRef.current = next;
    setLesson(next);
    setRestored(isRestored);
    setMessages([]);
    setQuestion("");
    setChatError("");
    setAnswering(false);
    setError("");
  };

  async function generate(event?: React.FormEvent) {
    event?.preventDefault();
    if (generating || retrySeconds > 0 || topic.trim().length < 2) return;
    controller.current?.pause();
    setGenerating(true);
    setError("");
    const request = new AbortController();
    generationRequest.current = request;
    try {
      const response = await post(
        "/api/lesson",
        { topic: topic.trim() },
        AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
      );
      const next = lessonSchema.parse(await response.json());
      if (generationRequest.current === request && !request.signal.aborted) {
        installLesson(next);
        setTopic("");
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(errorMessage(failure));
        respectCooldown(failure);
      }
    } finally {
      if (generationRequest.current === request) {
        generationRequest.current = null;
        setGenerating(false);
      }
    }
  }

  function newLesson() {
    generationRequest.current?.abort();
    generationRequest.current = null;
    chatRequest.current?.abort();
    chatRequest.current = null;
    controller.current?.pause();
    lessonRef.current = null;
    setLesson(null);
    setTopic("");
    setMessages([]);
    setError("");
    setChatError("");
    setGenerating(false);
    setAnswering(false);
    setRestored(false);
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!lesson || answering || retrySeconds > 0 || question.trim().length < 2) return;
    controller.current?.pause();
    const currentLesson = lesson;
    const request = new AbortController();
    chatRequest.current = request;
    const text = question.trim();
    const history = messages.slice(-6);
    const currentStep = controller.current?.getSnapshot().index ?? 0;
    const scene = lesson.content.scenes.find(
      (scene) => scene.id === lesson.content.steps[currentStep].sceneId,
    )!;
    setAnswering(true);
    setChatError("");
    setMessages((previous) => [...previous, { role: "user", content: text }]);
    setQuestion("");
    try {
      const response = await post(
        "/api/follow-up",
        {
          topic: lesson.topic,
          narration: lesson.content.steps.map((step) => step.narration),
          currentStep,
          labels: scene.nodes.map((node) => node.label),
          history,
          question: text,
        },
        AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]),
      );
      const result = await response.json();
      if (typeof result.answer !== "string")
        throw new Error("The tutor returned an invalid answer. Please try again.");
      if (chatRequest.current === request && lessonRef.current === currentLesson)
        setMessages((previous) => [...previous, { role: "assistant", content: result.answer }]);
    } catch (failure) {
      if (!request.signal.aborted && lessonRef.current === currentLesson) {
        setChatError(errorMessage(failure));
        respectCooldown(failure);
        setQuestion(text);
        setMessages((previous) => previous.slice(0, -1));
      }
    } finally {
      if (chatRequest.current === request) {
        chatRequest.current = null;
        setAnswering(false);
      }
    }
  }

  function selectConcept(label: string) {
    controller.current?.pause();
    setQuestion(`Can you explain ${label} in more detail?`);
    questionInput.current?.focus();
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="/" className="brand" aria-label="Chalk home">
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          chalk<span className="brand-period">.</span>
        </a>
        <div className="header-center">
          <span className="header-line" />A SPACE FOR YOUR CURIOSITY
          <span className="header-line" />
        </div>
        <button className="about-button" onClick={() => setAbout(true)}>
          <CircleHelp size={16} />
          <span>How it works</span>
        </button>
      </header>

      <main id="main-content">
        <section className={`intro ${lesson ? "intro-compact" : ""}`}>
          <div className="intro-copy">
            <div className="intro-eyebrow">
              <span className="tiny-spark">✧</span> A LITTLE CLARITY CHANGES EVERYTHING
            </div>
            <h1>
              {lesson ? (
                <>
                  Let’s make it <em>click.</em>
                </>
              ) : (
                <>
                  Big ideas.
                  <br />
                  Made <em>clear.</em>
                  <span className="heading-star">✳</span>
                </>
              )}
            </h1>
            <p>
              {lesson ? (
                "A whiteboard, a voice, and room for every question."
              ) : (
                <>
                  An AI tutor that talks you through it, draws it out,
                  <br className="desktop-break" /> and helps you see the bigger picture.
                </>
              )}
            </p>
          </div>
          <div className="intro-note">
            <span className="note-scribble">
              learn a little.
              <br />
              understand a lot.
            </span>
            <ArrowDown size={32} strokeWidth={1} className="note-arrow" />
          </div>
        </section>

        <div className={`workspace${lesson ? " lesson-workspace" : ""}`}>
          <aside className="chat-panel" aria-label="Tutor conversation">
            <div className="panel-top">
              <span>
                <MessageCircle size={15} /> YOUR LEARNING SPACE
              </span>
              {lesson ? (
                <button
                  className="new-button"
                  onClick={newLesson}
                  aria-label="Start a new lesson"
                  title="Start a new lesson"
                >
                  <Plus size={18} />
                </button>
              ) : (
                <span className="small-dot" />
              )}
            </div>
            {!lesson ? (
              <>
                <div className="chat-welcome">
                  <div className="tutor-avatar">
                    <Sparkles size={22} strokeWidth={1.6} />
                  </div>
                  <h2>Hello, curious mind.</h2>
                  <p>
                    What would you like to understand today? Pick a topic. We’ll take it from there.
                  </p>
                </div>
                <form className="topic-form" onSubmit={generate}>
                  <label htmlFor="topic">LET’S START WITH A QUESTION</label>
                  <div className="topic-input-wrap">
                    <textarea
                      id="topic"
                      value={topic}
                      onChange={(event) => setTopic(event.target.value)}
                      placeholder={"Why is the sky blue?\nHow does a neural network learn?"}
                      maxLength={180}
                      minLength={2}
                      rows={3}
                      disabled={generating}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void generate();
                        }
                      }}
                    />
                    <div className="input-footer">
                      <span>
                        {topic.length ? `${topic.length}/180` : "Anything you’re curious about"}
                      </span>
                      <span>↵</span>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={generating || retrySeconds > 0 || topic.trim().length < 2}
                  >
                    {generating ? (
                      <>
                        <LoaderCircle size={17} className="spin" /> Building your lesson…
                      </>
                    ) : retrySeconds > 0 ? (
                      `Try again in ${retrySeconds}s`
                    ) : (
                      <>
                        Let’s learn something <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </form>
                {error ? (
                  <p className="error-message" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="topic-suggestions">
                  <p>OR FOLLOW YOUR CURIOSITY</p>
                  <div>
                    {topics.map((item) => (
                      <button
                        key={item.label}
                        disabled={generating}
                        onClick={() => setTopic(item.topic)}
                      >
                        <span>{item.icon}</span>
                        {item.label}
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sample-invite">
                  <BookOpen size={16} />
                  <div>
                    Just looking around?
                    <button
                      onClick={() => {
                        generationRequest.current?.abort();
                        generationRequest.current = null;
                        setGenerating(false);
                        installLesson(sampleLesson);
                      }}
                    >
                      Explore a sample lesson <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="lesson-summary">
                  <div className="tutor-avatar small">
                    <Sparkles size={19} />
                  </div>
                  <span className="eyebrow">
                    {lesson.source === "sample"
                      ? "PREWRITTEN SAMPLE LESSON"
                      : restored
                        ? "RESTORED AI LESSON"
                        : "YOUR AI LESSON IS READY"}
                  </span>
                  <h2>{lesson.content.title}</h2>
                  <p>{lesson.content.summary}</p>
                  <div className="lesson-meta">
                    <span>
                      <Clock3 size={13} /> About 2 min
                    </span>
                    <span>
                      <BookOpen size={13} /> {wordCount(lesson)} words
                    </span>
                  </div>
                </div>
                <div className="lesson-outline">
                  <span className="eyebrow">THE BIG PICTURE</span>
                  {lesson.content.scenes.map((scene, i) => (
                    <button
                      key={scene.id}
                      onClick={() => {
                        const index = lesson.content.steps.findIndex(
                          (step) => step.sceneId === scene.id,
                        );
                        controller.current?.seek(index);
                      }}
                    >
                      <span>0{i + 1}</span>
                      {scene.title}
                      <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
                <div className="conversation">
                  <div className="assistant-intro">
                    <span className="mini-spark">✧</span>
                    <p>
                      Press play when you’re ready. You can pause, revisit a step, or ask me a
                      question anytime.
                    </p>
                  </div>
                  {lesson.source === "sample" ? (
                    <p className="sample-disclosure">
                      This lesson is prewritten. AI voice and follow-up answers use live APIs when
                      configured.
                    </p>
                  ) : null}
                  {restored ? (
                    <p className="sample-disclosure">
                      Restored from this tab. Press Play to begin; audio is prepared again if
                      needed.
                    </p>
                  ) : null}
                  {messages.map((message, i) => (
                    <div className={`chat-message ${message.role}`} key={i}>
                      {message.role === "assistant" ? <span className="mini-spark">✧</span> : null}
                      <p>{message.content}</p>
                    </div>
                  ))}
                  {answering ? (
                    <div className="thinking" role="status">
                      <LoaderCircle size={14} className="spin" /> Thinking it through…
                    </div>
                  ) : null}
                  <div ref={chatEnd} />
                </div>
                {chatError ? (
                  <p className="error-message" role="alert">
                    {chatError}
                  </p>
                ) : null}
                <form className="followup-form" onSubmit={ask}>
                  <label htmlFor="question" className="sr-only">
                    Ask a follow-up question
                  </label>
                  <textarea
                    ref={questionInput}
                    id="question"
                    rows={2}
                    value={question}
                    maxLength={500}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Wait, why does that happen?"
                    disabled={answering}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Send follow-up question"
                    disabled={answering || retrySeconds > 0 || question.trim().length < 2}
                  >
                    <ArrowUp size={18} />
                  </button>
                </form>
                <p className="followup-note">
                  {retrySeconds > 0
                    ? `Try again in ${retrySeconds}s.`
                    : "No question is too small."}
                </p>
              </>
            )}
          </aside>

          <section
            className={`board-panel ${generating ? "is-generating" : ""}`}
            aria-label="Teaching whiteboard"
          >
            {lesson ? (
              <LessonPlayer
                key={lesson.id}
                lesson={lesson}
                onSelect={selectConcept}
                onController={saveController}
              />
            ) : (
              <>
                <div className="board-toolbar">
                  <div className="board-heading">
                    <span className="live-dot" /> YOUR WHITEBOARD
                  </div>
                  <span className="ready-label">
                    <span /> READY WHEN YOU ARE
                  </span>
                </div>
                <WelcomeBoard />
                <div className="welcome-player">
                  <div className="welcome-play-icon">
                    <Sparkles size={19} />
                  </div>
                  <div>
                    <strong>A fresh perspective is one question away.</strong>
                    <p>Your lesson will come to life right here.</p>
                  </div>
                  <ArrowRight size={20} strokeWidth={1.3} />
                </div>
                <div className="welcome-features">
                  <span>
                    <Check size={13} /> Visual explanations
                  </span>
                  <span>
                    <Check size={13} /> Voice that guides you
                  </span>
                  <span>
                    <Check size={13} /> Learn at your pace
                  </span>
                </div>
              </>
            )}
            {generating ? (
              <div className="generation-overlay" role="status">
                <div className="generation-orbit">
                  <Sparkles size={29} />
                </div>
                <h3>Connecting the dots…</h3>
                <p>Preparing your explanation and whiteboard.</p>
                <span>Usually takes a few moments</span>
              </div>
            ) : null}
          </section>
        </div>
        <div className="below-workspace">
          <span>
            <Lightbulb size={15} /> Understanding beats memorizing. Every single time.
          </span>
          <span>
            MADE FOR YOUR MOMENT OF <em>“oh, I get it.”</em>
          </span>
        </div>
      </main>
      <footer className="site-footer">
        <span>Small lessons. Bigger understanding.</span>
        <span>
          Built with curiosity <span className="footer-flower">✳</span>
        </span>
      </footer>
      <dialog
        ref={aboutDialog}
        className="about-dialog"
        onCancel={() => setAbout(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setAbout(false);
        }}
      >
        <button
          className="dialog-close icon-button"
          onClick={() => setAbout(false)}
          aria-label="Close explanation"
        >
          <X size={21} />
        </button>
        <span className="eyebrow">MEET YOUR WHITEBOARD TUTOR</span>
        <h2>
          A little clarity.
          <br />
          At your own pace.
        </h2>
        <p>
          Enter a topic and Chalk generates a short lesson with spoken explanations and diagrams.
          Press Play, revisit any step, and ask questions as you go.
        </p>
        <ul>
          <li>
            <strong>AI voice by default.</strong> Switch to browser speech anytime. If the free
            voice API is unavailable, browser speech takes over automatically.
          </li>
          <li>
            <strong>You’re in control.</strong> Pause, seek between teaching steps, restart, or
            select a diagram label to ask about it.
          </li>
          <li>
            <strong>Honest about AI.</strong> Fresh lessons and answers require a configured Groq or
            OpenRouter key. The sample lesson is prewritten and labeled. AI can make mistakes.
          </li>
        </ul>
        <p className="privacy-note">
          The current lesson stays in this tab’s session storage. Questions and topics are sent to
          the configured AI providers for generation; do not enter sensitive information.
        </p>
        <button className="primary-button" onClick={() => setAbout(false)}>
          Let curiosity lead <ArrowRight size={17} />
        </button>
      </dialog>
    </div>
  );
}
