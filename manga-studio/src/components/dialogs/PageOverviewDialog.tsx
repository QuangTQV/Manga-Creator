"use client";

/**
 * Page Overview: every page in the book at once, as real rendered
 * thumbnails — not the 44px strip in `PagesBar.tsx`, which is for
 * quick navigation, not reviewing pacing across a whole chapter. Click a
 * thumbnail to jump straight to that page.
 *
 * Reuses `captureAllPages` (the same walk-every-page capture the CBZ and
 * webtoon exporters use) rather than a second rendering path — a
 * thumbnail is genuinely what that page looks like, generated fresh each
 * time this dialog opens.
 */

import { useEffect, useState } from "react";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { captureAllPages } from "@/export/exportPages";
import { CloseIcon, ICON_SIZE, ICON_STROKE, OverviewIcon, SpinnerIcon } from "../ui/icons";

interface PageThumbnail {
  pageId: string;
  name: string;
  dataUrl: string;
}

export function PageOverviewDialog() {
  const open = useUiStore((s) => s.pageOverviewOpen);
  const close = useUiStore((s) => s.closePageOverview);
  const doc = useEditorStore((s) => s.doc);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const [thumbnails, setThumbnails] = useState<PageThumbnail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setThumbnails(null);
    setError(null);

    const openDoc = useEditorStore.getState().doc;
    if (!openDoc) return;
    const pages = Object.values(openDoc.pages).sort((a, b) => a.index - b.index);
    const pageIds = pages.map((p) => p.id);

    captureAllPages(1, undefined, pageIds)
      .then((dataUrls) => {
        if (cancelled) return;
        setThumbnails(pages.map((p, i) => ({ pageId: p.id, name: p.name, dataUrl: dataUrls[i] })));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not generate page thumbnails");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || !doc) return null;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="mx-auto flex max-h-[88vh] w-[min(92vw,1100px)] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <OverviewIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            Page Overview
          </h2>
          <button
            aria-label="Close Page Overview"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 text-[11px] text-red-400">{error}</p>}

          {!thumbnails && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
              <SpinnerIcon size={16} strokeWidth={ICON_STROKE} className="animate-spin" />
              Rendering thumbnails…
            </div>
          )}

          {thumbnails && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {thumbnails.map((t, i) => (
                <button
                  key={t.pageId}
                  className={`overflow-hidden rounded-md border text-left transition-colors ${
                    t.pageId === currentPageId
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                  onClick={() => {
                    useEditorStore.getState().setCurrentPage(t.pageId);
                    close();
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a captured data URL, not a Next-optimizable remote asset */}
                  <img src={t.dataUrl} alt={t.name} className="w-full bg-white" />
                  <span className="block truncate px-2 py-1 text-[10px] text-zinc-400">
                    {i + 1}. {t.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
