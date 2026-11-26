import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { docFromSnapshot, yUpdateToHtml } from '@/lib/ydoc-utils';
import {
  IMPORT_ACCEPT,
  IMPORT_EXTENSIONS,
  formatImportBytes,
  importFormatForFilename,
  importTitleFromFilename,
} from '../shared/import-limits.js';
import { ImportError } from '@/lib/import/errors';
import {
  decodeText,
  detectImportFormat,
  escapeHtml,
  extractImport,
  markdownToHtml,
  normalizeImportText,
  textToHtml,
} from '@/lib/import/extract';
import { documentTextLength, htmlToYjsSnapshot } from '@/lib/import/convert';
import { buildImportedDocument } from '@/lib/import/document';

const bytes = (text) => Buffer.from(text, 'utf8');

describe('import filename rules', () => {
  it('maps supported extensions to formats', () => {
    expect(importFormatForFilename('Report.PDF')).toBe('pdf');
    expect(importFormatForFilename('notes.docx')).toBe('docx');
    expect(importFormatForFilename('README.md')).toBe('markdown');
    expect(importFormatForFilename('a.markdown')).toBe('markdown');
    expect(importFormatForFilename('plain.txt')).toBe('text');
  });

  it('rejects legacy .doc, unknown extensions and missing names', () => {
    expect(importFormatForFilename('old.doc')).toBeNull();
    expect(importFormatForFilename('image.png')).toBeNull();
    expect(importFormatForFilename('noextension')).toBeNull();
    expect(importFormatForFilename(null)).toBeNull();
  });

  it('builds an accept attribute from the same list the server uses', () => {
    expect(IMPORT_ACCEPT).toBe(IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(','));
    expect(IMPORT_ACCEPT).toContain('.pdf');
    expect(IMPORT_ACCEPT).toContain('.docx');
  });

  it('derives a safe display title from a path', () => {
    expect(importTitleFromFilename('C:\\Users\\me\\My Report.pdf')).toBe('My Report');
    expect(importTitleFromFilename('../../etc/passwd.txt')).toBe('passwd');
    expect(importTitleFromFilename('...txt')).toBe('Imported document');
    expect(importTitleFromFilename('\u0000\u0007.txt')).toBe('Imported document');
    expect(importTitleFromFilename(`${'x'.repeat(400)}.txt`).length).toBe(300);
  });

  it('formats byte counts for the dialog', () => {
    expect(formatImportBytes(512)).toBe('512 B');
    expect(formatImportBytes(2048)).toBe('2.0 KB');
    expect(formatImportBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatImportBytes(undefined)).toBe('0 B');
  });
});

describe('text extraction', () => {
  it('normalizes line endings and strips control characters', () => {
    expect(normalizeImportText('a\r\n\r\n\r\nb\u0000c')).toBe('a\n\nbc');
    expect(normalizeImportText('   ')).toBe('');
  });

  it('escapes HTML in plain text', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
    );
  });

  it('turns blank-line-separated text into paragraphs with hard breaks', () => {
    const html = textToHtml('first line\nsecond line\n\nnext <b>paragraph</b>');
    expect(html).toBe('<p>first line<br>second line</p><p>next &lt;b&gt;paragraph&lt;/b&gt;</p>');
  });

  it('decodes UTF-8 and BOM-marked UTF-16 text files', () => {
    expect(decodeText(bytes('héllo'))).toBe('héllo');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')]);
    expect(decodeText(utf16)).toBe('héllo');
  });

  it('disables raw HTML and images in Markdown', async () => {
    const html = await markdownToHtml(
      '# Title\n\n<script>alert(1)</script>\n\n![alt text](https://example.com/x.png)\n\n- one'
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: alt text]');
    expect(html).toContain('<li>one</li>');
  });
});

describe('format detection', () => {
  it('uses the extension when it is supported', () => {
    expect(detectImportFormat('a.txt', bytes('hello'))).toBe('text');
    expect(detectImportFormat('a.pdf', Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
    expect(detectImportFormat('a.docx', Buffer.from([0x50, 0x4b, 3, 4]))).toBe('docx');
  });

  it('rejects a renamed binary masquerading as a PDF or DOCX', () => {
    expect(() => detectImportFormat('a.pdf', bytes('not a pdf'))).toThrow(ImportError);
    expect(() => detectImportFormat('a.docx', bytes('not a zip'))).toThrow(ImportError);
  });

  it('rejects a binary file renamed to .txt but accepts UTF-16 text', () => {
    expect(() =>
      detectImportFormat('a.txt', Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x04]))
    ).toThrow(/text document/);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')]);
    expect(detectImportFormat('a.txt', utf16)).toBe('text');
  });

  it('sniffs files with no extension', () => {
    expect(detectImportFormat('upload', Buffer.from('%PDF-1.4'))).toBe('pdf');
    expect(detectImportFormat('upload', Buffer.from([0x50, 0x4b, 3, 4]))).toBe('docx');
    expect(detectImportFormat('upload', bytes('plain text'))).toBe('text');
  });

  it('gives legacy .doc a specific message', () => {
    expect(() => detectImportFormat('old.doc', bytes('x'))).toThrow(/Save the document as \.docx/);
  });
});

describe('extractImport', () => {
  it('extracts a text file to paragraphs', async () => {
    const result = await extractImport({ filename: 'notes.txt', buffer: bytes('hello\n\nworld') });
    expect(result).toMatchObject({ format: 'text', warnings: 0 });
    expect(result.html).toBe('<p>hello</p><p>world</p>');
  });

  it('rejects an empty file and a file with no readable text', async () => {
    await expect(extractImport({ filename: 'empty.txt', buffer: Buffer.alloc(0) })).rejects.toThrow(
      /empty/i
    );
    await expect(
      extractImport({ filename: 'blank.txt', buffer: bytes('  \n\n ') })
    ).rejects.toThrow(/no readable text/i);
  });

  it('extracts a real PDF', async () => {
    const path = fileURLToPath(
      new URL('../RAG/data/pdf_data/DIP_Important_Questions.pdf', import.meta.url)
    );
    const buffer = await readFile(path);
    const result = await extractImport({ filename: 'questions.pdf', buffer });
    expect(result.format).toBe('pdf');
    expect(result.html).toContain('<p>');
    expect(result.html).toContain('Digital Image Processing');
  }, 30_000);
});

describe('HTML to Yjs snapshot', () => {
  it('builds a snapshot the editor can render', async () => {
    const { snapshot, stateVector, json } = await htmlToYjsSnapshot(
      '<h1>Title</h1><p>Body <strong>bold</strong></p><ul><li>one</li></ul>' +
        '<table><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table>'
    );

    expect(stateVector.length).toBeGreaterThan(0);
    const html = await yUpdateToHtml(snapshot);
    expect(html).toContain('Title');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('one');
    expect(html).toContain('<li>');
    expect(html).toContain('A');
    expect(documentTextLength(json)).toBeGreaterThan(0);

    // The snapshot must load back into a Y.Doc, which is what the sync service does.
    const restored = docFromSnapshot(snapshot);
    expect(restored).toBeTruthy();
    restored.destroy();
  }, 30_000);

  it('drops images and falls back to an empty paragraph', async () => {
    const withImage = await htmlToYjsSnapshot('<p>x</p><img src="https://example.com/a.png" alt="a">');
    expect(await yUpdateToHtml(withImage.snapshot)).not.toContain('<img');

    const empty = await htmlToYjsSnapshot('');
    expect(empty.json).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(await yUpdateToHtml(empty.snapshot)).toBe('<p></p>');
  }, 30_000);
});

describe('buildImportedDocument', () => {
  it('returns a title, snapshot and metadata for a text upload', async () => {
    const result = await buildImportedDocument({
      filename: 'C:\\tmp\\Quarterly Notes.txt',
      buffer: bytes('Alpha\n\nBeta'),
    });
    expect(result.title).toBe('Quarterly Notes');
    expect(result.format).toBe('text');
    expect(result.charCount).toBeGreaterThan(0);
    expect(await yUpdateToHtml(result.snapshot)).toContain('Alpha');
  }, 30_000);

  it('enforces the per-file size limit before parsing', async () => {
    const huge = { length: 21 * 1024 * 1024 };
    await expect(
      buildImportedDocument({ filename: 'huge.txt', buffer: huge })
    ).rejects.toThrow(/too large/i);
  });

  it('surfaces a friendly error for a corrupt DOCX', async () => {
    await expect(
      buildImportedDocument({ filename: 'bad.docx', buffer: Buffer.from([0x50, 0x4b, 3, 4]) })
    ).rejects.toThrow(/Could not read this DOCX/);
  });
});
