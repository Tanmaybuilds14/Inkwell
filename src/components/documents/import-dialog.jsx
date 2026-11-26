"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { api } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  IMPORT_ACCEPT,
  IMPORT_LIMITS,
  formatImportBytes,
  importFormatForFilename,
} from "../../../shared/import-limits.js";

/**
 * Import local files as editable Inkwell documents.
 *
 * The picker validates before uploading so an obviously unsupported file never
 * costs a round trip, but the server re-validates everything — the client-side
 * check is a courtesy, not a security boundary. Results are per file: a batch
 * with one damaged PDF still imports the rest.
 */

const FORMAT_LABELS = {
  pdf: "PDF",
  docx: "DOCX",
  markdown: "Markdown",
  text: "Text",
};

function describeFile(file) {
  const format = importFormatForFilename(file.name);
  return format ? FORMAT_LABELS[format] ?? format.toUpperCase() : "Unsupported";
}

/** Reject what the API would reject anyway, with a reason next to the file. */
function validateFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    if (!importFormatForFilename(file.name)) {
      rejected.push({ name: file.name, error: "Only PDF, DOCX, TXT, and Markdown files can be imported." });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, error: "This file is empty." });
    } else if (file.size > IMPORT_LIMITS.maxFileBytes) {
      rejected.push({
        name: file.name,
        error: `This file is larger than ${Math.round(IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
      });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

export function ImportDialog({ open, onOpenChange, folderId = null, onImported }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const reset = useCallback(() => {
    setFiles([]);
    setRejected([]);
    setDragging(false);
    setBusy(false);
    setProgress(0);
    setResults(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const close = useCallback(() => {
    reset();
    onOpenChange?.(false);
  }, [reset, onOpenChange]);

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming ?? []);
    if (list.length === 0) return;
    setResults(null);

    const { accepted, rejected: invalid } = validateFiles(list);

    // De-duplicate by name + size + modified time: dragging the same file
    // twice should not import two identical documents.
    const seen = new Set(files.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
    const merged = [...files];
    const overflow = [];
    for (const file of accepted) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) continue;
      if (merged.length >= IMPORT_LIMITS.maxFiles) {
        overflow.push({
          name: file.name,
          error: `You can import at most ${IMPORT_LIMITS.maxFiles} files at once.`,
        });
        continue;
      }
      seen.add(key);
      merged.push(file);
    }

    setFiles(merged);
    setRejected([...invalid, ...overflow]);
  }, [files]);

  const removeFile = useCallback((index) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (files.length === 0 || busy) return;

    const form = new FormData();
    if (folderId) form.append("folderId", folderId);
    for (const file of files) form.append("files", file);

    setBusy(true);
    setProgress(0);
    setResults(null);

    // A plain fetch cannot report upload progress, so tick a coarse progress
    // indicator while the request is in flight. Extraction happens server-side
    // after the bytes arrive, which is why it never reaches 100% until done.
    const timer = setInterval(() => {
      setProgress((value) => (value >= 90 ? value : value + Math.max(1, Math.round((90 - value) / 8))));
    }, 250);

    try {
      const data = await api("/api/documents/import", { method: "POST", body: form });
      const imported = data.imported ?? [];
      const failed = data.failed ?? [];
      setResults({ imported, failed });

      if (imported.length > 0) onImported?.(imported);

      // Everything made it: no reason to keep the user staring at a summary.
      if (failed.length === 0) {
        close();
      } else {
        setFiles([]);
      }
    } catch (error) {
      setResults({ imported: [], failed: [{ name: "Upload", error: error.message }] });
    } finally {
      clearInterval(timer);
      setProgress(100);
      setBusy(false);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const resultCount = (results?.imported.length ?? 0) + (results?.failed.length ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange?.(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import documents</DialogTitle>
          <DialogDescription>
            Turn PDF, Word, text, or Markdown files into editable documents. Formatting is
            preserved where possible, and imported documents are searchable by Ask Inkwell.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose files to import"
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!busy) inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!busy) addFiles(event.dataTransfer?.files);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
              busy && "pointer-events-none opacity-60"
            )}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop files here, or <span className="text-primary underline underline-offset-2">browse</span>
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, DOCX, TXT, or Markdown · up to {IMPORT_LIMITS.maxFiles} files ·{" "}
              {Math.round(IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB each
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={IMPORT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files);
                // Allow picking the same file again after removing it.
                event.target.value = "";
              }}
            />
          </div>

          {files.length > 0 ? (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {files.map((file, index) => (
                <li key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{describeFile(file)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatImportBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    disabled={busy}
                    className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {rejected.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {rejected.map((item, index) => (
                <li key={`${item.name}:${index}`} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <span className="font-medium">{item.name}</span> — {item.error}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {results && resultCount > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
              {results.imported.length > 0 ? (
                <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Imported {results.imported.length} document{results.imported.length === 1 ? "" : "s"}.
                </p>
              ) : null}
              {results.failed.length > 0 ? (
                <ul className="flex flex-col gap-1 text-destructive">
                  {results.failed.map((item, index) => (
                    <li key={`${item.name}:${index}`} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        <span className="font-medium">{item.name}</span> — {item.error}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {busy ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <span>Converting…</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {files.length > 0
                ? `${files.length} file${files.length === 1 ? "" : "s"} · ${formatImportBytes(totalBytes)}`
                : "No files selected"}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || files.length === 0}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
