import { describe, expect, test } from 'vitest';
import {
  classifyMediaSource,
  mediaKindFromMimeType,
} from '../../src/utils/mediaKind.js';
import {
  getDocumentMimeType,
  getDocumentProcessingNote,
  isSupportedDocumentMimeType,
} from '../../src/utils/documentSourceHandler.js';

describe('classifyMediaSource', () => {
  test.each([
    ['/tmp/shot.PNG', 'image'],
    ['C:\\Users\\me\\Desktop\\photo.jpeg', 'image'],
    ['/recordings/demo.mov', 'video'],
    ['clip.mp4', 'video'],
    ['https://cdn.example.com/a/b/video.webm?token=abc#t=10', 'video'],
    ['/audio/call.m4a', 'audio'],
    ['https://example.com/voice.mp3?download=1', 'audio'],
    ['/docs/contract.pdf', 'document'],
    ['data:image/png;base64,AAAA', 'image'],
    ['data:video/mp4;base64,AAAA', 'video'],
    ['data:audio/wav;base64,AAAA', 'audio'],
    ['data:application/pdf;base64,AAAA', 'document'],
  ])('%s -> %s', (source, kind) => {
    expect(classifyMediaSource(source)).toBe(kind);
  });

  test.each([
    // Office files are for analyze_document, not the Decisions API
    '/docs/report.docx',
    '/docs/sheet.xlsx',
    // No extension to go on: the type lives in Files API metadata
    'files/abc123',
    'https://example.com/download',
    'data:application/zip;base64,AAAA',
    'data:malformed',
  ])('%s -> undefined', source => {
    expect(classifyMediaSource(source)).toBeUndefined();
  });
});

describe('mediaKindFromMimeType', () => {
  test('maps the MIME families the Decisions API accepts', () => {
    expect(mediaKindFromMimeType('image/webp')).toBe('image');
    expect(mediaKindFromMimeType('video/quicktime')).toBe('video');
    expect(mediaKindFromMimeType('AUDIO/MP4')).toBe('audio');
    expect(mediaKindFromMimeType('application/pdf')).toBe('document');
  });

  test('returns undefined for anything else', () => {
    expect(mediaKindFromMimeType('text/plain')).toBeUndefined();
    expect(
      mediaKindFromMimeType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBeUndefined();
    expect(mediaKindFromMimeType(undefined)).toBeUndefined();
  });
});

describe('document MIME handling', () => {
  test.each([
    ['report.pdf', 'application/pdf'],
    [
      'spec.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['legacy.doc', 'application/msword'],
    [
      'template.dotx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    ],
    [
      'deck.PPTX',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    ['old-deck.ppt', 'application/vnd.ms-powerpoint'],
    [
      'numbers.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['numbers.xls', 'application/vnd.ms-excel'],
    ['notes.odt', 'application/vnd.oasis.opendocument.text'],
    ['slides.odp', 'application/vnd.oasis.opendocument.presentation'],
    ['table.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    [
      'https://example.com/files/q3.xlsx?sig=abc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['server.log', 'text/plain'],
    ['config.yaml', 'text/plain'],
    ['README.md', 'text/markdown'],
    // Unknown extensions keep the historical PDF default
    ['mystery.bin', 'application/pdf'],
  ])('%s -> %s', (name, mime) => {
    expect(getDocumentMimeType(name)).toBe(mime);
  });

  test('accepts specific supported content types and any text type', () => {
    expect(isSupportedDocumentMimeType('application/pdf')).toBe(true);
    expect(isSupportedDocumentMimeType('application/msword')).toBe(true);
    expect(isSupportedDocumentMimeType('text/html')).toBe(true);
    // Generic types say nothing about the real format; the extension decides
    expect(isSupportedDocumentMimeType('application/octet-stream')).toBe(false);
    expect(isSupportedDocumentMimeType('application/zip')).toBe(false);
  });

  test('attaches a processing note to spreadsheets only', () => {
    for (const name of ['a.xlsx', 'a.xls', 'a.ods']) {
      const note = getDocumentProcessingNote(getDocumentMimeType(name));
      expect(note).toMatch(/flattened CSV/);
      expect(note).toMatch(/first sheet/);
    }
    for (const name of ['a.pdf', 'a.docx', 'a.pptx', 'a.txt']) {
      expect(
        getDocumentProcessingNote(getDocumentMimeType(name))
      ).toBeUndefined();
    }
  });
});
