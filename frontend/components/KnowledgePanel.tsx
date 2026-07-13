"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { type KbDocument, fetchDocuments, uploadDocument } from "@/lib/documents";
import { cn } from "@/lib/utils";

const ACCEPT = ".md,.txt,.pdf";

export function KnowledgePanel() {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const list = await fetchDocuments();
      setDocs(list);
      // Drop any pending file that has now shown up as ingested.
      setPending((p) => p.filter((name) => !list.some((d) => d.source_file === name)));
    } catch {
      /* backend offline — leave list as-is */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // While something is ingesting, poll until it lands in the index.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [pending]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const { filename } = await uploadDocument(file);
      setPending((p) => (p.includes(filename) ? p : [...p, filename]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Knowledge Base
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onFile}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload
        </button>
      </div>

      {error && <p className="mb-2 text-[11.5px] text-destructive">{error}</p>}

      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        {pending.map((name) => (
          <li
            key={`pending-${name}`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{name}</span>
            <span className="ml-auto shrink-0 text-[10.5px]">indexing…</span>
          </li>
        ))}

        {docs.map((d) => (
          <li
            key={d.source_file}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground/90"
          >
            <FileText className={cn("h-3.5 w-3.5 shrink-0", suffixTone(d.source_file))} />
            <span className="truncate">{d.source_file}</span>
            <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
              {d.chunks} chunks
            </span>
          </li>
        ))}

        {docs.length === 0 && pending.length === 0 && (
          <li className="px-2 py-2 text-[12px] text-muted-foreground">
            No documents indexed yet
          </li>
        )}
      </ul>
    </div>
  );
}

function suffixTone(name: string): string {
  if (name.endsWith(".pdf")) return "text-src-web";
  if (name.endsWith(".txt")) return "text-src-db";
  return "text-src-kb";
}
