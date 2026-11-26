import { ImportError } from './errors.js';
import {
  importFormatForFilename,
  IMPORT_FORMATS,
} from '../../../shared/import-limits.js';

/**
 * File bytes → editor HTML.
 *
 * Each format has a different parser, but they all end at the same place: a
 * small HTML string that Tiptap's schema already understands. That keeps the
 * conversion to a Yjs snapshot in one place (convert.js) and means a new
 * format only has to produce HTML.
 *
 * Parsers are imported lazily: a `.txt` upload should not pay for PDF.js or
 * Mammoth, and a deployment that never imports a PDF never loads them.
 */

/** Guardrail against a pathological PDF/DOCX turning into a giant CRDT. */
export const MAX_IMPORT_TEXT_CHARS = 2_000_000;

/** BOMs are not content; strip them before the text reaches the editor. */
export function normalizeImportText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** UTF-8 by default, with BOM-aware UTF-16 support for Windows text files. */
export function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  return new TextDecoder('utf-8').decode(buffer);
}

function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes('%PDF-');
}

function looksLikeZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** No NULs and few control bytes: safe to treat as a text document. */
function looksLikeText(buffer) {
  // UTF-16 text is full of NULs, but the BOM identifies it unambiguously.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return true;
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return true;
  const sample = buffer.subarray(0, 8192);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / sample.length < 0.1;
}

/**
 * Pick a parser. The extension is authoritative when it is one we support,
 * but the magic bytes are still checked so a renamed binary cannot reach a
 * parser that expects a PDF/DOCX. Files with no usable extension are sniffed,
 * which makes drag-and-drop from some file managers work.
 */
export function detectImportFormat(filename, buffer) {
  if (/\.doc$/i.test(filename)) {
    throw new ImportError(
      'Legacy .doc files are not supported. Save the document as .docx and try again.',
      400
    );
  }

  const byExtension = importFormatForFilename(filename);
  if (byExtension) {
    if (byExtension === 'pdf' && !looksLikePdf(buffer)) {
      throw new ImportError('This file does not look like a valid PDF.', 422);
    }
    if (byExtension === 'docx' && !looksLikeZip(buffer)) {
      throw new ImportError('This file does not look like a valid DOCX document.', 422);
    }
    if (
      (byExtension === 'text' || byExtension === 'markdown') &&
      !looksLikeText(buffer)
    ) {
      throw new ImportError(
        'This file does not look like a text document. Import a PDF, DOCX, TXT, or Markdown file.',
        422
      );
    }
    return byExtension;
  }

  if (looksLikePdf(buffer)) return 'pdf';
  if (looksLikeZip(buffer)) return 'docx';
  if (looksLikeText(buffer)) return 'text';

  throw new ImportError(
    'Unsupported file type. Import a PDF, DOCX, TXT, or Markdown file.',
    400
  );
}

/**
 * Plain text → paragraphs. Single newlines become hard breaks so a PDF's
 * visual line structure survives; blank lines start a new paragraph.
 */
export function textToHtml(text) {
  const normalized = normalizeImportText(text);
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Markdown → HTML with raw HTML disabled.
 *
 * A markdown file is untrusted input, and marked passes raw HTML through by
 * default. Escaping the `html` token keeps the document's markdown formatting
 * while preventing an embedded `<script>`/`<iframe>` from ever reaching the
 * editor's DOM parser. Images are reduced to their alt text for the same
 * reason DOCX images are dropped: remote/base64 images bloat the snapshot and
 * add an outbound-request surface the importer does not need.
 */
export async function markdownToHtml(markdown) {
  const { marked, Renderer } = await import('marked');
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.image = ({ text }) => (text ? escapeHtml(`[image: ${text}]`) : '');
  return marked.parse(normalizeImportText(markdown), {
    renderer,
    gfm: true,
    breaks: false,
  });
}

async function docxToHtml(buffer) {
  const mammoth = (await import('mammoth')).default;
  let result;
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        // Do not read embedded images at all. The default converter inlines
        // them as base64 data URIs, which can turn a 5 MB document into a
        // 20 MB CRDT snapshot; images are outside the text-import contract.
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
        ignoreEmptyParagraphs: true,
      }
    );
  } catch (error) {
    const message = String(error?.message ?? '');
    if (/password|encrypted/i.test(message)) {
      throw new ImportError('This Word document is password-protected and cannot be imported.', 422);
    }
    throw new ImportError('Could not read this DOCX file. It may be damaged or not a Word document.', 422);
  }

  // Mammoth emits an <img> for every image even with the converter above.
  const html = String(result.value ?? '').replace(/<img\b[^>]*>/gi, '');
  return { html, warnings: result.messages?.length ?? 0 };
}

async function pdfToText(buffer) {
  let text;
  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    text = result.text;
  } catch (error) {
    const message = String(error?.message ?? '');
    if (/password|encrypted/i.test(message)) {
      throw new ImportError('This PDF is password-protected and cannot be imported.', 422);
    }
    throw new ImportError('Could not read this PDF. It may be damaged or not a PDF file.', 422);
  }
  return normalizeImportText(text);
}

/**
 * Extract one uploaded file into editor-ready HTML.
 *
 * Returns `{ format, html, warnings }`. An empty document is a user-facing
 * error rather than an empty editor page: importing a scanned PDF and landing
 * on a blank document looks like the import silently failed.
 */
export async function extractImport({ filename, buffer }) {
  if (!buffer || buffer.length === 0) {
    throw new ImportError('This file is empty.', 400);
  }

  const format = detectImportFormat(filename, buffer);

  if (format === 'pdf') {
    const text = await pdfToText(buffer);
    if (!text) {
      throw new ImportError(
        'No selectable text was found in this PDF. Scanned PDFs need OCR before they can be imported.',
        422
      );
    }
    if (text.length > MAX_IMPORT_TEXT_CHARS) {
      throw new ImportError(
        `This document is too large to import (${text.length.toLocaleString()} characters; the limit is ${MAX_IMPORT_TEXT_CHARS.toLocaleString()}).`,
        413
      );
    }
    return { format, html: textToHtml(text), warnings: 0 };
  }

  if (format === 'docx') {
    const { html, warnings } = await docxToHtml(buffer);
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) {
      throw new ImportError('This Word document contains no readable text.', 422);
    }
    if (plain.length > MAX_IMPORT_TEXT_CHARS) {
      throw new ImportError(
        `This document is too large to import (${plain.length.toLocaleString()} characters; the limit is ${MAX_IMPORT_TEXT_CHARS.toLocaleString()}).`,
        413
      );
    }
    return { format, html, warnings };
  }

  const text = normalizeImportText(decodeText(buffer));
  if (!text) {
    throw new ImportError('This file contains no readable text.', 422);
  }
  if (text.length > MAX_IMPORT_TEXT_CHARS) {
    throw new ImportError(
      `This document is too large to import (${text.length.toLocaleString()} characters; the limit is ${MAX_IMPORT_TEXT_CHARS.toLocaleString()}).`,
      413
    );
  }

  if (format === 'markdown') {
    return { format, html: await markdownToHtml(text), warnings: 0 };
  }

  return { format: 'text', html: textToHtml(text), warnings: 0 };
}

/** Exposed for the route's error messages and tests. */
export { IMPORT_FORMATS };
