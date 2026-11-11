/**
 * Document source handling: MIME detection and loading for analyze_document.
 * Supports PDF (native visual understanding: layouts, tables, charts,
 * handwriting), Microsoft Office and OpenDocument files, plus text-based
 * document types Gemini accepts.
 *
 * How Gemini processes Office/OpenDocument files (docs, Nov 2026):
 * - DOCX, DOTX, ODT, PPTX: text of the whole file (plus embedded images for
 *   DOCX/PPTX); pages are not rendered, so layout and charts may be lost.
 * - DOC, PPT, ODP: every page/slide rendered as an image.
 * - XLSX, XLS, ODS: documented as first sheet only (XLSX/XLS as CSV values;
 *   ODS with formulas). See getDocumentProcessingNote for observed behavior.
 */

import path from 'path';
import { VisionError, NetworkError } from '../types/Errors.js';

const DOC_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  xml: 'text/xml',
  rtf: 'text/rtf',
  json: 'application/json',
  // Microsoft Office
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  // OpenDocument
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  // Plain-text formats developers hand over as "documents"
  log: 'text/plain',
  yaml: 'text/plain',
  yml: 'text/plain',
  toml: 'text/plain',
  ini: 'text/plain',
  sql: 'text/plain',
  tsv: 'text/plain',
};

export const SUPPORTED_DOCUMENT_EXTENSIONS = Object.keys(DOC_MIME_BY_EXT);

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set(Object.values(DOC_MIME_BY_EXT));

/** Spreadsheet formats, which reach the model as flattened cell data. */
const SPREADSHEET_MIME_TYPES = new Set([
  DOC_MIME_BY_EXT.xlsx,
  DOC_MIME_BY_EXT.xls,
  DOC_MIME_BY_EXT.ods,
]);

/** True when a server-reported content type is one Gemini accepts as-is. */
export function isSupportedDocumentMimeType(mimeType: string): boolean {
  return (
    SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType) || mimeType.startsWith('text/')
  );
}

/**
 * A caveat worth surfacing to the caller for this document type, if any.
 * Spreadsheets are the sharp edge. Google documents first-sheet-only
 * processing; in testing (Nov 2026) a 3-sheet XLSX came through with its
 * first two sheets concatenated as CSV, with no sheet names or boundaries.
 * So the note states what is guaranteed and what is lost, without claiming
 * later sheets are always dropped.
 */
export function getDocumentProcessingNote(
  mimeType: string
): string | undefined {
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) {
    return 'Spreadsheets reach the model as flattened CSV cell values: no sheet names, formatting, or (for XLSX/XLS) formulas. Google only documents the first sheet as being read, so do not rely on later sheets; to analyze a specific sheet, move it first or export it separately.';
  }
  return undefined;
}

export function getDocumentMimeType(filenameOrUrl: string): string {
  const ext = path
    .extname(filenameOrUrl.split('?')[0])
    .replace('.', '')
    .toLowerCase();
  return DOC_MIME_BY_EXT[ext] || 'application/pdf';
}

export interface LoadedDocument {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/** Load a document from a data URI or remote URL into memory. */
export async function loadDocumentSource(
  documentSource: string
): Promise<LoadedDocument> {
  if (documentSource.startsWith('data:')) {
    const commaIdx = documentSource.indexOf(',');
    if (commaIdx === -1) {
      throw new VisionError('Malformed document data URI', 'INVALID_ARGUMENT');
    }
    const mimeType = documentSource.slice(5, documentSource.indexOf(';'));
    return {
      buffer: Buffer.from(documentSource.slice(commaIdx + 1), 'base64'),
      mimeType,
      filename: 'document',
    };
  }

  if (/^https?:\/\//i.test(documentSource)) {
    const response = await fetch(documentSource);
    if (!response.ok) {
      throw new NetworkError(
        `Failed to fetch document from URL (Status: ${response.status})`
      );
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim();
    // Trust a specific, supported content type. Servers often send Office
    // files as application/octet-stream or application/zip, in which case
    // the URL's extension decides.
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType:
        contentType && isSupportedDocumentMimeType(contentType)
          ? contentType
          : getDocumentMimeType(documentSource),
      filename: path.basename(documentSource.split('?')[0]) || 'document.pdf',
    };
  }

  throw new VisionError(
    `Unsupported document source: ${documentSource}`,
    'INVALID_ARGUMENT'
  );
}
