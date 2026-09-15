"use client";

/**
 * History: every edit and agent run since the project was opened, not just
 * "one Undo away". `useEditorStore`'s `past`/`future` already hold the full
 * chronological span (bounded, see `HISTORY_LIMIT` in `editor/store.ts`) —
 * this dialog is purely a labeled view over it plus `jumpTo`, which moves
 * directly to any entry in one step instead of clicking Undo/Redo
 * repeatedly.
 */

import { historyTimeline, useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { CloseIcon, HistoryIcon, ICON_SIZE, ICON_STROKE } from "../ui/icons";

export function HistoryDialog() {
  const open = useUiStore((s) => s.historyOpen);
  const close = useUiStore((s) => s.closeHistory);
  const doc = useEditorStore((s) => s.doc);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const currentLabel = useEditorStore((s) => s.currentLabel);
  const currentAt = useEditorStore((s) => s.currentAt);

  if (!open || !doc) return null;

  const { entries, currentIndex } = historyTimeline({ doc, past, future, currentLabel, currentAt });
  // Most recent first — the position someone opening this dialog cares about.
  const rows = entries.map((entry, index) => ({ entry, index })).reverse();

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[80vh] w-[480px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <HistoryIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            History
          </h2>
          <button
            aria-label="Close History"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>
        <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] leading-4 text-zinc-500">
          Every edit and agent run, most recent first. Jump straight to any point — everything after it stays
          available to jump back to until you make a new change from there.
        </p>
        <ul className="flex-1 overflow-y-auto p-2" aria-label="History entries">
          {rows.map(({ entry, index }) => {
            const isCurrent = index === currentIndex;
            return (
              <li key={index}>
                <button
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs ${
                    isCurrent
                      ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                      : "text-zinc-300 hover:bg-[var(--bg-hover)]"
                  }`}
                  disabled={isCurrent}
                  onClick={() => {
                    useEditorStore.getState().jumpTo(index);
                    close();
                  }}
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">
                    {isCurrent ? "Current" : new Date(entry.at).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
