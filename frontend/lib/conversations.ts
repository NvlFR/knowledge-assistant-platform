export type KnowledgeSource = {
  source_file?: string;
  chunk_index?: number;
  similarity?: number;
  snippet?: string;
};

export type WebSource = {
  title?: string;
  url?: string;
  snippet?: string;
};

// One tool invocation in the assistant's reasoning timeline: the call and its result.
export type ToolStep = {
  name: string;
  kind?: "knowledge" | "database" | "web";
  arguments?: Record<string, unknown>;
  sql?: string;
  rowCount?: number;
  sources?: (KnowledgeSource & WebSource)[];
  error?: string;
  done?: boolean;
};

export type Phase = "planning" | "generating" | null;

export type Message = {
  role: "user" | "assistant";
  content: string;
  phase?: Phase;
  steps?: ToolStep[];
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "ka.conversations.v1";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function newConversation(): Conversation {
  const now = Date.now();
  return { id: uid(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    /* quota / private mode — ignore */
  }
}

// Derives a short title from the first user message.
export function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 40 ? `${text.slice(0, 40)}…` : text || "New chat";
}
