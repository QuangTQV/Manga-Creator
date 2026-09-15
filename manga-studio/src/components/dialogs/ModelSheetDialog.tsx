"use client";

/**
 * Model Sheet: every generation of a character's canonical reference and
 * rendered states at once — not the library shelf's "just the latest
 * render per state" view (`CharactersTab.tsx`'s "Rendered states" grid).
 * The point is comparison: does "Standing · Smile" generation #3 still
 * look like the same character as generation #1 and the canonical
 * reference, or did the model drift off-design? A human judges that by
 * eye here; see `exportModelSheet.ts`'s docstring for why automatic
 * drift detection is a separate, bigger feature this deliberately
 * doesn't attempt.
 */

import { useState } from "react";
import { assetPreviewUrl } from "@/assets/renderSource";
import { exportCharacterModelSheetPng, modelSheetRows } from "@/export/exportModelSheet";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { CloseIcon, ExportIcon, ICON_SIZE, ICON_STROKE, ZoomIcon } from "../ui/icons";

export function ModelSheetDialog() {
  const characterId = useUiStore((s) => s.modelSheetCharacterId);
  const close = useUiStore((s) => s.closeModelSheet);
  const doc = useEditorStore((s) => s.doc);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  if (!characterId || !doc) return null;
  const character = doc.characters[characterId];
  if (!character) return null;

  const rows = modelSheetRows(doc, character);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await exportCharacterModelSheetPng(characterId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Model sheet export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="mx-auto flex max-h-[88vh] w-[min(92vw,1000px)] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="font-semibold text-zinc-100">Model Sheet — {character.name}</h2>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              disabled={exporting || rows.length === 0}
              onClick={() => void onExport()}
            >
              <ExportIcon size={13} strokeWidth={ICON_STROKE} />
              {exporting ? "Exporting…" : "Export as PNG"}
            </button>
            <button
              aria-label="Close Model Sheet"
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={close}
            >
              <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        </div>

        {error && <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] text-red-400">{error}</p>}

        <div className="flex-1 overflow-y-auto p-4">
          {rows.length === 0 && (
            <p className="py-16 text-center text-xs text-zinc-600">
              No reference or rendered states yet — generate some first.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.label} className="mb-5">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{row.label}</p>
              <div className="flex flex-wrap gap-3">
                {row.assets.map((asset, i) => {
                  const url = assetPreviewUrl(asset);
                  return (
                    <button
                      key={asset.id}
                      className="group relative h-[140px] w-[140px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 hover:border-[var(--accent)]"
                      title={`${asset.name} — click to zoom`}
                      onClick={() => url && setZoomUrl(url)}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`${row.label} — ${asset.name}`} className="h-full w-full object-contain" />
                      ) : (
                        <span className="grid h-full place-items-center text-[10px] text-zinc-600">No preview</span>
                      )}
                      {row.assets.length > 1 && (
                        <span className="absolute bottom-1 right-1.5 rounded bg-black/60 px-1 text-[9px] text-zinc-300">v{i + 1}</span>
                      )}
                      <span className="absolute inset-0 hidden items-center justify-center bg-black/30 group-hover:flex">
                        <ZoomIcon size={18} strokeWidth={ICON_STROKE} className="text-white" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {zoomUrl && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-8"
          onMouseDown={(e) => {
            e.stopPropagation();
            setZoomUrl(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomUrl} alt="Zoomed asset" className="max-h-full max-w-full rounded shadow-2xl" />
        </div>
      )}
    </div>
  );
}
