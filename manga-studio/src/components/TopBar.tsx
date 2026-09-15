"use client";

/**
 * The Kumanga tool strip.
 *
 * One horizontal strip, read left to right: who and where (brand, project,
 * save state), history, what you can add, then the global settings and the
 * export. Groups are separated by a hairline rule rather than by giving every
 * control its own box — the strip should read as one tool, not as a shelf of
 * buttons.
 */

import { useRef, useState } from "react";
import { KumangaMark } from "./brand/KumangaMark";
import { Button, IconButton, ToolbarDivider } from "./ui/Button";
import { ChevronDown } from "lucide-react";
import {
  ExportIcon,
  GenerateIcon,
  HistoryIcon,
  ICON_SIZE,
  ICON_STROKE,
  MoreIcon,
  PlusIcon,
  RedoIcon,
  SettingsIcon,
  StyleIcon,
  UndoIcon,
} from "./ui/icons";
import { LAYOUT_PRESETS } from "@/domain/layouts";
import type { BubbleType, EffectKind, LayoutPresetId } from "@/domain/types";
import { useEditorStore } from "@/editor/store";
import { useUiStore, type GeneratorRequest } from "@/editor/uiStore";
import { exportCurrentPagePng } from "@/export/exportPage";
import { exportBookCbz } from "@/export/exportBook";
import { exportWebtoonStrip } from "@/export/exportWebtoon";
import { exportProjectArchive } from "@/export/exportProjectArchive";
import { exportFullBackup } from "@/export/projectBackup";
import { importPagesFromFiles } from "@/services/importPages";
import { getActiveStyleProfile } from "@/styles/profiles";

/** Quick picks for the Language field's native suggestion dropdown — not a
 * fixed list the model is restricted to, any typed name works (see the
 * field's own title/comment where it's used). */
const DIALOGUE_LANGUAGE_PRESETS = [
  "English",
  "Vietnamese",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
  "French",
  "Spanish",
  "German",
];

const BUBBLE_TYPES: { type: BubbleType; label: string }[] = [
  { type: "speech", label: "Speech bubble" },
  { type: "thought", label: "Thought bubble" },
  { type: "shout", label: "Shout bubble" },
  { type: "whisper", label: "Whisper bubble" },
  { type: "narration", label: "Narration box" },
];

/**
 * One place to start any generation (§P1.6).
 *
 * Generation used to begin in four unrelated places — a button per library
 * shelf — so "make a new thing" meant first knowing which shelf the thing
 * belongs on. The shelf buttons remain for people already browsing there; this
 * is the single entry point that does not require knowing the answer first.
 */
const GENERATE_TARGETS: { key: GeneratorRequest["assetType"]; label: string }[] = [
  { key: "character", label: "Character" },
  { key: "background", label: "Scene / background" },
  { key: "prop", label: "Object / prop" },
  { key: "manga-effect", label: "Manga effect" },
];

const EFFECT_KINDS: { kind: EffectKind; label: string }[] = [
  { kind: "speed-lines", label: "Speed lines" },
  { kind: "focus-lines", label: "Focus lines" },
  { kind: "impact-burst", label: "Impact burst" },
  { kind: "screentone", label: "Screentone" },
];

export function TopBar() {
  const advanced = useUiStore((s) => s.advancedMode);
  const setAdvancedMode = useUiStore((s) => s.setAdvancedMode);
  const doc = useEditorStore((s) => s.doc);
  const dirty = useEditorStore((s) => s.dirty);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const selection = useEditorStore((s) => s.selection);
  const openSettings = useUiStore((s) => s.openSettings);
  const openArtStyle = useUiStore((s) => s.openArtStyle);
  const openGenerator = useUiStore((s) => s.openGenerator);
  const openLiveAi = useUiStore((s) => s.openLiveAi);
  const openNovelImport = useUiStore((s) => s.openNovelImport);
  const openChapters = useUiStore((s) => s.openChapters);
  const openPageOverview = useUiStore((s) => s.openPageOverview);
  const openPrintExport = useUiStore((s) => s.openPrintExport);
  const openHistory = useUiStore((s) => s.openHistory);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [importingPages, setImportingPages] = useState(false);
  const [importPagesProgress, setImportPagesProgress] = useState<string | null>(null);
  const importPagesInputRef = useRef<HTMLInputElement>(null);

  if (!doc) return null;

  const page = currentPageId ? doc.pages[currentPageId] : null;
  const activeStyle = getActiveStyleProfile(doc);
  // Toolbar tools target the selected panel, falling back to the first panel.
  const targetPanelId = selection.panelId ?? page?.panelIds[0];

  const addBubbleToPanel = (type: BubbleType) => {
    if (!targetPanelId) return;
    const result = useEditorStore.getState().dispatch({ type: "add-bubble", panelId: targetPanelId, bubbleType: type, text: "..." });
    if (result.createdId) useEditorStore.getState().select({ itemId: result.createdId, panelId: targetPanelId });
  };

  const addEffectToPanel = (kind: EffectKind) => {
    if (!targetPanelId) return;
    useEditorStore.getState().dispatch({ type: "add-effect", panelId: targetPanelId, effectKind: kind });
  };

  const onExport = async (scale: 1 | 2) => {
    setExporting(true);
    try {
      await exportCurrentPagePng(scale);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onExportBook = async (scale: 1 | 2) => {
    setExporting(true);
    setExportProgress("Preparing…");
    try {
      await exportBookCbz(scale, ({ done, total }) => setExportProgress(`Page ${done}/${total}…`));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Book export failed");
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const onExportWebtoon = async (scale: 1 | 2) => {
    setExporting(true);
    setExportProgress("Preparing…");
    try {
      await exportWebtoonStrip(scale, ({ done, total }) => setExportProgress(`Page ${done}/${total}…`));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Webtoon export failed");
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const onExportArchive = () => {
    try {
      exportProjectArchive(doc);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Project archive export failed");
    }
  };

  const onExportFullBackup = async () => {
    setExporting(true);
    try {
      await exportFullBackup(doc);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Full backup export failed");
    } finally {
      setExporting(false);
    }
  };

  const onImportPages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImportingPages(true);
    setImportPagesProgress("Preparing…");
    try {
      await importPagesFromFiles(Array.from(files), ({ done, total }) => setImportPagesProgress(`Page ${done}/${total}…`));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Importing pages failed");
    } finally {
      setImportingPages(false);
      setImportPagesProgress(null);
    }
  };

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 text-sm"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)", scrollbarWidth: "thin" }}
    >
      {/* Brand: compact by design. This is a creator tool, not a landing page. */}
      <span className="flex items-center gap-2 pl-1 pr-2" title="Kumanga — AI Manga Studio">
        <KumangaMark size={20} decorative />
        <span className="font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Kumanga
        </span>
      </span>

      <span aria-hidden style={{ color: "var(--border-strong)" }}>
        /
      </span>
      <span className="min-w-[60px] truncate" style={{ color: "var(--text-secondary)" }}>
        {doc.project.name}
      </span>
      <span
        className="ml-1 shrink-0 text-[11px]"
        style={{ color: dirty ? "var(--warning)" : "var(--text-muted)" }}
      >
        {dirty ? "Saving…" : "Saved"}
      </span>

      <ToolbarDivider />

      <IconButton
        label="Undo"
        title="Undo (⌘Z)"
        disabled={!canUndo}
        onClick={() => useEditorStore.getState().undo()}
        icon={<UndoIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
      />
      <IconButton
        label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!canRedo}
        onClick={() => useEditorStore.getState().redo()}
        icon={<RedoIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
      />
      <IconButton
        label="History"
        title="Jump to any earlier or later point, not just one Undo at a time"
        disabled={!canUndo && !canRedo}
        onClick={openHistory}
        icon={<HistoryIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
      />

      <ToolbarDivider />

      <Dropdown
        label="Layout"
        items={Object.values(LAYOUT_PRESETS).map((preset) => ({ key: preset.id, label: preset.label }))}
        onPick={(key) => {
          if (page) useEditorStore.getState().dispatch({ type: "set-page-layout", pageId: page.id, layout: key as LayoutPresetId });
        }}
      />
      <Button
        variant="ghost"
        icon={<PlusIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        onClick={() => {
          if (!page) return;
          const result = useEditorStore.getState().dispatch({
            type: "add-custom-panel",
            pageId: page.id,
            rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
          });
          if (!result.createdId) return;
          // Drops straight into the same vertex-handle reshape mode a
          // double-click enters for any panel — drag the four corners into
          // place, same tool, nothing new to learn.
          useEditorStore.getState().select({ panelId: result.createdId });
          useUiStore.getState().setShapeEditPanel(result.createdId);
        }}
        title="Add a new panel on top of the page — drag its corners into place"
      >
        Panel
      </Button>
      <Dropdown
        label="Generate"
        accent
        icon={<GenerateIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        items={GENERATE_TARGETS.map((target) => ({ key: target.key, label: target.label }))}
        onPick={(key) => openGenerator({ assetType: key as GeneratorRequest["assetType"] })}
      />
      <Dropdown
        label="Bubble"
        items={BUBBLE_TYPES.map((b) => ({ key: b.type, label: b.label }))}
        onPick={(k) => addBubbleToPanel(k as BubbleType)}
      />
      {/* Quick access to the most-used built-ins only. The full catalogue —
          including uploads and generated effects — lives in the Manga FX shelf,
          because a dropdown cannot grow with a project. */}
      <Dropdown
        label="Effect"
        items={EFFECT_KINDS.map((e) => ({ key: e.kind, label: e.label }))}
        onPick={(k) => addEffectToPanel(k as EffectKind)}
      />
      {/* Everything reached often enough to want on screen, but not often
          enough to earn its own permanent slot — each one still shows its
          full name the moment this opens, so nothing here trades away
          being understandable just to save width. */}
      <input
        ref={importPagesInputRef}
        type="file"
        aria-label="Import pages"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void onImportPages(e.target.files);
          e.target.value = "";
        }}
      />
      <Dropdown
        label={importPagesProgress ?? (importingPages ? "Importing…" : "More")}
        icon={<MoreIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        items={[
          { key: "import-pages", label: "Import pages (existing manga images)" },
          { key: "novel-import", label: "Novel Import" },
          { key: "chapters", label: "Chapters" },
          { key: "overview", label: "Page Overview" },
          { key: "print", label: "Print Export" },
          { key: "live-ai", label: "Live AI" },
        ]}
        onPick={(key) => {
          if (key === "import-pages") importPagesInputRef.current?.click();
          else if (key === "novel-import") openNovelImport();
          else if (key === "chapters") openChapters();
          else if (key === "overview") openPageOverview();
          else if (key === "print") openPrintExport();
          else if (key === "live-ai") openLiveAi();
        }}
      />

      <div className="flex-1" />

      {/* What language the Agent WRITES new dialogue/narration/text in — never
          applies to text the creator gave verbatim (Rule 6, systemPrompt.ts).
          Free text, not a fixed list — the model understands any language
          name directly — but `list` attaches a native suggestion dropdown
          with common ones for a quick pick, no separate control needed.
          `key` forces a remount (and so a fresh defaultValue) when the
          stored value changes from elsewhere — undo, History, another
          project load — since this stays an uncontrolled input otherwise. */}
      <label
        className="mr-0.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px]"
        style={{ color: "var(--text-muted)" }}
        title="Language the Agent writes new dialogue/narration in. Leave blank to match your own prompt's language. Never translates dialogue you quoted exactly, or a pasted novel's own wording."
      >
        Language
        <input
          key={doc.project.settings.dialogueLanguage ?? ""}
          list="dialogue-language-options"
          className="w-24 rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] px-1.5 py-0.5 text-[11px] text-zinc-300"
          defaultValue={doc.project.settings.dialogueLanguage ?? ""}
          placeholder="Auto"
          onBlur={(event) => {
            const trimmed = event.target.value.trim();
            if (trimmed === (doc.project.settings.dialogueLanguage ?? "")) return;
            useEditorStore.getState().dispatch({ type: "set-dialogue-language", language: trimmed || null });
          }}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
        <datalist id="dialogue-language-options">
          {DIALOGUE_LANGUAGE_PRESETS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>

      {/* Advanced reveals rigging and raw camera numerics. Off by default: a
          creator directs the scene, the harness picks the implementation. */}
      <label
        className="mr-0.5 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] hover:bg-[var(--bg-hover)]"
        style={{ color: "var(--text-muted)" }}
        title="Show rigging and numeric camera controls"
      >
        <input
          type="checkbox"
          checked={advanced}
          onChange={(event) => setAdvancedMode(event.target.checked)}
        />
        Advanced
      </label>

      <Button
        variant="ghost"
        icon={<StyleIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        onClick={openArtStyle}
        title={`Project Art Style: ${activeStyle.name}`}
        className="max-w-[140px]"
      >
        <span className="truncate">{activeStyle.name}</span>
      </Button>

      <Button
        variant="ghost"
        icon={<SettingsIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        onClick={openSettings}
      >
        AI Settings
      </Button>

      <Dropdown
        label={exportProgress ?? (exporting ? "Exporting…" : "Export")}
        accent
        icon={<ExportIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        items={[
          { key: "page-1", label: "Export page @1x" },
          { key: "page-2", label: "Export page @2x" },
          { key: "book-1", label: `Export book (all pages) @1x — CBZ` },
          { key: "book-2", label: `Export book (all pages) @2x — CBZ` },
          { key: "webtoon-1", label: `Export webtoon strip @1x — PNG` },
          { key: "webtoon-2", label: `Export webtoon strip @2x — PNG` },
          { key: "archive", label: "Export project archive (.json)" },
          { key: "full-backup", label: "Export full backup (.zip) — includes images, portable" },
        ]}
        onPick={(k) => {
          if (k === "archive") return onExportArchive();
          if (k === "full-backup") return void onExportFullBackup();
          const scale = k.endsWith("-1") ? 1 : 2;
          if (k.startsWith("webtoon-")) onExportWebtoon(scale);
          else if (k.startsWith("book-")) onExportBook(scale);
          else onExport(scale);
        }}
      />
    </header>
  );
}

/**
 * A menu that looks like a button.
 *
 * A native `<select>` keeps keyboard and platform menu behaviour for free; the
 * visible control is styled to match the button hierarchy, and the chevron and
 * leading icon are drawn behind it. Reaching for a custom popover here would
 * cost accessibility for a cosmetic gain.
 */
function Dropdown({
  label,
  items,
  onPick,
  accent,
  icon,
}: {
  label: string;
  items: { key: string; label: string }[];
  onPick: (key: string) => void;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex h-8 shrink-0">
      {/*
        The visible control sizes the strip; the native select is stretched
        transparently over it. A bare styled <select> sizes itself to its widest
        OPTION, which spaced the toolbar out according to the length of
        "Two panels (side by side)" rather than the word "Layout".
      */}
      <span
        aria-hidden
        className={`pointer-events-none flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
          accent
            ? "bg-[var(--accent)] text-white group-hover:bg-[var(--accent-hover)]"
            : "text-[var(--text-secondary)] group-hover:bg-[var(--bg-hover)] group-hover:text-[var(--text-primary)]"
        }`}
      >
        {icon}
        {label}
        <ChevronDown size={13} strokeWidth={ICON_STROKE} className="opacity-60" />
      </span>
      <select
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
          e.target.value = "";
        }}
      >
        <option value="" disabled hidden>
          {label}
        </option>
        {items.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  );
}
