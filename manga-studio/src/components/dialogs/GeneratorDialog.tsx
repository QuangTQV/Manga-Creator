"use client";

/**
 * AI Asset Generator: semantic inputs (character/pose/expression/scene) →
 * real generation via the server API → result lands in the library only when
 * the creator accepts it. Generation never touches the canvas directly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateImage,
  GenerationApiError,
  recordFailedGeneration,
  registerGeneratedAsset,
  fetchProviderStatus,
  type GenerateApiResult,
} from "@/services/generation";
import { registerMangaEffectAsset } from "@/services/language";
import { generateTone, registerTone } from "@/services/tones";
import { buildAssetPrompt, defaultAspect } from "@/ai/promptTemplates";
import { summarizeCandidateOutcomes } from "@/ai/candidateBatch";
import { DEFAULT_CHARACTER_STATE, characterIdentityDescription, characterReferenceId } from "@/characters/state";
import { referenceOptions } from "@/characters/stateResolver";
import type { CharacterState } from "@/domain/types";
import { getStyleGenerationContext, isMonochromeStyle, styleMetadata } from "@/styles/generation";
import type { AssetCategory, MangaLanguageCategory } from "@/domain/types";
import {
  BACKGROUND_REMOVAL_FAILED_MESSAGE,
  validateCharacterTransparency,
} from "@/assets/characterAssetContract";
import { useEditorStore } from "@/editor/store";
import { useUiStore, type GeneratorRequest } from "@/editor/uiStore";
import { assetPreviewUrl, assetRenderUrl } from "@/assets/renderSource";
import { uploadImageFile } from "@/components/library/uploadAsset";
import { CATEGORY_LABELS, LANGUAGE_CATEGORIES } from "@/language/library";

interface ProviderInfo {
  configured: boolean;
  capabilities?: { referenceImage?: boolean; supportsTransparentBackground?: boolean; supportsControlImage?: boolean };
  storage?: { configured?: boolean; backend?: string };
}

const TYPE_LABEL: Record<GeneratorRequest["assetType"], string> = {
  character: "Character reference",
  "character-pose": "Character pose",
  "character-expression": "Character expression",
  background: "Background",
  prop: "Prop",
  "manga-effect": "Manga effect",
  tone: "Tone",
};

/** What kind of screentone is being asked for (§9). */
const TONE_TYPES: { id: "texture" | "atmosphere" | "decorative" | "pattern"; label: string; hint: string }[] = [
  { id: "texture", label: "Texture", hint: "Rain, grain, fabric, rough ink" },
  { id: "atmosphere", label: "Atmosphere", hint: "Gloom, dread, warmth, memory" },
  { id: "decorative", label: "Decorative", hint: "Flowers, sparkles, romance" },
  { id: "pattern", label: "Pattern", hint: "A motif that repeats without a seam" },
];

/** Generate up to this many independent candidates per click, so a creator
 * can compare a few takes instead of regenerating one at a time and losing
 * the previous attempt. Each candidate is its own full provider call — this
 * is a real, separate cost under BYOK, which is why it defaults to 1
 * (today's exact behavior) and is capped rather than open-ended. */
const CANDIDATE_COUNTS = [1, 2, 3, 4] as const;


export function GeneratorDialog() {
  const request = useUiStore((s) => s.generator);
  const close = useUiStore((s) => s.closeGenerator);
  if (!request) return null;
  return <GeneratorDialogInner key={`${request.assetType}-${request.characterId ?? ""}`} request={request} onClose={close} />;
}

function GeneratorDialogInner({ request, onClose }: { request: GeneratorRequest; onClose: () => void }) {
  const doc = useEditorStore((s) => s.doc);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [description, setDescription] = useState(request.prefill?.description ?? "");
  const [toneType, setToneType] = useState<"texture" | "atmosphere" | "decorative" | "pattern">("texture");
  // Most useful tones repeat; a one-off decorative overlay is the exception.
  const [tileable, setTileable] = useState(true);
  const [pose, setPose] = useState(request.prefill?.pose ?? "");
  const [expression, setExpression] = useState(request.prefill?.expression ?? "");
  const [phase, setPhase] = useState<"idle" | "generating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<GenerationApiError | null>(null);
  const [results, setResults] = useState<GenerateApiResult[]>([]);
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());
  const [partialFailureNote, setPartialFailureNote] = useState<string | null>(null);
  /** How many candidates the IN-FLIGHT or LAST-COMPLETED request actually
   * asked for — kept separate from `results.length` so a request that asked
   * for 3 and only got 1 back (partial provider failures) still renders as
   * the multi-candidate picker, not the single-result fast path. */
  const [requestedCount, setRequestedCount] = useState(1);
  const [candidateCount, setCandidateCount] = useState(1);
  /** Empty = Auto (resolver's pick). Otherwise an explicit reference asset id. */
  const [referenceChoice, setReferenceChoice] = useState<string>("");
  /**
   * Scene and Object generation accept a reference too — an uploaded photo or
   * an asset already in the library. Previously only characters could send one,
   * so "generate a lamp like this one" had nowhere to put the lamp.
   */
  const [sceneReferenceId, setSceneReferenceId] = useState<string>("");
  const [referenceUse, setReferenceUse] = useState<"layout" | "style" | "loose">("style");
  /** A structural/pose control image (ComfyUI ControlNet) — purpose-distinct
   * from the identity/scene reference above; the user supplies it already
   * pre-processed (e.g. an OpenPose skeleton render). */
  const [controlImageId, setControlImageId] = useState<string>("");

  useEffect(() => {
    fetchProviderStatus()
      .then(setProvider)
      .catch(() => setProvider({ configured: false }));
  }, []);

  const character = request.characterId && doc ? doc.characters[request.characterId] : undefined;
  const referenceId = character ? characterReferenceId(character) : undefined;
  const referenceAsset = referenceId && doc ? doc.assets[referenceId] : undefined;
  const style = doc ? getStyleGenerationContext(doc) : undefined;
  const isCharacterType = request.assetType.startsWith("character");
  const isLanguageType = request.assetType === "manga-effect";
  const isToneType = request.assetType === "tone";
  const languageCategory: MangaLanguageCategory = request.languageCategory ?? "decorations";
  const canUseReference = Boolean(provider?.capabilities?.referenceImage && referenceAsset);
  /**
   * A brand-new character (no canonical reference yet) can optionally start
   * from a base/inspiration image — often another series' character, a
   * photo, or concept art — instead of text alone. This is deliberately
   * NOT the same control as `references` below: that one picks among an
   * EXISTING character's own past renders to keep identity consistent
   * across MORE generations of the SAME design; this one supplies external
   * material for the FIRST generation, which then becomes that identity.
   * Reuses the exact `ReferencePicker` + intent wording already built for
   * Scene/Object/Tone, so "use this as loose inspiration, don't copy it
   * directly" reads the same way everywhere in this dialog.
   */
  const showBaseImagePicker = request.assetType === "character" && !referenceAsset;

  const prompt = useMemo(
    () =>
      buildAssetPrompt({
        assetType: request.assetType,
        description: [description || undefined, referenceIntent(Boolean(sceneReferenceId), referenceUse)]
          .filter(Boolean)
          .join(" ") || undefined,
        characterName: character?.name,
        characterDescription: character ? characterIdentityDescription(character) : undefined,
        pose: pose || undefined,
        expression: expression || undefined,
        hasReference: canUseReference,
        style: style?.profile,
        supportsNativeTransparency: Boolean(provider?.capabilities?.supportsTransparentBackground),
        monochrome: isMonochromeStyle(style?.profile),
        languageCategory,
        toneType,
        tileable,
      }),
    [
      request.assetType,
      languageCategory,
      toneType,
      tileable,
      description,
      sceneReferenceId,
      referenceUse,
      character,
      pose,
      expression,
      canUseReference,
      style?.profile,
      provider?.capabilities?.supportsTransparentBackground,
    ],
  );

  // Whether a given candidate may become a library asset at all. Backgrounds
  // always pass; characters and props must carry a validated transparent
  // derivative. Tones are validated AS tones: texture/pattern tones are
  // legitimately opaque fields — pretending a tone is a prop here would
  // reject valid ones. Pulled out as a function (rather than one `contract`
  // computed from a single `result`) because a multi-candidate batch needs
  // this check per candidate, independently — one candidate's cutout failing
  // must not hide the others that succeeded.
  const contractFor = (candidate: GenerateApiResult | undefined) =>
    validateCharacterTransparency({
      category: isCharacterType ? "character" : isLanguageType ? "prop" : (request.assetType as AssetCategory),
      processingStatus: candidate?.processingStatus,
      hasAlpha: candidate?.hasAlpha,
      processedImageUrl: candidate?.processedImageUrl,
    });

  /**
   * Reference options for the state being generated (§3). Built from the state
   * graph, so "Auto" names the exact render the resolver would anchor on.
   */
  const desiredState: CharacterState | undefined =
    character && isCharacterType
      ? {
          characterId: character.id,
          pose: pose || DEFAULT_CHARACTER_STATE.pose,
          expression: expression || DEFAULT_CHARACTER_STATE.expression,
          outfit: DEFAULT_CHARACTER_STATE.outfit,
          view: DEFAULT_CHARACTER_STATE.view,
        }
      : undefined;
  const references = doc && desiredState ? referenceOptions(doc, desiredState) : [];
  const activeReference = references.find((option) => (option.assetId ?? "") === referenceChoice) ?? references[0];

  // A "regenerate this one asset" or "fill this one instance" request has an
  // inherently single target — there is no such thing as replacing one asset
  // with several, so those flows always request exactly one candidate,
  // regardless of what the count selector last showed.
  const singleTargetOnly = Boolean(request.replaceAssetId || request.targetInstanceId);
  const effectiveCandidateCount = isToneType || singleTargetOnly ? 1 : candidateCount;

  const generate = async () => {
    setPhase("generating");
    setError(null);
    setErrorDetails(null);
    setPartialFailureNote(null);
    setResults([]);
    setAddedIndices(new Set());
    setRequestedCount(effectiveCandidateCount);
    try {
      // Whatever the selector shows is what reaches the provider — the UI does
      // not display one reference while sending another.
      const chosenAsset =
        isCharacterType && activeReference?.assetId ? doc?.assets[activeReference.assetId] : undefined;
      const identityAsset = chosenAsset ?? (isCharacterType ? referenceAsset : undefined);
      const sceneReference =
        (!isCharacterType || showBaseImagePicker) && sceneReferenceId ? doc?.assets[sceneReferenceId] : undefined;
      const referenceAssets = provider?.capabilities?.referenceImage
        ? [identityAsset, sceneReference, style?.referenceAsset].filter(
            (asset, index, list) => Boolean(asset) && list.findIndex((candidate) => candidate?.id === asset?.id) === index,
          )
        : [];

      if (isToneType) {
        // The shared Tone capability owns tone prompts and request shape —
        // always exactly one candidate (see `effectiveCandidateCount`).
        const output = (await generateTone(doc!, { description: description || "screentone", toneType, tileable })).result;
        setResults([output]);
        setPhase("done");
        return;
      }

      const controlImageAsset =
        provider?.capabilities?.supportsControlImage && controlImageId ? doc?.assets[controlImageId] : undefined;
      const requestPayload = {
        assetType: request.assetType,
        prompt,
        negativePrompt: style?.profile.negativePrompt,
        size: defaultAspect(request.assetType),
        expectMonochrome: isMonochromeStyle(style?.profile),
        referenceUrls: referenceAssets.length > 0 ? referenceAssets.map((asset) => assetRenderUrl(asset)!).filter(Boolean) : undefined,
        controlImageUrl: controlImageAsset ? (assetRenderUrl(controlImageAsset) ?? undefined) : undefined,
      };
      const outcomes = await Promise.allSettled(
        Array.from({ length: effectiveCandidateCount }, () => generateImage(requestPayload)),
      );
      const summary = summarizeCandidateOutcomes(outcomes, effectiveCandidateCount);

      if (summary.allFailed) {
        // Every candidate failed — surface it exactly like a single-shot
        // failure always has, using the first rejection's detail.
        const message = summary.firstFailureReason instanceof Error ? summary.firstFailureReason.message : "Generation failed";
        setError(message);
        setErrorDetails(summary.firstFailureReason instanceof GenerationApiError ? summary.firstFailureReason : null);
        setPhase("idle");
        recordFailedGeneration(request.assetType, prompt, message);
        return;
      }

      setResults(summary.succeeded);
      setPartialFailureNote(summary.partialFailureNote);
      setPhase("done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      setError(message);
      setErrorDetails(e instanceof GenerationApiError ? e : null);
      setPhase("idle");
      recordFailedGeneration(request.assetType, prompt, message);
    }
  };

  /**
   * Registers ONE candidate as a real library asset. Called once per click,
   * not once per batch — a multi-candidate request lets the creator add as
   * many of the N results as they want (or all of them), each independently,
   * rather than forcing a single up-front pick and silently discarding the
   * rest.
   *
   * When this was the ONLY candidate requested (today's original, still most
   * common, single-generation flow), behavior is byte-for-byte what it always
   * was: register, then close the dialog immediately. Only when the creator
   * deliberately asked for more than one does adding a candidate leave the
   * dialog open — marking that card "Added" — so they can keep picking.
   */
  const addCandidateToLibrary = async (index: number) => {
    const candidate = results[index];
    if (!candidate || !doc) return;
    const isOnlyCandidate = requestedCount <= 1;

    /**
     * A generated manga-language visual lands on TWO shelves: the underlying
     * SourceAsset carries the image and its transparency, and a
     * MangaLanguageAsset makes it findable, taggable, and reusable by both the
     * creator and the Agent. Without the second, a generated sparkle would be
     * an anonymous "prop" nobody could search for.
     */
    if (isLanguageType) {
      await registerMangaEffectAsset({
        result: candidate,
        prompt,
        description,
        category: languageCategory,
      });
      if (isOnlyCandidate) onClose();
      else setAddedIndices((prev) => new Set(prev).add(index));
      return;
    }

    if (isToneType) {
      // Same boundary as generate(): ToneService registers on the Tones shelf.
      await registerTone({ result: candidate, prompt, intent: { description: description || "screentone", toneType, tileable } });
      onClose();
      return;
    }

    const category: AssetCategory = isCharacterType ? "character" : (request.assetType as AssetCategory);
    const assetId = await registerGeneratedAsset({
      result: candidate,
      assetType: request.assetType,
      category,
      name: isCharacterType
        ? `${character?.name ?? "Character"} ${pose || expression || "reference"}`.trim()
        : description.slice(0, 40) || TYPE_LABEL[request.assetType],
      prompt,
      metadata: {
        characterId: request.characterId,
        pose: pose || DEFAULT_CHARACTER_STATE.pose,
        expression: expression || DEFAULT_CHARACTER_STATE.expression,
        outfit: DEFAULT_CHARACTER_STATE.outfit,
        view: DEFAULT_CHARACTER_STATE.view,
        characterAssetRole: request.assetType === "character" ? "canonical" : "state",
        toneType: isToneType ? toneType : undefined,
        tileable: isToneType ? tileable : undefined,
        canonicalReferenceAssetId: request.assetType === "character" ? undefined : referenceId,
        referenceAssetIds: candidate.referenceUsed
          ? [
              isCharacterType ? referenceAsset?.id : undefined,
              showBaseImagePicker ? sceneReferenceId || undefined : undefined,
              style?.referenceAsset?.id,
            ].filter((id): id is string => Boolean(id))
          : undefined,
        ...(style ? styleMetadata(style) : {}),
      },
    });
    // "Generate missing slot" flows started from a selected instance also
    // swap that instance to the new asset — composition stays intact. Only
    // reachable when isOnlyCandidate is true (see `singleTargetOnly` above).
    if (request.targetInstanceId) {
      const store = useEditorStore.getState();
      if (store.doc?.items[request.targetInstanceId]) {
        store.dispatch({ type: "swap-instance-asset", instanceId: request.targetInstanceId, assetId });
      }
    }
    if (request.replaceAssetId && useEditorStore.getState().doc?.assets[request.replaceAssetId]) {
      useEditorStore.getState().dispatch({ type: "replace-asset", oldAssetId: request.replaceAssetId, newAssetId: assetId });
    }
    if (isOnlyCandidate) onClose();
    else setAddedIndices((prev) => new Set(prev).add(index));
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60" onMouseDown={onClose}>
      <div
        className="max-h-[90vh] w-[460px] overflow-y-auto rounded-lg bg-[var(--bg-elevated)] p-4 text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-semibold text-zinc-100">AI Asset Generator</h2>
        <p className="mb-3 text-xs text-zinc-500">
          {TYPE_LABEL[request.assetType]}
          {character ? ` · ${character.name}` : ""}
        </p>

        {provider && !provider.configured && (
          <div className="mb-3 rounded border border-zinc-700 bg-zinc-950/80 p-3 text-center text-xs">
            <p className="mb-2 text-zinc-400">Connect an image model to generate assets.</p>
            <button
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-white hover:bg-[var(--accent-hover)]"
              onClick={() => {
                onClose();
                useUiStore.getState().openSettings();
              }}
            >
              Connect Image Model
            </button>
          </div>
        )}

        {provider?.storage?.configured === false && (
          <div className="mb-3 rounded border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-300">
            Persistent asset storage is not connected. The Kumanga operator must connect storage before generated images can be saved.
          </div>
        )}

        {phase !== "done" && (
          <>
            {request.assetType === "character-pose" && (
              <Field label="Pose" value={pose} onChange={setPose} placeholder="running" />
            )}
            {request.assetType === "character-expression" && (
              <Field label="Expression" value={expression} onChange={setExpression} placeholder="crying" />
            )}
            {request.assetType === "character-pose" && (
              <Field label="Expression (optional)" value={expression} onChange={setExpression} placeholder="happy" />
            )}
            {isCharacterType && references.length > 0 && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-zinc-400">Reference</label>
                <select
                  aria-label="Reference"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-sm"
                  value={referenceChoice}
                  onChange={(event) => setReferenceChoice(event.target.value)}
                >
                  {references.map((option) => (
                    <option key={`${option.kind}-${option.assetId ?? "none"}`} value={option.assetId ?? ""}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                  {activeReference?.automatic
                    ? "The nearest existing render anchors this generation; identity stays anchored on the canonical image."
                    : "This reference will be sent to the provider instead of the automatic choice."}
                </p>
              </div>
            )}

            {(!isCharacterType || showBaseImagePicker) && <ReferencePicker
              value={sceneReferenceId}
              onChange={setSceneReferenceId}
              use={referenceUse}
              onUseChange={setReferenceUse}
              category={
                request.assetType === "background" ? "background" : request.assetType === "tone" ? "tone" : isCharacterType ? "character" : "prop"
              }
              supported={Boolean(provider?.capabilities?.referenceImage)}
            />}

            {provider?.capabilities?.supportsControlImage && !isToneType && !isLanguageType && (
              <ReferencePicker
                value={controlImageId}
                onChange={setControlImageId}
                category={request.assetType === "background" ? "background" : isCharacterType ? "character" : "prop"}
                supported
                label="Control image (pose/edge — ComfyUI ControlNet)"
                showUseSelector={false}
              />
            )}

            {isLanguageType && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-zinc-400" htmlFor="language-category">Category</label>
                <select
                  id="language-category"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-sm"
                  value={languageCategory}
                  onChange={(event) =>
                    useUiStore.getState().openGenerator({
                      ...request,
                      languageCategory: event.target.value as MangaLanguageCategory,
                    })
                  }
                >
                  {LANGUAGE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                  Generated effects inherit the project art style, so a monochrome project cannot receive a colour effect.
                </p>
              </div>
            )}

            {isToneType && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-zinc-400">Type</p>
                <div className="grid grid-cols-2 gap-1">
                  {TONE_TYPES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.hint}
                      className={`rounded-md border px-2 py-1.5 text-left text-[11px] ${
                        toneType === option.id
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "border-[var(--border-subtle)] text-zinc-400 hover:border-zinc-600"
                      }`}
                      onClick={() => setToneType(option.id)}
                    >
                      <span className="block">{option.label}</span>
                      <span className="block text-[10px] text-zinc-500">{option.hint}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
                  <input type="checkbox" checked={tileable} onChange={(event) => setTileable(event.target.checked)} />
                  Repeats without a seam
                </label>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                  {tileable
                    ? "Scale will change the pattern size and the tone will repeat across the panel."
                    : "The tone will be fitted to the area it covers rather than repeated."}
                </p>
              </div>
            )}

            <label className="mb-1 block text-xs text-zinc-400">
              {isCharacterType ? "Extra instruction (optional)" : "Description"}
            </label>
            <textarea
              className="mb-3 h-20 w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                request.assetType === "background"
                  ? "Empty Japanese high school classroom, afternoon sunlight"
                  : request.assetType === "prop"
                    ? "Japanese school bag, isolated object"
                    : isLanguageType
                      ? "extreme shocked manga symbol, black-and-white, rough ink style"
                      : isToneType
                        ? "dark psychological manga hatching"
                        : "Running toward camera while carrying a school bag"
              }
            />

            {isCharacterType && (
              <p className="mb-3 rounded-md bg-[var(--bg-elevated)] p-2 text-[11px] leading-4 text-zinc-500">
                {canUseReference
                  ? "The character reference image will be sent to the provider to help preserve identity. Consistency is provider-dependent and not guaranteed."
                  : referenceAsset
                    ? "The configured provider does not support reference images — identity will rely on the text description only."
                    : showBaseImagePicker
                      ? "Optionally pick a reference image below — a photo, concept art, or a character from elsewhere — for the AI to design a NEW character from. Whatever it generates becomes this character's own reference; the source image is never copied in directly."
                      : "No reference image yet — the first generated image becomes this character's reference."}
              </p>
            )}

            {!isToneType && !singleTargetOnly && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-zinc-400">Candidates</label>
                <div className="flex items-center gap-1.5">
                  {CANDIDATE_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-label={`${count} candidate${count === 1 ? "" : "s"}`}
                      aria-pressed={candidateCount === count}
                      className={`h-7 w-7 rounded border text-xs ${
                        candidateCount === count
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "border-[var(--border-subtle)] text-zinc-400 hover:border-zinc-600"
                      }`}
                      onClick={() => setCandidateCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                  {candidateCount > 1
                    ? `Generates ${candidateCount} versions to pick from — each is a separate provider call.`
                    : "Generate more than one at once to compare a few takes before picking."}
                </p>
              </div>
            )}

            <details className="mb-3 text-[11px] text-zinc-500">
              <summary className="cursor-pointer">Prompt preview</summary>
              <p className="mt-1 rounded bg-zinc-950 p-2 leading-4">{prompt}</p>
            </details>

            {error && (
              <div className="mb-2 rounded border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-300">
                <p className="font-medium">Generation failed</p>
                <p className="mt-1 text-red-400">{error}</p>
                {(errorDetails?.requestId || errorDetails?.details) && (
                  <details className="mt-2 text-[11px] text-zinc-400">
                    <summary className="cursor-pointer">Show safe details</summary>
                    <dl className="mt-1 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 rounded bg-zinc-950 p-2">
                      {errorDetails.details?.provider && <><dt>Provider</dt><dd>{errorDetails.details.provider}</dd></>}
                      {errorDetails.details?.model && <><dt>Model</dt><dd>{errorDetails.details.model}</dd></>}
                      {errorDetails.details?.endpoint && <><dt>Endpoint</dt><dd>{errorDetails.details.endpoint}</dd></>}
                      {errorDetails.details?.httpStatus && <><dt>HTTP</dt><dd>{errorDetails.details.httpStatus}</dd></>}
                      {errorDetails.details?.stage && <><dt>Stage</dt><dd>{errorDetails.details.stage}</dd></>}
                      {errorDetails.requestId && <><dt>Request ID</dt><dd className="break-all">{errorDetails.requestId}</dd></>}
                    </dl>
                  </details>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200" onClick={onClose}>
                Cancel
              </button>
              <button
                className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                disabled={
                  phase === "generating" ||
                  provider?.configured === false ||
                  provider?.storage?.configured === false
                }
                onClick={generate}
              >
                {phase === "generating"
                  ? effectiveCandidateCount > 1
                    ? `Generating ${effectiveCandidateCount} candidates…`
                    : `Generating${character ? ` ${character.name}` : " asset"}…`
                  : "Generate"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && results.length > 0 && requestedCount <= 1 && (
          <div>
            {contractFor(results[0]).valid ? (
              <>
                <p className="mb-2 text-xs text-zinc-400">Generated result</p>
                {/* The checkerboard is a CSS backdrop BEHIND a transparent PNG.
                    It is never part of the bitmap. `results[0].url` is the
                    stored derivative, so this preview is byte-identical to
                    what the library keeps and the canvas composites. */}
                <div className="mb-3 grid place-items-center rounded border border-zinc-700 bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={results[0].url} alt="Generated asset" className="max-h-[360px] rounded" />
                </div>
                {results[0].referenceUsed && (
                  <p className="mb-2 text-[11px] text-zinc-500">Generated with the character reference image.</p>
                )}
                <div className="flex justify-end gap-2 text-xs">
                  <button
                    className="rounded px-3 py-1.5 text-zinc-400 hover:text-zinc-200"
                    onClick={() => {
                      setResults([]);
                      setPhase("idle");
                    }}
                  >
                    Discard
                  </button>
                  <button
                    className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
                    onClick={() => {
                      setResults([]);
                      generate();
                    }}
                  >
                    Regenerate
                  </button>
                  <button
                    className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-white hover:bg-[var(--accent-hover)]"
                    onClick={() => addCandidateToLibrary(0)}
                  >
                    Add to Library
                  </button>
                </div>
              </>
            ) : (
              // One concise recoverable state. No raw preview: showing the
              // un-keyed image on a checkerboard backdrop is what made a failed
              // extraction look like a transparent asset.
              <div className="rounded border border-amber-800/60 bg-amber-950/30 p-3">
                <p className="mb-1 text-xs font-medium text-amber-300">{BACKGROUND_REMOVAL_FAILED_MESSAGE}</p>
                <p className="mb-3 text-[11px] leading-4 text-zinc-400">
                  This image could not be turned into a transparent layer, so it was not added to your library.
                </p>
                <div className="flex justify-end gap-2 text-xs">
                  <button
                    className="rounded px-3 py-1.5 text-zinc-400 hover:text-zinc-200"
                    onClick={() => {
                      setResults([]);
                      setPhase("idle");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-white hover:bg-[var(--accent-hover)]"
                    onClick={() => {
                      setResults([]);
                      generate();
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "done" && results.length > 0 && requestedCount > 1 && (
          <div>
            <p className="mb-2 text-xs text-zinc-400">
              {results.length} candidate{results.length > 1 ? "s" : ""} — add the ones you want to keep
            </p>
            {partialFailureNote && (
              <p className="mb-2 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] text-amber-300">
                {partialFailureNote}
              </p>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2">
              {results.map((candidate, index) => {
                const candidateContract = contractFor(candidate);
                const added = addedIndices.has(index);
                return (
                  <div key={index} className="rounded border border-zinc-700 p-1.5">
                    <div className="mb-1.5 grid place-items-center rounded bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] p-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={candidate.url} alt={`Candidate ${index + 1}`} className="h-[160px] w-full rounded object-contain" />
                    </div>
                    {candidateContract.valid ? (
                      <button
                        className={`w-full rounded px-2 py-1 text-[11px] ${
                          added
                            ? "cursor-default bg-zinc-800 text-zinc-500"
                            : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                        }`}
                        disabled={added}
                        onClick={() => addCandidateToLibrary(index)}
                      >
                        {added ? "Added ✓" : "Add to Library"}
                      </button>
                    ) : (
                      <p className="text-center text-[10px] leading-3 text-amber-400">{BACKGROUND_REMOVAL_FAILED_MESSAGE}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                className="rounded px-3 py-1.5 text-zinc-400 hover:text-zinc-200"
                onClick={() => {
                  setResults([]);
                  setPartialFailureNote(null);
                  setPhase("idle");
                }}
              >
                Discard {addedIndices.size > 0 ? "the rest" : "all"}
              </button>
              <button
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
                onClick={() => generate()}
              >
                Regenerate all
              </button>
              <button
                className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-white hover:bg-[var(--accent-hover)]"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-zinc-400">{label}</label>
      <input
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/**
 * One reference picker, shared by Scene, Object, Manga FX generation, and a
 * brand-new character's first reference (`showBaseImagePicker`).
 *
 * Upload a new image or reuse one already in the library, and say what the
 * reference is FOR. The intent matters: "match this room's layout" and "match
 * this drawing's style" are different requests, and collapsing them makes the
 * provider guess.
 *
 * An EXISTING character (one with a canonical reference already) instead
 * uses the separate `references`/`referenceChoice` selector above, built
 * from the state graph — that one answers a different question (which
 * existing render of THIS character anchors identity for one more pose or
 * expression), not "what external image should inspire a new design."
 */
function ReferencePicker({
  value,
  onChange,
  use,
  onUseChange,
  category,
  supported,
  label = "Reference image",
  unsupportedMessage = "The connected image model does not accept reference images, so this generation uses the description only.",
  // The layout/style/loose wording describes how OTHER providers weight a
  // reference image for identity/style — meaningless for a ComfyUI
  // ControlNet structural input, which has its own separate strength
  // setting in AI Settings instead. Defaults to true (every existing
  // call site keeps showing it).
  showUseSelector = true,
}: {
  value: string;
  onChange: (assetId: string) => void;
  use?: "layout" | "style" | "loose";
  onUseChange?: (use: "layout" | "style" | "loose") => void;
  category: AssetCategory;
  supported: boolean;
  label?: string;
  unsupportedMessage?: string;
  showUseSelector?: boolean;
}) {
  const doc = useEditorStore((s) => s.doc);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;
  // Any image already in the project is a candidate reference.
  const candidates = Object.values(doc.assets).filter((asset) => asset.status !== "archived");
  const selected = value ? doc.assets[value] : undefined;

  if (!supported) {
    return (
      <p className="mb-3 rounded-md bg-[var(--bg-elevated)] p-2 text-[11px] leading-4 text-zinc-500">
        {unsupportedMessage}
      </p>
    );
  }

  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-zinc-400">
        {label} <span className="text-zinc-600">(optional)</span>
      </label>
      <div className="flex gap-2">
        <select
          aria-label={label}
          className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">None</option>
          {candidates.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="shrink-0 rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              // Uploaded as a plain upload: a reference is source material, not
              // a cut-out layer, so it must not go through foreground extraction.
              const assetId = await uploadImageFile(file, "upload");
              onChange(assetId);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Upload failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>

      {selected && (
        <div className="mt-1.5 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetPreviewUrl(selected)}
            alt={selected.name}
            className="h-12 w-12 rounded border border-zinc-700 object-cover"
          />
          {showUseSelector && (
            <select
              aria-label="Use reference for"
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px]"
              value={use}
              onChange={(event) => onUseChange?.(event.target.value as "layout" | "style" | "loose")}
            >
              {category === "background" && <option value="layout">Match the layout and architecture</option>}
              <option value="style">Match the art style</option>
              <option value="loose">Loose inspiration</option>
            </select>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

/** Say what the reference is for, so the provider does not have to guess. */
function referenceIntent(hasReference: boolean, use: "layout" | "style" | "loose"): string {
  if (!hasReference) return "";
  switch (use) {
    case "layout":
      return "Use the supplied reference image for the layout, architecture and spatial arrangement; keep its composition and structure.";
    case "style":
      return "Use the supplied reference image as an art-style reference: match its rendering, line quality and palette.";
    case "loose":
      return "Use the supplied reference image as loose inspiration only; do not copy it directly.";
  }
}
