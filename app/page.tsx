"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Status = "idle" | "listening" | "transcribing" | "thinking" | "error";

const BAR_COUNT = 24;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState<string>("");
  const [premiumVoice, setPremiumVoice] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingSpeechId, setLoadingSpeechId] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(new Array(BAR_COUNT).fill(0.05));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stopVisualizer = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setLevels(new Array(BAR_COUNT).fill(0.05));
  }, []);

  const runVisualizer = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / BAR_COUNT) || 1;
      const next: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const value = data[i * step] / 255;
        next.push(Math.max(0.05, value));
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startRecording = useCallback(async () => {
    setErrorText("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      runVisualizer();

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = handleRecordingStop;
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("listening");
    } catch (err) {
      setErrorText("Microphone access was denied or is unavailable.");
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanupAudioGraph = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    stopVisualizer();
  }, [stopVisualizer]);

  const handleRecordingStop = useCallback(async () => {
    cleanupAudioGraph();
    setStatus("transcribing");

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) {
      setStatus("idle");
      return;
    }

    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed.");

      const transcript: string = data.text;
      if (!transcript) {
        setStatus("idle");
        return;
      }

      const userMessage: Message = { id: crypto.randomUUID(), role: "user", text: transcript };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setStatus("thinking");

      const history = nextMessages.map((m) => ({ role: m.role, content: m.text }));
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok) throw new Error(chatData.error || "The agent failed to respond.");

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: chatData.text || "I don't have a response for that.",
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setErrorText(message);
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, cleanupAudioGraph]);

  const toggleRecording = useCallback(() => {
    if (status === "listening") {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (status === "transcribing" || status === "thinking") return;
    startRecording();
  }, [status, startRecording]);

  const playMessage = useCallback(
    async (message: Message) => {
      if (speakingId === message.id) {
        audioPlayerRef.current?.pause();
        setSpeakingId(null);
        return;
      }

      setLoadingSpeechId(message.id);
      setErrorText("");
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message.text, premium: premiumVoice }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Speech generation failed.");
        }
        const audioBlob = await res.blob();
        const url = URL.createObjectURL(audioBlob);

        if (!audioPlayerRef.current) {
          audioPlayerRef.current = new Audio();
        }
        const player = audioPlayerRef.current;
        player.src = url;
        player.onended = () => setSpeakingId(null);
        await player.play();
        setSpeakingId(message.id);
      } catch (err) {
        const message2 = err instanceof Error ? err.message : "Could not play audio.";
        setErrorText(message2);
      } finally {
        setLoadingSpeechId(null);
      }
    },
    [speakingId, premiumVoice]
  );

  const statusLabel: Record<Status, string> = {
    idle: "Tap the mic to talk",
    listening: "Listening — tap to stop",
    transcribing: "Transcribing...",
    thinking: "Thinking...",
    error: "Something went wrong",
  };

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <p className="eyebrow mono">VOICE AGENT</p>
            <h1>Push to talk</h1>
          </div>
          <label className="voiceToggle mono">
            <input
              type="checkbox"
              checked={premiumVoice}
              onChange={(e) => setPremiumVoice(e.target.checked)}
            />
            Voice via Eleven Labs API
          </label>
        </header>

        <section className="transcript">
          {messages.length === 0 && (
            <div className="empty">
              <p>No conversation yet.</p>
              <p className="dim">Click the mic, speak, click again to stop.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubbleRow ${m.role}`}>
              <div className={`bubble ${m.role}`}>
                <p className="bubbleLabel mono">{m.role === "user" ? "you" : "agent"}</p>
                <p>{m.text}</p>
                {m.role === "assistant" && (
                  <button
                    className={`playButton ${speakingId === m.id ? "playing" : ""}`}
                    onClick={() => playMessage(m)}
                    disabled={loadingSpeechId === m.id}
                    aria-label={speakingId === m.id ? "Stop speaking" : "Speak this reply"}
                  >
                    {loadingSpeechId === m.id ? (
                      <span className="mono small">...</span>
                    ) : speakingId === m.id ? (
                      <StopIcon />
                    ) : (
                      <SpeakerIcon />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </section>

        {errorText && <p className="errorText mono">{errorText}</p>}

        <section className="controls">
          <div className="bars" aria-hidden="true">
            {levels.map((v, i) => (
              <span key={i} className="bar" style={{ height: `${8 + v * 44}px` }} />
            ))}
          </div>

          <button
            className={`micButton ${status}`}
            onClick={toggleRecording}
            disabled={status === "transcribing" || status === "thinking"}
            aria-pressed={status === "listening"}
            aria-label={status === "listening" ? "Stop recording" : "Start recording"}
          >
            {status === "listening" ? <SquareIcon /> : <MicIcon />}
          </button>

          <p className="statusLabel mono">{statusLabel[status]}</p>
        </section>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          padding: 32px 16px 48px;
        }
        .shell {
          width: 100%;
          max-width: 640px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          border-bottom: 1px solid var(--panel-border);
          padding-bottom: 20px;
        }
        .eyebrow {
          letter-spacing: 0.14em;
          font-size: 12px;
          color: var(--accent);
          margin: 0 0 6px;
        }
        h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.01em;
        }
        .voiceToggle {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-dim);
          cursor: pointer;
        }
        .voiceToggle input {
          accent-color: var(--accent);
          width: 15px;
          height: 15px;
        }
        .transcript {
          flex: 1;
          min-height: 320px;
          max-height: 55vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-right: 4px;
        }
        .empty {
          margin: auto;
          text-align: center;
          color: var(--text-dim);
        }
        .empty .dim {
          font-size: 13px;
          margin-top: 6px;
        }
        .bubbleRow {
          display: flex;
        }
        .bubbleRow.user {
          justify-content: flex-end;
        }
        .bubbleRow.assistant {
          justify-content: flex-start;
        }
        .bubble {
          max-width: 78%;
          border-radius: var(--radius);
          padding: 12px 14px;
          border: 1px solid var(--panel-border);
          background: var(--panel);
          position: relative;
        }
        .bubble.user {
          background: var(--accent-soft);
          border-color: rgba(139, 92, 246, 0.35);
        }
        .bubble p {
          margin: 0;
          line-height: 1.5;
          font-size: 15px;
        }
        .bubbleLabel {
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--text-dim);
          margin: 0 0 4px;
        }
        .playButton {
          margin-top: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          border: 1px solid var(--panel-border);
          background: var(--warm-soft);
          color: var(--warm);
          cursor: pointer;
        }
        .playButton.playing {
          background: var(--warm);
          color: var(--bg);
        }
        .playButton:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .small {
          font-size: 11px;
        }
        .errorText {
          color: var(--danger);
          font-size: 13px;
          text-align: center;
        }
        .controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--panel-border);
        }
        .bars {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 52px;
        }
        .bar {
          width: 3px;
          background: var(--accent);
          border-radius: 2px;
          transition: height 80ms linear;
          opacity: 0.85;
        }
        .micButton {
          width: 76px;
          height: 76px;
          border-radius: 999px;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: white;
          cursor: pointer;
          box-shadow: 0 0 0 0 var(--accent-soft);
          transition: transform 120ms ease, box-shadow 200ms ease;
        }
        .micButton:hover:not(:disabled) {
          transform: scale(1.03);
        }
        .micButton:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .micButton.listening {
          background: var(--danger);
          animation: pulse 1.4s infinite;
        }
        @keyframes pulse {
          0% {
            box-shadow: 0 0 0 0 var(--danger-soft);
          }
          70% {
            box-shadow: 0 0 0 18px rgba(239, 100, 97, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 100, 97, 0);
          }
        }
        .statusLabel {
          font-size: 12px;
          color: var(--text-dim);
          letter-spacing: 0.04em;
        }
      `}</style>
    </main>
  );
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Z"
        fill="currentColor"
      />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  );
}
