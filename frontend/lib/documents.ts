import { authFetch } from "@/lib/auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4447";

export type KbDocument = {
  source_file: string;
  chunks: number;
  updated_at?: string;
};

export async function fetchDocuments(): Promise<KbDocument[]> {
  const res = await authFetch(`${BACKEND_URL}/documents`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load documents");
  const data = await res.json();
  return (data.documents ?? []) as KbDocument[];
}

export async function uploadDocument(
  file: File,
): Promise<{ filename: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(`${BACKEND_URL}/documents`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = "Upload failed";
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}
