"use client";

import { useEffect, useState } from "react";
import { useToolsStore } from "@/stores/toolsStore";
import { webPlatform } from "@/lib/tools/platform/web";

function formatWallClock(ts: number) {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function relativeDay(ts: number): string {
  const target = new Date(ts);
  const today = new Date();
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (midnight(target) - midnight(today)) / 86_400_000
  );
  if (diffDays === 0) return "დღეს";
  if (diffDays === 1) return "ხვალ";
  if (diffDays === 2) return "ზეგ";
  return target.toLocaleDateString("ka-GE", {
    day: "numeric",
    month: "short",
  });
}

export function ActiveAlarms() {
  const alarms = useToolsStore((s) => s.alarms);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (alarms.length === 0) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [alarms.length]);

  if (alarms.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-surface/30">
      <div className="max-w-2xl mx-auto px-4 py-2 flex flex-wrap gap-2">
        {alarms.map((a) => (
          <div
            key={a.id}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-amber-400"
            >
              <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10 21a2 2 0 004 0" />
            </svg>
            <span className="font-mono text-foreground">
              {formatWallClock(a.ringsAt)}
            </span>
            <span className="text-muted">· {relativeDay(a.ringsAt)}</span>
            {a.label && <span className="text-muted">· {a.label}</span>}
            <button
              onClick={() => webPlatform.cancelAlarm(a.id)}
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
        ))}
      </div>
    </div>
  );
}
