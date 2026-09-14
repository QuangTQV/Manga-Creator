"use client";

/**
 * Live AI: what was actually sent to the connected provider(s) and how they
 * responded, for this browser only (see `src/server/callLog.ts` and
 * `src/server/sessionTag.ts` — one visitor's entries are never visible to
 * another's, even on a shared deployment).
 *
 * Polled, not pushed: a long-lived stream would get cut off mid-generation
 * by a serverless platform's function-duration limit, so a short poll while
 * this panel is open behaves identically in `npm run dev` and on Vercel.
 */

import { useEffect, useRef, useState } from "react";
import { useUiStore } from "@/editor/uiStore";
import { CloseIcon, GenerateIcon, ICON_SIZE, ICON_STROKE, LiveIcon } from "../ui/icons";

const POLL_INTERVAL_MS = 1500;

interface LiveCallLogEntry {
  id: string;
  kind: "image" | "agent";
  route: string;
  provider?: string;
  model?: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: { message: string; status?: number };
}

interface ProviderUsageStats {
  kind: "image" | "agent";
  route: string;
  provider?: string;
  model?: string;
  calls: number;
  ok: number;
  failed: number;
  totalDurationMs: number;
}

interface UsageStats {
  since: number;
  totalCalls: number;
  totalOk: number;
  totalFailed: number;
  totalDurationMs: number;
  byKey: Record<string, ProviderUsageStats>;
}

export function LiveAiPanel() {
  const open = useUiStore((s) => s.liveAiOpen);
  const close = useUiStore((s) => s.closeLiveAi);
  const [entries, setEntries] = useState<LiveCallLogEntry[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seenCount = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [logResponse, usageResponse] = await Promise.all([
          fetch("/api/live/log"),
          fetch("/api/live/usage"),
        ]);
        if (cancelled) return;
        if (logResponse.ok) {
          const body = (await logResponse.json()) as { entries: LiveCallLogEntry[] };
          if (!cancelled) setEntries(body.entries);
        }
        if (usageResponse.ok) {
          const body = (await usageResponse.json()) as UsageStats;
          if (!cancelled) setUsage(body);
        }
      } catch {
        // Transient — the next poll tries again; nothing to show the user for one miss.
      }
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  // New entries default to expanded once (so the response of a call you're
  // waiting on is visible without an extra click); older ones stay collapsed.
  useEffect(() => {
    if (entries.length > seenCount.current) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const entry of entries.slice(seenCount.current)) next.add(entry.id);
        return next;
      });
    }
    seenCount.current = entries.length;
  }, [entries]);

  if (!open) return null;

  const clear = async () => {
    await fetch("/api/live/clear", { method: "POST" });
    setEntries([]);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[92vh] w-[640px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <div className="flex items-center gap-2">
            <LiveIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            <h2 className="font-semibold text-zinc-100">Live AI</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
              onClick={clear}
              disabled={entries.length === 0}
            >
              Clear
            </button>
            <button
              aria-label="Close Live AI"
              title="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={close}
            >
              <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        </div>
        <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] leading-4 text-zinc-500">
          Every request sent to your connected AI provider(s) and their response, for this browser only. Updates
          about every {Math.round(POLL_INTERVAL_MS / 1000)}s while a generation is running.
        </p>

        {usage && usage.totalCalls > 0 && (
          <div className="border-b border-[var(--border-subtle)] px-4 py-2">
            <button
              className="flex w-full items-center justify-between text-left text-[11px] text-zinc-400"
              onClick={() => setShowUsage((v) => !v)}
            >
              <span>
                {usage.totalCalls} call(s) since server start — {usage.totalOk} ok, {usage.totalFailed} failed
              </span>
              <span className="text-zinc-600">{showUsage ? "Hide breakdown" : "Show breakdown"}</span>
            </button>
            {showUsage && (
              <div className="mt-2 flex flex-col gap-1">
                {Object.entries(usage.byKey).map(([key, stat]) => (
                  <div key={key} className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span className="truncate">
                      {stat.route}
                      {stat.provider ? ` · ${stat.provider}` : ""}
                      {stat.model ? ` · ${stat.model}` : ""}
                    </span>
                    <span className="shrink-0 pl-2">
                      {stat.calls} call(s) · {stat.failed > 0 ? `${stat.failed} failed · ` : ""}
                      avg {Math.round(stat.totalDurationMs / stat.calls)}ms
                    </span>
                  </div>
                ))}
                <p className="mt-1 text-[10px] text-zinc-600">
                  Call counts and durations only — BYOK means this app never sees a bill, so there is no dollar
                  figure to show. Resets when the server restarts.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-zinc-500">
              <GenerateIcon size={20} strokeWidth={ICON_STROKE} />
              <p className="text-xs">
                No AI calls yet. Generate an asset or ask the Manga Agent something — the request and response
                will appear here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {[...entries].reverse().map((entry) => (
                <LiveCallCard
                  key={entry.id}
                  entry={entry}
                  expanded={expanded.has(entry.id)}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveCallCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: LiveCallLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(entry.startedAt).toLocaleTimeString();
  return (
    <div className="rounded-md border border-zinc-800">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
        onClick={onToggle}
      >
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: entry.ok ? "var(--success)" : "var(--danger, #f87171)" }}
        />
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {entry.kind}
        </span>
        <span className="truncate text-xs text-zinc-300">
          {entry.route}
          {entry.model ? ` · ${entry.model}` : ""}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
          {time} · {entry.durationMs}ms
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-zinc-800 p-2.5">
          <LiveField label="Sent">
            <LiveJson value={entry.request} />
          </LiveField>
          {entry.response && (
            <LiveField label="Received">
              <LiveJson value={entry.response} />
            </LiveField>
          )}
          {entry.error && (
            <LiveField label="Error">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-app)] p-2 font-mono text-[11px] leading-4 text-red-400">
                {entry.error.message}
                {entry.error.status ? ` (HTTP ${entry.error.status})` : ""}
              </pre>
            </LiveField>
          )}
        </div>
      )}
    </div>
  );
}

function LiveField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function LiveJson({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== "");
  return (
    <dl className="space-y-1.5">
      {entries.map(([key, v]) => (
        <div key={key}>
          <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{key}</dt>
          <dd>
            {typeof v === "string" && v.length > 80 ? (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-app)] p-2 font-mono text-[11px] leading-4 text-zinc-300">
                {v}
              </pre>
            ) : (
              <span className="font-mono text-[11px] text-zinc-300">{String(v)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
