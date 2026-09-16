"use client";

/**
 * Whole-project EPUB export: a fixed-layout EPUB3, one XHTML page per manga
 * page, each holding one full-bleed image at the page's own pixel size — the
 * format digital storefronts and e-readers ask for by name, which neither
 * CBZ (`exportBook.ts`, comic-reader apps only) nor PDF (`exportBookPdf.ts`,
 * print/submission) covers.
 *
 * Hand-built directly on JSZip (already a dependency for CBZ) rather than an
 * EPUB-authoring library: the format is a well-specified zip of a handful of
 * small XML/XHTML files, and a manga chapter's structure — a flat, ordered
 * list of full-page images — needs none of a general EPUB library's text
 * flow, footnote or multi-chapter TOC machinery.
 */

import JSZip from "jszip";
import { useEditorStore } from "@/editor/store";
import { captureAllPages, downloadBlob, projectFileBasename, type ExportProgress } from "./exportPages";
import type { ExportScope } from "./exportBook";

export type ExportEpubProgress = ExportProgress;

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** BCP-47 codes for `domain/languagePresets.ts`'s suggestion list — `dc:language`
 * wants a real code, not a free-text name. `dialogueLanguage` is a best-effort
 * proxy for the document's own language (it is actually "what the Agent
 * writes NEW dialogue in", which can be unset even for an all-hand-lettered
 * project) — an unrecognized or absent value falls back to "en" rather than
 * writing a name straight into the field, which most reading systems accept
 * loosely but is not what the EPUB spec asks for.
 */
const LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  vietnamese: "vi",
  japanese: "ja",
  korean: "ko",
  "chinese (simplified)": "zh",
  french: "fr",
  spanish: "es",
  german: "de",
};

export function epubLanguageCode(dialogueLanguage: string | undefined): string {
  const key = dialogueLanguage?.trim().toLowerCase();
  return (key && LANGUAGE_CODES[key]) || "en";
}

export async function exportBookEpub(
  scale: 1 | 2 = 2,
  onProgress?: (progress: ExportEpubProgress) => void,
  scope?: ExportScope,
): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");

  const dataUrls = await captureAllPages(scale, onProgress, scope?.pageIds);
  const width = Math.round(doc.project.settings.pageWidth * scale);
  const height = Math.round(doc.project.settings.pageHeight * scale);
  const digits = String(dataUrls.length).length;
  const pageFiles = dataUrls.map((_, i) => String(i + 1).padStart(digits, "0"));

  const title = escapeXml(scope ? `${doc.project.name} — ${scope.label}` : doc.project.name);
  const bookId = `urn:uuid:kumanga-${doc.project.id}${scope ? `-${scope.label}` : ""}`;
  const language = epubLanguageCode(doc.project.settings.dialogueLanguage);

  const zip = new JSZip();
  // The mimetype entry must be the first file in the zip and stored
  // uncompressed — the one hard structural rule of the EPUB container format.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  dataUrls.forEach((dataUrl, i) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    zip.file(`OEBPS/images/page_${pageFiles[i]}.png`, base64, { base64: true });
    zip.file(
      `OEBPS/page_${pageFiles[i]}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${title} — Page ${i + 1}</title>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <style>html,body{margin:0;padding:0}img{display:block;width:100%;height:100%}</style>
</head>
<body>
  <img src="images/page_${pageFiles[i]}.png" alt="Page ${i + 1}"/>
</body>
</html>`,
    );
  });

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>${title}</title></head>
<body>
  <nav epub:type="toc"><ol>
    ${dataUrls.map((_, i) => `<li><a href="page_${pageFiles[i]}.xhtml">Page ${i + 1}</a></li>`).join("\n    ")}
  </ol></nav>
</body>
</html>`,
  );

  const manifestItems = dataUrls
    .map(
      (_, i) =>
        `    <item id="page${pageFiles[i]}" href="page_${pageFiles[i]}.xhtml" media-type="application/xhtml+xml"/>\n` +
        `    <item id="image${pageFiles[i]}" href="images/page_${pageFiles[i]}.png" media-type="image/png"/>`,
    )
    .join("\n");
  const spineItems = dataUrls.map((_, i) => `    <itemref idref="page${pageFiles[i]}"/>`).join("\n");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${bookId}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">landscape</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`,
  );

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  const name = scope
    ? `${projectFileBasename(doc.project.name)}-${projectFileBasename(scope.label)}`
    : projectFileBasename(doc.project.name);
  downloadBlob(blob, `${name}.epub`);
}
