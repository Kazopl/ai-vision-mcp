/**
 * Document source handling: MIME detection and loading for analyze_document.
 * Supports PDF (native visual understanding: layouts, tables, charts,
 * handwriting) plus text-based document types Gemini accepts.
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
};

export const SUPPORTED_DOCUMENT_EXTENSIONS = Object.keys(DOC_MIME_BY_EXT);

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
    const contentType = response.headers.get('content-type')?.split(';')[0];
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType:
        contentType &&
        (contentType === 'application/pdf' ||
          contentType.startsWith('text/') ||
          contentType === 'application/json')
          ? contentType
          : getDocumentMimeType(documentSource),
      filename:
        path.basename(documentSource.split('?')[0]) || 'document.pdf',
    };
  }

  throw new VisionError(
    `Unsupported document source: ${documentSource}`,
    'INVALID_ARGUMENT'
  );
}
