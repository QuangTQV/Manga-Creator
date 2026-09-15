"use client";

/**
 * Print Export: DPI-accurate pixel dimensions plus a synthetic bleed
 * margin, for sending pages to a physical printer instead of a screen.
 *
 * Physical page width and target DPI are asked here, fresh, every export —
 * not stored on the project — because Kumanga's page size has no inherent
 * physical unit today; see `exportPrint.ts`'s docstring for the full
 * reasoning (and why bleed is a post-process approximation, not real
 * overhanging art).
 */

import { useState } from "react";
import { chaptersInOrder } from "@/domain/chapterOps";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { DPI_PRESETS, computePrintScale, exportBookPrintCbz, exportCurrentPagePrintPng } from "@/export/exportPrint";
import { CloseIcon, ICON_SIZE, ICON_STROKE, PrintIcon } from "../ui/icons";

export function PrintExportDialog() {
  const open = useUiStore((s) => s.printExportOpen);
  const close = useUiStore((s) => s.closePrintExport);
  const doc = useEditorStore((s) => s.doc);
  const currentPageId = useEditorStore((s) => s.currentPageId);

  const [physicalWidthInches, setPhysicalWidthInches] = useState(6.625);
  const [dpi, setDpi] = useState(300);
  const [bleedInches, setBleedInches] = useState(0.125);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open || !doc) return null;

  const { pageWidth, pageHeight } = doc.project.settings;
  const { chapters } = chaptersInOrder(doc);

  let preview: { widthPx: number; heightPx: number } | null = null;
  try {
    const scale = computePrintScale(pageWidth, physicalWidthInches, dpi);
    const bleedPx = Math.max(0, Math.round(bleedInches * dpi));
    preview = {
      widthPx: Math.round(pageWidth * scale) + bleedPx * 2,
      heightPx: Math.round(pageHeight * scale) + bleedPx * 2,
    };
  } catch {
    preview = null;
  }

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Print export failed");
    } finally {
      setBusy(null);
    }
  };

  const options = { physicalWidthInches, dpi, bleedInches };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[85vh] w-[480px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <PrintIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            Print Export
          </h2>
          <button
            aria-label="Close Print Export"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        {error && <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] text-red-400">{error}</p>}

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Page width (inches)
              <input
                aria-label="Page width (inches)"
                type="number"
                min={0.5}
                step={0.125}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[12px] text-zinc-200"
                value={physicalWidthInches}
                onChange={(e) => setPhysicalWidthInches(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Bleed (inches)
              <input
                aria-label="Bleed (inches)"
                type="number"
                min={0}
                step={0.0625}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[12px] text-zinc-200"
                value={bleedInches}
                onChange={(e) => setBleedInches(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="mt-3">
            <p className="mb-1 text-[11px] text-zinc-500">DPI</p>
            <div className="flex items-center gap-2">
              {DPI_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`rounded border px-2.5 py-1 text-[11px] ${
                    dpi === preset
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  onClick={() => setDpi(preset)}
                >
                  {preset}
                </button>
              ))}
              <input
                aria-label="Custom DPI"
                type="number"
                min={1}
                className="w-20 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[12px] text-zinc-200"
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
              />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-zinc-500">
            {preview
              ? `Output: ${preview.widthPx}×${preview.heightPx}px${bleedInches > 0 ? " (bleed included)" : ""}`
              : "Enter a page width and DPI greater than zero"}
          </p>

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <button
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              disabled={busy !== null || !currentPageId || !preview}
              onClick={() => void run("current-page", () => exportCurrentPagePrintPng(options))}
            >
              {busy === "current-page" ? "Exporting…" : "Export current page (PNG)"}
            </button>
            <button
              className="mt-2 w-full rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
              disabled={busy !== null || !preview}
              onClick={() => void run("book", () => exportBookPrintCbz(options))}
            >
              {busy === "book" ? "Exporting…" : "Export whole book (CBZ)"}
            </button>

            {chapters.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Or export one chapter</p>
                <div className="flex flex-col gap-1.5">
                  {chapters.map(({ chapter, pageIds }) => (
                    <button
                      key={chapter.id}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-left text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                      disabled={busy !== null || !preview}
                      onClick={() =>
                        void run(`chapter-${chapter.id}`, () =>
                          exportBookPrintCbz(options, undefined, { pageIds, label: chapter.name }),
                        )
                      }
                    >
                      {busy === `chapter-${chapter.id}` ? "Exporting…" : chapter.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
