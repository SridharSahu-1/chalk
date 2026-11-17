import type { SpeechSource, SpeechEvents } from "./playback";

export function audioSource(url: string): SpeechSource {
  const audio = new Audio(url);
  let events: SpeechEvents;
  let stall: ReturnType<typeof setTimeout> | undefined;
  const clearStall = () => clearTimeout(stall);
  const play = () => {
    void audio.play().catch((error) => events.error(error));
  };
  return {
    play(callbacks) {
      events = callbacks;
      audio.onplaying = () => {
        clearStall();
        events.start();
      };
      audio.onended = () => {
        clearStall();
        events.end();
      };
      audio.onerror = () => {
        clearStall();
        events.error(new Error("Audio could not be decoded."));
      };
      audio.onwaiting = () => {
        clearStall();
        stall = setTimeout(() => events.error(new Error("Audio stalled.")), 10_000);
      };
      play();
    },
    pause() {
      clearStall();
      audio.pause();
    },
    resume: play,
    stop() {
      clearStall();
      audio.onplaying = audio.onended = audio.onerror = audio.onwaiting = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

export function browserSource(text: string): SpeechSource {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window))
    throw new Error("Speech is not supported.");
  const synth = window.speechSynthesis;
  let utterance: SpeechSynthesisUtterance | null = null;
  let events: SpeechEvents;
  let stopped = false;
  let paused = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const speak = () => {
    if (stopped) return;
    utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const voices = synth.getVoices();
    utterance.voice =
      voices.find((voice) => /^en[-_]/i.test(voice.lang) && voice.localService) ??
      voices.find((voice) => /^en/i.test(voice.lang)) ??
      null;
    utterance.rate = 0.95;
    utterance.onstart = () => {
      clearTimeout(watchdog);
      if (paused) synth.pause();
      else events.start();
    };
    utterance.onend = () => {
      if (!stopped) events.end();
    };
    utterance.onerror = (event) => {
      if (!stopped && !["canceled", "interrupted"].includes(event.error))
        events.error(new Error(event.error));
    };
    watchdog = setTimeout(() => {
      if (!stopped && !paused) events.error(new Error("Browser speech did not start."));
    }, 8000);
    synth.resume();
    synth.speak(utterance);
  };
  const detach = () => {
    if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
    clearTimeout(watchdog);
  };
  return {
    play(callbacks) {
      events = callbacks;
      speak();
    },
    pause() {
      paused = true;
      clearTimeout(watchdog);
      synth.pause();
    },
    resume() {
      paused = false;
      if (synth.speaking) {
        synth.resume();
        events.start();
      } else {
        detach();
        synth.cancel();
        speak();
      }
    },
    stop() {
      stopped = true;
      detach();
      synth.cancel();
      synth.resume();
    },
  };
}
