"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { useConversationStore, Message } from "@/stores/conversationStore";
import {
  useVoiceStore,
  TTSProvider,
  STTProvider,
} from "@/stores/voiceStore";
import { webPlatform } from "@/lib/tools/platform/web";
import type { ClientToolCall } from "@/lib/tools/types";
import { ActiveTimers } from "@/components/ActiveTimers";
import { ActiveAlarms } from "@/components/ActiveAlarms";

export default function Home() {
  const messages = useConversationStore((s) => s.messages);
  const addMessage = useConversationStore((s) => s.addMessage);
  const updateLastAssistant = useConversationStore((s) => s.updateLastAssistant);

  const {
    isListening,
    isThinking,
    isSpeaking,
    currentTranscript,
    error,
    ttsProvider,
    sttProvider,
    openaiVoice,
    speechLang,
    setListening,
    setThinking,
    setSpeaking,
    setTranscript,
    setError,
    setTtsProvider,
    setSttProvider,
    setOpenaiVoice,
    setSpeechLang,
  } = useVoiceStore();

  const [showSettings, setShowSettings] = useState(false);
  const [textInput, setTextInput] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Execute client-side tool calls (timer/alarm etc.) ────────
  const runClientToolCalls = useCallback(async (calls: ClientToolCall[]) => {
    for (const call of calls) {
      try {
        if (call.name === "set_timer") {
          const seconds = Number(call.args.duration_seconds);
          const label =
            typeof call.args.label === "string" ? call.args.label : "";
          if (Number.isFinite(seconds) && seconds > 0) {
            await webPlatform.scheduleTimer({
              id: call.id,
              label,
              durationSeconds: seconds,
            });
          }
        } else if (call.name === "set_alarm") {
          const hour = Number(call.args.hour);
          const minute = Number.isFinite(Number(call.args.minute))
            ? Number(call.args.minute)
            : 0;
          const dayOffset = Number.isFinite(Number(call.args.day_offset))
            ? Number(call.args.day_offset)
            : 0;
          const label =
            typeof call.args.label === "string" ? call.args.label : "";

          if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
            const when = new Date();
            when.setDate(when.getDate() + dayOffset);
            when.setHours(hour, minute, 0, 0);
            // If user said "at X" without a day offset and that time has
            // already passed today, roll forward to tomorrow.
            if (dayOffset === 0 && when.getTime() <= Date.now()) {
              when.setDate(when.getDate() + 1);
            }
            await webPlatform.scheduleAlarm({
              id: call.id,
              label,
              ringsAt: when.getTime(),
            });
          }
        }
      } catch (e) {
        console.error("Client tool failed", call.name, e);
      }
    }
  }, []);

  // ── Core: handle user message ───────────────────────────────
  const handleUserMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      setTranscript("");
      const userMsg: Message = { role: "user", content: text, timestamp: Date.now() };
      addMessage(userMsg);

      const historyForRequest = useConversationStore
        .getState()
        .messages.slice(-11, -1) // last 10 before the one we just added
        .map(({ role, content }) => ({ role, content }));

      setThinking(true);
      setError(null);

      try {
        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history: historyForRequest,
          }),
        });

        if (!chatRes.ok) {
          const errText = await chatRes.text();
          let errMsg = "Chat failed";
          try { errMsg = JSON.parse(errText).error || errMsg; } catch {}
          throw new Error(errMsg);
        }

        const reader = chatRes.body!.getReader();
        const decoder = new TextDecoder();
        let fullReply = "";
        let assistantAdded = false;
        let buffer = "";

        const ensureAssistant = () => {
          if (!assistantAdded) {
            addMessage({ role: "assistant", content: "", timestamp: Date.now() });
            setThinking(false);
            assistantAdded = true;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                ensureAssistant();
                fullReply += parsed.content;
                updateLastAssistant(fullReply);
              } else if (parsed.toolCalls) {
                await runClientToolCalls(parsed.toolCalls as ClientToolCall[]);
              } else if (parsed.error) {
                setError(parsed.error);
              }
            } catch {}
          }
        }

        if (fullReply) {
          setSpeaking(true);
          try {
            if (ttsProvider === "camb") await speakWithCamb(fullReply);
            else if (ttsProvider === "openai") await speakWithOpenAI(fullReply);
            else await speakWithBrowser(fullReply);
          } catch (ttsErr: unknown) {
            const msg = ttsErr instanceof Error ? ttsErr.message : "TTS failed";
            setError(`TTS failed: ${msg}`);
          } finally {
            setSpeaking(false);
          }
        } else {
          setThinking(false);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Something failed";
        setError(message);
        setThinking(false);
      }
    },
    [
      addMessage,
      updateLastAssistant,
      runClientToolCalls,
      setTranscript,
      setThinking,
      setError,
      setSpeaking,
      ttsProvider,
      openaiVoice,
      speechLang,
    ]
  );

  // ── STT: Browser ────────────────────────────────────────────
  const startBrowserListening = useCallback(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError("Speech Recognition not supported. Use Chrome.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = speechLang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setListening(true);
      setTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setTranscript(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        handleUserMessage(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed") {
        setError("Microphone access denied.");
      } else if (event.error === "no-speech") {
        setError("No speech detected.");
      } else if (event.error === "service-not-allowed" || event.error === "network") {
        setSttProvider("whisper");
        setError("Browser STT unavailable on this device. Switched to Whisper. Tap mic again.");
      } else {
        setError(`Speech error: ${event.error}`);
      }
      setListening(false);
    };

    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, [speechLang, handleUserMessage, setError, setListening, setTranscript, setSttProvider]);

  // ── STT: Upload-based (Whisper or Google) ───────────────────
  const startUploadListening = useCallback(async (endpoint: string, providerLabel: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      // Voice activity detection — auto-stop after silence.
      let vadCleanup: (() => void) | null = null;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          const buffer = new Float32Array(analyser.fftSize);
          const SILENCE_RMS = 0.015;
          const SILENCE_AFTER_SPEECH_MS = 1500;
          const MAX_TOTAL_MS = 30_000;
          const NO_SPEECH_TIMEOUT_MS = 6_000;

          let hasSpoken = false;
          let lastSoundAt = Date.now();
          const startedAt = Date.now();

          const intervalId = setInterval(() => {
            analyser.getFloatTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
            const rms = Math.sqrt(sum / buffer.length);

            const now = Date.now();
            if (rms > SILENCE_RMS) {
              lastSoundAt = now;
              hasSpoken = true;
            }

            const elapsed = now - startedAt;
            const silent = now - lastSoundAt;

            const shouldStop =
              elapsed >= MAX_TOTAL_MS ||
              (hasSpoken && silent >= SILENCE_AFTER_SPEECH_MS) ||
              (!hasSpoken && elapsed >= NO_SPEECH_TIMEOUT_MS);

            if (shouldStop && mediaRecorder.state === "recording") {
              mediaRecorder.stop();
            }
          }, 100);

          vadCleanup = () => {
            clearInterval(intervalId);
            try { source.disconnect(); } catch {}
            audioCtx.close().catch(() => {});
          };
        }
      } catch {
        // VAD unavailable — manual-stop still works.
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        vadCleanup?.();
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });

        setListening(false);
        setTranscript("Transcribing...");

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          const res = await fetch(endpoint, { method: "POST", body: formData });
          if (!res.ok) throw new Error((await res.json()).error || "Transcription failed");
          const { text } = await res.json();
          if (text?.trim()) handleUserMessage(text.trim());
          else { setTranscript(""); setError("Empty transcription."); }
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : `${providerLabel} failed`);
          setTranscript("");
        }
      };

      mediaRecorder.start();
      setListening(true);
      setTranscript("");
    } catch {
      setError("Microphone access denied.");
    }
  }, [handleUserMessage, setListening, setTranscript, setError]);

  const startListening = useCallback(() => {
    setError(null);
    if (sttProvider === "whisper") startUploadListening("/api/transcribe", "Whisper");
    else if (sttProvider === "google") startUploadListening("/api/transcribe-google", "Google STT");
    else startBrowserListening();
  }, [sttProvider, startUploadListening, startBrowserListening, setError]);

  const stopListening = useCallback(() => {
    if ((sttProvider === "whisper" || sttProvider === "google") && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    } else {
      recognitionRef.current?.stop();
    }
    setListening(false);
  }, [sttProvider, setListening]);

  // ── TTS providers ───────────────────────────────────────────
  const speakWithCamb = async (text: string) => {
    const submitRes = await fetch("/api/synthesize-camb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!submitRes.ok) throw new Error((await submitRes.json()).error || "Camb.ai submit failed");
    const { taskId } = await submitRes.json();

    let status = "PENDING";
    let runId: number | null = null;
    let attempts = 0;
    while (status === "PENDING" && attempts < 40) {
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;
      const pollRes = await fetch(`/api/synthesize-camb/status?taskId=${taskId}`);
      if (!pollRes.ok) throw new Error("Camb.ai poll failed");
      const data = await pollRes.json();
      status = data.status;
      runId = data.runId;
    }
    if (status !== "SUCCESS" || !runId) throw new Error(`Camb.ai TTS failed: ${status}`);

    const audioRes = await fetch(`/api/synthesize-camb/audio?runId=${runId}`);
    if (!audioRes.ok) throw new Error("Camb.ai audio download failed");
    await playAudioBlob(await audioRes.blob());
  };

  const speakWithOpenAI = async (text: string) => {
    const res = await fetch("/api/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: openaiVoice }),
    });
    if (!res.ok) throw new Error("OpenAI TTS failed");
    await playAudioBlob(await res.blob());
  };

  const speakWithBrowser = (text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) { reject(new Error("Not supported")); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLang;
      u.rate = 0.9;
      u.onend = () => resolve();
      u.onerror = (e) => reject(new Error(e.error));
      window.speechSynthesis.speak(u);
    });
  };

  const playAudioBlob = (blob: Blob): Promise<void> => {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => reject(new Error("Playback failed"));
      audio.play();
    });
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) { handleUserMessage(textInput.trim()); setTextInput(""); }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("ka-GE", { hour: "2-digit", minute: "2-digit" });
  };

  // ── Status helpers ──────────────────────────────────────────
  const isProcessing = isThinking || isSpeaking;
  const statusText = isListening
    ? sttProvider === "whisper"
      ? "Recording... tap to stop"
      : "Listening..."
    : isThinking
      ? "Thinking..."
      : isSpeaking
        ? "Speaking..."
        : null;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-mono text-sm font-bold">
              N
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight">Mia</h1>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                  dev
                </span>
              </div>
              <p className="text-xs text-muted">Georgian Voice AI Assistant</p>
            </div>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 rounded-lg border border-border hover:bg-surface-2 flex items-center justify-center transition-colors text-muted hover:text-foreground"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" />
              <path d="M13.5 8a5.5 5.5 0 01-.4 2.1l1.3 1.3-1.4 1.4-1.3-1.3A5.5 5.5 0 018 13.5a5.5 5.5 0 01-2.1-.4l-1.3 1.3-1.4-1.4 1.3-1.3A5.5 5.5 0 012.5 8c0-.7.1-1.4.4-2.1L1.6 4.6 3 3.2l1.3 1.3A5.5 5.5 0 018 2.5c.7 0 1.4.1 2.1.4l1.3-1.3 1.4 1.4-1.3 1.3c.3.7.5 1.4.5 2.2z" />
            </svg>
          </button>
        </div>

        {/* ── Settings Panel ─────────────────────────────── */}
        {showSettings && (
          <div className="border-t border-border/50 bg-surface/50 backdrop-blur-sm">
            <div className="max-w-2xl mx-auto px-4 py-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-muted block mb-1 font-medium">Speech-to-Text</label>
                  <select
                    value={sttProvider}
                    onChange={(e) => setSttProvider(e.target.value as STTProvider)}
                    className="w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                  >
                    <option value="browser">Browser</option>
                    <option value="whisper">Whisper</option>
                    <option value="google">Google Cloud (ka-GE)</option>
                  </select>
                </div>

                {sttProvider === "browser" && (
                  <div>
                    <label className="text-muted block mb-1 font-medium">Language</label>
                    <select
                      value={speechLang}
                      onChange={(e) => setSpeechLang(e.target.value)}
                      className="w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                    >
                      <option value="ka-GE">Georgian</option>
                      <option value="ka">Georgian (ka)</option>
                      <option value="en-US">English</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-muted block mb-1 font-medium">Text-to-Speech</label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => setTtsProvider(e.target.value as TTSProvider)}
                    className="w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                  >
                    <option value="camb">Camb.ai</option>
                    <option value="openai">OpenAI</option>
                    <option value="browser">Browser</option>
                  </select>
                </div>

                {ttsProvider === "openai" && (
                  <div>
                    <label className="text-muted block mb-1 font-medium">Voice</label>
                    <select
                      value={openaiVoice}
                      onChange={(e) => setOpenaiVoice(e.target.value)}
                      className="w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                    >
                      <option value="alloy">Alloy</option>
                      <option value="echo">Echo</option>
                      <option value="fable">Fable</option>
                      <option value="nova">Nova</option>
                      <option value="onyx">Onyx</option>
                      <option value="shimmer">Shimmer</option>
                    </select>
                  </div>
                )}

              </div>

              <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-2 text-[10px] text-muted font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Pipeline: {sttProvider === "browser" ? `Browser (${speechLang})` : sttProvider === "whisper" ? "Whisper" : "Google STT"} &rarr; GPT-4o &rarr; {ttsProvider === "camb" ? "Camb.ai" : ttsProvider === "openai" ? "OpenAI TTS" : "Browser TTS"}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── Dev Banner ─────────────────────────────────────── */}
      <div className="bg-amber-500/5 border-b border-amber-500/10">
        <div className="max-w-2xl mx-auto px-4 py-1.5 flex items-center justify-center gap-2 text-[11px] text-amber-400/80 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Development Build &mdash; v0.1.0-alpha
        </div>
      </div>

      {/* ── Active Timers ──────────────────────────────────── */}
      <ActiveTimers />

      {/* ── Active Alarms ──────────────────────────────────── */}
      <ActiveAlarms />

      {/* ── Messages ───────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
              <div className="w-20 h-20 rounded-2xl bg-accent/5 border border-accent/10 flex items-center justify-center mb-6">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent/60">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-1">გამარჯობა!</h2>
              <p className="text-sm text-muted max-w-xs">
                მე ვარ Mia, შენი ქართულენოვანი ხმოვანი ასისტენტი. დააჭირე მიკროფონს ან დაწერე შეტყობინება.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                {["გამარჯობა, როგორ ხარ?", "რა ამინდია?", "მომიყევი რამე"].map((q) => (
                  <button
                    key={q}
                    onClick={() => handleUserMessage(q)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-accent/40 hover:bg-accent/5 text-muted hover:text-foreground transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
              <div className={`max-w-[85%] sm:max-w-[75%] ${msg.role === "user" ? "order-1" : ""}`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 ${
                    msg.role === "user"
                      ? "bg-accent text-white rounded-br-md"
                      : "bg-surface border border-border/50 rounded-bl-md"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
                <p className={`text-[10px] text-muted mt-1 ${msg.role === "user" ? "text-right" : ""} font-mono`}>
                  {msg.role === "user" ? "You" : "Mia"} &middot; {formatTime(msg.timestamp)}
                </p>
              </div>
            </div>
          ))}

          {/* Live transcript */}
          {currentTranscript && (
            <div className="flex justify-end mb-3">
              <div className="max-w-[85%] sm:max-w-[75%]">
                <div className="rounded-2xl rounded-br-md px-4 py-2.5 bg-accent/20 border border-accent/30">
                  <p className="text-sm text-foreground/70">{currentTranscript}</p>
                </div>
                <p className="text-[10px] text-accent mt-1 text-right font-mono animate-pulse">
                  {sttProvider === "browser" ? "listening..." : "transcribing..."}
                </p>
              </div>
            </div>
          )}

          {/* Thinking */}
          {isThinking && (
            <div className="flex justify-start mb-3">
              <div className="bg-surface border border-border/50 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1.5 items-center">
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div className="px-4 pb-2">
          <div className="max-w-2xl mx-auto bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center justify-between">
            <p className="text-xs text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 text-xs ml-2">
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Status Bar ─────────────────────────────────────── */}
      {statusText && (
        <div className="px-4">
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-2 py-1.5 text-xs text-muted">
            <span className={`w-2 h-2 rounded-full ${
              isListening ? "bg-red-400" : isSpeaking ? "bg-green-400" : "bg-accent"
            } animate-pulse`} />
            {statusText}
          </div>
        </div>
      )}

      {/* ── Input ──────────────────────────────────────────── */}
      <footer className="border-t border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <form onSubmit={handleTextSubmit} className="flex-1 flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="შეტყობინება..."
                className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent/50 transition-colors"
                disabled={isProcessing}
              />
              <button
                type="submit"
                disabled={!textInput.trim() || isProcessing}
                className="bg-surface border border-border hover:bg-surface-2 disabled:opacity-20 disabled:cursor-not-allowed rounded-xl px-4 py-2.5 text-sm transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>

            {/* Mic button */}
            <div className="relative">
              {isListening && (
                <span className="absolute inset-0 rounded-full bg-red-500/30 animate-pulse-ring" />
              )}
              <button
                onClick={() => {
                  if (isSpeaking) stopSpeaking();
                  else if (isListening) stopListening();
                  else startListening();
                }}
                disabled={isThinking}
                className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shrink-0
                  ${isListening
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/25"
                    : isSpeaking
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/25"
                      : "bg-surface border border-border hover:border-accent/40 hover:bg-surface-2 text-muted hover:text-foreground"
                  }
                  ${isThinking ? "opacity-20 cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                {isSpeaking ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="border-t border-border/30">
          <div className="max-w-2xl mx-auto px-4 py-1.5 flex items-center justify-between text-[10px] text-muted/50 font-mono">
            <span>mia v0.1.0-alpha</span>
            <span>GPT-4o-mini &middot; {ttsProvider} &middot; {sttProvider}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
