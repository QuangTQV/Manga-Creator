import { describe, expect, it } from "vitest";
import { createProjectDocument } from "./factory";
import { addAsset } from "./libraryOps";
import type { FontAsset, MangaLanguageAsset, ProjectDocument, StyleProfile } from "./types";
import { collectAssetUrls, remapAssetUrls } from "./assetUrls";

function withExtraEntities(doc: ProjectDocument): ProjectDocument {
  const font: FontAsset = { id: "font-1", projectId: doc.project.id, name: "My Font", storageUrl: "https://blob.example/font.ttf", format: "ttf" };
  const effect: MangaLanguageAsset = {
    id: "lang-1",
    projectId: doc.project.id,
    category: "decorations",
    name: "Sparkle",
    source: "ai-generated",
    format: "visual",
    tags: [],
    thumbnailUrl: "https://blob.example/sparkle-thumb.png",
    createdAt: doc.project.createdAt,
  };
  const profile: StyleProfile = {
    id: "style-1",
    family: "japanese-manga",
    name: "Custom",
    description: "",
    positivePrompt: "",
    previewImage: "https://blob.example/style-preview.png",
  };
  return {
    ...doc,
    fonts: { ...doc.fonts, [font.id]: font },
    language: { ...doc.language, [effect.id]: effect },
    project: {
      ...doc.project,
      settings: {
        ...doc.project.settings,
        artStyle: { ...doc.project.settings.artStyle, customProfiles: { ...doc.project.settings.artStyle.customProfiles, [profile.id]: profile } },
      },
    },
  };
}

describe("collectAssetUrls", () => {
  it("gathers every URL-bearing field across assets, fonts, language effects, and custom style profiles", () => {
    let doc = createProjectDocument("URL collection test");
    const added = addAsset(doc, {
      category: "character",
      name: "Yuri",
      storageUrl: "https://blob.example/yuri.png",
      processedImageUrl: "https://blob.example/yuri-alpha.png",
      width: 800,
      height: 1600,
    });
    doc = added.doc;
    doc = withExtraEntities(doc);

    const urls = collectAssetUrls(doc);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://blob.example/yuri.png",
        "https://blob.example/yuri-alpha.png",
        "https://blob.example/font.ttf",
        "https://blob.example/sparkle-thumb.png",
        "https://blob.example/style-preview.png",
      ]),
    );
  });

  it("de-duplicates a URL reused across multiple fields", () => {
    let doc = createProjectDocument("Dedup test");
    const added = addAsset(doc, {
      category: "background",
      name: "Shared",
      storageUrl: "https://blob.example/same.png",
      processedImageUrl: "https://blob.example/same.png",
      width: 800,
      height: 1600,
    });
    doc = added.doc;

    expect(collectAssetUrls(doc).filter((u) => u === "https://blob.example/same.png")).toHaveLength(1);
  });

  it("skips undefined/absent optional URL fields without crashing", () => {
    const doc = createProjectDocument("Empty test");
    expect(collectAssetUrls(doc)).toEqual([]);
  });
});

describe("remapAssetUrls", () => {
  it("rewrites every mapped URL and leaves unmapped ones untouched, without mutating the input", () => {
    let doc = createProjectDocument("Remap test");
    const added = addAsset(doc, {
      category: "character",
      name: "Yuri",
      storageUrl: "https://blob.example/yuri.png",
      processedImageUrl: "https://blob.example/untouched.png",
      width: 800,
      height: 1600,
    });
    doc = added.doc;
    doc = withExtraEntities(doc);

    const urlMap = new Map([
      ["https://blob.example/yuri.png", "https://new-host.example/yuri.png"],
      ["https://blob.example/font.ttf", "https://new-host.example/font.ttf"],
      ["https://blob.example/sparkle-thumb.png", "https://new-host.example/sparkle-thumb.png"],
      ["https://blob.example/style-preview.png", "https://new-host.example/style-preview.png"],
    ]);

    const remapped = remapAssetUrls(doc, urlMap);

    expect(remapped.assets[added.assetId].storageUrl).toBe("https://new-host.example/yuri.png");
    // Not in the map — a real-world "this one failed to bundle/re-upload" case — stays as-is.
    expect(remapped.assets[added.assetId].processedImageUrl).toBe("https://blob.example/untouched.png");
    expect(remapped.fonts["font-1"].storageUrl).toBe("https://new-host.example/font.ttf");
    expect(remapped.language["lang-1"].thumbnailUrl).toBe("https://new-host.example/sparkle-thumb.png");
    expect(remapped.project.settings.artStyle.customProfiles["style-1"].previewImage).toBe(
      "https://new-host.example/style-preview.png",
    );

    // The original document is untouched.
    expect(doc.assets[added.assetId].storageUrl).toBe("https://blob.example/yuri.png");
  });

  it("rewrites a local-edit mask URL when present and mapped", () => {
    let doc = createProjectDocument("Mask remap test");
    const added = addAsset(doc, {
      category: "character",
      name: "Edited",
      storageUrl: "https://blob.example/edited.png",
      width: 800,
      height: 1600,
      provenance: {
        localEdit: {
          parentAssetId: "parent-1",
          editPrompt: "fix the hand",
          maskUrl: "https://blob.example/mask.png",
          editedAt: doc.project.createdAt,
        },
      },
    });
    doc = added.doc;

    const remapped = remapAssetUrls(doc, new Map([["https://blob.example/mask.png", "https://new-host.example/mask.png"]]));
    expect(remapped.assets[added.assetId].provenance?.localEdit?.maskUrl).toBe("https://new-host.example/mask.png");
  });
});
