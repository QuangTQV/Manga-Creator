"use client";

/**
 * Transient UI state that isn't part of the document (dialog visibility,
 * generator prefill). Kept out of the editor store so undo never replays UI.
 */

import { create } from "zustand";
import type { ID, MangaLanguageCategory } from "@/domain/types";
import type { PoseCalibration, PoseRigState } from "@/characters/poseRig";
import type { PuppetJoint } from "@/puppet/model";

export interface GeneratorRequest {
  assetType: "character" | "character-pose" | "character-expression" | "background" | "prop" | "tone" | "manga-effect";
  characterId?: ID;
  /**
   * Manga Language Library category for a "manga-effect" generation. Accepting
   * it beside the result keeps the review flow honest: the preview knows which
   * shelf the asset will land on before the creator presses Add to Library.
   */
  languageCategory?: MangaLanguageCategory;
  /** Prefilled slot descriptor, e.g. { pose: "running" }. */
  prefill?: Record<string, string>;
  /**
   * When set, the accepted result also replaces this instance's source asset
   * ("Expression: Crying → not available → Generate" flows end by swapping
   * the selected instance).
   */
  targetInstanceId?: ID;
  /** Regeneration replaces every reference to the old source after acceptance. */
  replaceAssetId?: ID;
}

/**
 * A local puppet edit the creator asked for that the puppet cannot hold (§3).
 *
 * Surfaced as an explicit choice rather than silently distorting the artwork or
 * silently escalating to a paid generation: local-safe operations are instant,
 * and anything generative has to be chosen.
 */
export interface PuppetCapabilityPrompt {
  instanceId: ID;
  joint?: PuppetJoint;
  /** What the creator asked for, before the puppet refused it. */
  requestedDegrees?: number;
  reason: string;
  fallbackRecommendation?: string;
}

/** Live hover feedback while dragging an expression over the canvas (§1). */
export interface PuppetFaceHover {
  instanceId: ID;
  expressionId: string;
}

interface UiState {
  generator: GeneratorRequest | null;
  /**
   * The Manga Agent's prompt draft. Lifted out of AgentPanel's own state so
   * other UI (the toolbar's "Auto" layout option) can read what was typed
   * without needing a run — it never touches the document or the Agent.
   */
  agentPrompt: string;
  /** Tone layer whose mask is open for editing, if any. */
  toneMaskItemId: ID | null;
  /** Panel currently in shape-edit mode (double-click a panel to enter). */
  shapeEditPanelId: ID | null;
  /**
   * Character instance currently in pose-edit mode, plus the draft rig.
   * The draft is editor state on purpose: dragging joints must not create undo
   * entries or touch the document until Apply (§5/§13).
   */
  poseEditInstanceId: ID | null;
  poseDraft: PoseRigState | null;
  /** Calibration mode reuses the same overlay but drags baseline anchors (§3). */
  calibrating: boolean;
  calibrationDraft: PoseCalibration | null;
  /** Panel whose perspective handles are draggable (§4 "Edit Guides"). */
  guideEditPanelId: ID | null;
  /**
   * Puppet direct manipulation. All three are editor-only: dragging a joint
   * writes to the document through transient dispatch, but the hover highlight
   * and the capability prompt never do.
   */
  puppetFaceHover: PuppetFaceHover | null;
  puppetCapabilityPrompt: PuppetCapabilityPrompt | null;
  /** Instance whose joint handles are shown; null hides them. */
  puppetHandlesInstanceId: ID | null;
  /** Compiler wizard target character, or null when closed. */
  compilerCharacterId: ID | null;
  /** Interaction awaiting coordinated generation and review, or null. */
  interactionRequest: { interactionId: ID } | null;
  /**
   * Asset open in the detail editor. `instanceId` is present when it was opened
   * from a placed instance, which is what enables "use only in this panel".
   */
  assetEditor: { assetId: ID; instanceId?: ID } | null;
  /** AI Settings can be opened from anywhere ("Connect model" prompts). */
  settingsOpen: boolean;
  artStyleOpen: boolean;
  /** Live AI panel: what was actually sent to the connected AI provider(s)
   * and how they responded, for the current browser session. */
  liveAiOpen: boolean;
  /** Novel Import: paste prose, get a planned-page walkthrough. */
  novelImportOpen: boolean;
  /** History: jump directly to any earlier (or later) point, not just one Undo at a time. */
  historyOpen: boolean;
  /** Chapters: organize pages into named, orderable sections; export any one on its own. */
  chaptersOpen: boolean;
  /** Page Overview: every page in the book at once, as real thumbnails. */
  pageOverviewOpen: boolean;
  /** Print Export: DPI + physical page width + bleed, for sending pages to a physical printer. */
  printExportOpen: boolean;
  /** Translate Project: send an already-lettered project's dialogue to
   * another language, as a new, separate project. */
  translateProjectOpen: boolean;
  /** Model Sheet: every generation of one character's states at once, for
   * checking design consistency — not the library shelf's "just the
   * latest render" view. Holds the character being viewed, or null. */
  modelSheetCharacterId: ID | null;
  /**
   * Advanced / Developer surface.
   *
   * Rigging is an implementation capability, not a creator workflow: nobody
   * should have to segment body parts or confirm sixteen rectangles to move an
   * arm. The puppet machinery stays — it is what makes local edits free — but
   * the controls that expose it live behind this flag.
   */
  advancedMode: boolean;
  openGenerator(request: GeneratorRequest): void;
  closeGenerator(): void;
  openToneMask(itemId: ID): void;
  closeToneMask(): void;
  setShapeEditPanel(panelId: ID | null): void;
  beginPoseEdit(instanceId: ID, rig: PoseRigState): void;
  setPoseDraft(rig: PoseRigState): void;
  endPoseEdit(): void;
  setGuideEditPanel(panelId: ID | null): void;
  beginCalibration(instanceId: ID, calibration: PoseCalibration): void;
  setCalibrationDraft(calibration: PoseCalibration): void;
  endCalibration(): void;
  setPuppetFaceHover(hover: PuppetFaceHover | null): void;
  showPuppetCapabilityPrompt(prompt: PuppetCapabilityPrompt | null): void;
  setPuppetHandlesInstance(instanceId: ID | null): void;
  openCompiler(characterId: ID): void;
  closeCompiler(): void;
  openInteraction(request: { interactionId: ID }): void;
  closeInteraction(): void;
  openAssetEditor(request: { assetId: ID; instanceId?: ID }): void;
  closeAssetEditor(): void;
  openSettings(): void;
  closeSettings(): void;
  openArtStyle(): void;
  closeArtStyle(): void;
  setAdvancedMode(enabled: boolean): void;
  openLiveAi(): void;
  closeLiveAi(): void;
  openNovelImport(): void;
  closeNovelImport(): void;
  openHistory(): void;
  closeHistory(): void;
  openChapters(): void;
  closeChapters(): void;
  openPageOverview(): void;
  closePageOverview(): void;
  openPrintExport(): void;
  closePrintExport(): void;
  openTranslateProject(): void;
  closeTranslateProject(): void;
  openModelSheet(characterId: ID): void;
  closeModelSheet(): void;
  setAgentPrompt(prompt: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  generator: null,
  agentPrompt: "",
  toneMaskItemId: null,
  shapeEditPanelId: null,
  poseEditInstanceId: null,
  poseDraft: null,
  calibrating: false,
  calibrationDraft: null,
  guideEditPanelId: null,
  puppetFaceHover: null,
  puppetCapabilityPrompt: null,
  puppetHandlesInstanceId: null,
  compilerCharacterId: null,
  interactionRequest: null,
  assetEditor: null,
  settingsOpen: false,
  artStyleOpen: false,
  liveAiOpen: false,
  novelImportOpen: false,
  historyOpen: false,
  chaptersOpen: false,
  pageOverviewOpen: false,
  printExportOpen: false,
  translateProjectOpen: false,
  modelSheetCharacterId: null,
  advancedMode: false,
  openGenerator: (request) => set({ generator: request }),
  closeGenerator: () => set({ generator: null }),
  openToneMask: (itemId) => set({ toneMaskItemId: itemId }),
  closeToneMask: () => set({ toneMaskItemId: null }),
  setShapeEditPanel: (panelId) => set({ shapeEditPanelId: panelId }),
  beginPoseEdit: (instanceId, rig) => set({ poseEditInstanceId: instanceId, poseDraft: rig }),
  setPoseDraft: (rig) => set({ poseDraft: rig }),
  endPoseEdit: () => set({ poseEditInstanceId: null, poseDraft: null, calibrating: false, calibrationDraft: null }),
  setGuideEditPanel: (panelId) => set({ guideEditPanelId: panelId }),
  beginCalibration: (instanceId, calibration) =>
    set({ poseEditInstanceId: instanceId, calibrating: true, calibrationDraft: calibration, poseDraft: null }),
  setCalibrationDraft: (calibration) => set({ calibrationDraft: calibration }),
  endCalibration: () => set({ calibrating: false, calibrationDraft: null, poseEditInstanceId: null }),
  setPuppetFaceHover: (hover) => set({ puppetFaceHover: hover }),
  showPuppetCapabilityPrompt: (prompt) => set({ puppetCapabilityPrompt: prompt }),
  setPuppetHandlesInstance: (instanceId) => set({ puppetHandlesInstanceId: instanceId }),
  openCompiler: (characterId) => set({ compilerCharacterId: characterId }),
  closeCompiler: () => set({ compilerCharacterId: null }),
  openInteraction: (request) => set({ interactionRequest: request }),
  closeInteraction: () => set({ interactionRequest: null }),
  openAssetEditor: (request) => set({ assetEditor: request }),
  closeAssetEditor: () => set({ assetEditor: null }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setAdvancedMode: (enabled) => set({ advancedMode: enabled }),
  openArtStyle: () => set({ artStyleOpen: true }),
  closeArtStyle: () => set({ artStyleOpen: false }),
  openLiveAi: () => set({ liveAiOpen: true }),
  closeLiveAi: () => set({ liveAiOpen: false }),
  openNovelImport: () => set({ novelImportOpen: true }),
  closeNovelImport: () => set({ novelImportOpen: false }),
  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
  openChapters: () => set({ chaptersOpen: true }),
  closeChapters: () => set({ chaptersOpen: false }),
  openPageOverview: () => set({ pageOverviewOpen: true }),
  closePageOverview: () => set({ pageOverviewOpen: false }),
  openPrintExport: () => set({ printExportOpen: true }),
  closePrintExport: () => set({ printExportOpen: false }),
  openTranslateProject: () => set({ translateProjectOpen: true }),
  closeTranslateProject: () => set({ translateProjectOpen: false }),
  openModelSheet: (characterId) => set({ modelSheetCharacterId: characterId }),
  closeModelSheet: () => set({ modelSheetCharacterId: null }),
  setAgentPrompt: (prompt) => set({ agentPrompt: prompt }),
}));
