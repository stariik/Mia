"use client";

import { useEffect, useState } from "react";
import { useToolsStore } from "@/stores/toolsStore";
import { webPlatform } from "@/lib/tools/platform/web";

function formatRemaining(ms: number) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ActiveTimers() {
  const timers = useToolsStore((s) => s.timers);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timers.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timers.length]);

  if (timers.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-surface/30">
      <div className="max-w-2xl mx-auto px-4 py-2 flex flex-wrap gap-2">
        {timers.map((t) => {
          const remaining = t.endsAt - now;
          return (
            <div
              key={t.id}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-xs"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-accent"
              >
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2" />
                <path d="M9 2h6" />
              </svg>
              <span className="font-mono text-foreground">
                {formatRemaining(remaining)}
              </span>
              {t.label && (
                <span className="text-muted">· {t.label}</span>
              )}
              <button
                onClick={() => webPlatform.cancelTimer(t.id)}
                className="ml-1 text-muted hover:text-red-400 transition-colors"
                title="გაუქმება"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
