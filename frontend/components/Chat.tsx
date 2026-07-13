"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  BookOpen,
  Check,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authHeaders, logout } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { StatusBar } from "@/components/StatusBar";
import type { Dispatch as ReactDispatch } from "react";
import type { Message, Phase, ToolStep } from "@/lib/conversations";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4447";

// Maps a backend tool name to its editorial source label, icon + tone class.
const SOURCE_META: Record<
  string,
  { label: string; tone: string; Icon: typeof Globe }
> = {
  search_knowledge_base: { label: "Knowledge Base", tone: "text-src-kb", Icon: BookOpen },
  query_database: { label: "Business Database", tone: "text-src-db", Icon: Database },
  web_search: { label: "Open Web", tone: "text-src-web", Icon: Globe },
};

const KIND_BY_NAME: Record<string, ToolStep["kind"]> = {
  search_knowledge_base: "knowledge",
  query_database: "database",
  web_search: "web",
};

// The mode toggles above the composer. Deselecting one removes it from the
// tool set the backend hands to the model, so the choice is real, not cosmetic.
const TOOL_TOGGLES = [
  { name: "search_knowledge_base", label: "Knowledge", Icon: BookOpen, tone: "text-src-kb" },
  { name: "query_database", label: "Database", Icon: Database, tone: "text-src-db" },
  { name: "web_search", label: "Web", Icon: Globe, tone: "text-src-web" },
] as const;

const TOOLS_STORAGE_KEY = "ka.enabledTools.v1";
const ALL_TOOL_NAMES = TOOL_TOGGLES.map((t) => t.name);

function loadEnabledTools(): string[] {
  if (typeof window === "undefined") return [...ALL_TOOL_NAMES];
  try {
    const raw = window.localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return [...ALL_TOOL_NAMES];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? ALL_TOOL_NAMES.filter((n) => parsed.includes(n))
      : [...ALL_TOOL_NAMES];
  } catch {
    return [...ALL_TOOL_NAMES];
  }
}

// Applies a transform to the last (assistant) message immutably.
function patchLast(
  setMessages: ReactDispatch<SetStateAction<Message[]>>,
  fn: (m: Message) => Message,
) {
  setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    updated[updated.length - 1] = fn(updated[updated.length - 1]);
    return updated;
  });
}

const PROMPTS = [
  "How many days of annual leave do employees get?",
  "What were total sales in Jakarta last quarter?",
  "Summarise our onboarding SOP.",
  "What's the latest news on our industry?",
];

type ChatProps = {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  sidebarOpen?: boolean;
};

export default function Chat({ messages, setMessages, sidebarOpen = true }: ChatProps) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[]>([...ALL_TOOL_NAMES]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate the mode toggles from localStorage after mount (avoids SSR mismatch).
  useEffect(() => setEnabledTools(loadEnabledTools()), []);

  function toggleTool(name: string) {
    setEnabledTools((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name];
      try {
        window.localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, activeTool]);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function sendMessage(text?: string) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || isStreaming) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages([
      ...nextMessages,
      { role: "assistant", content: "", steps: [], phase: "planning" },
    ]);
    setInput("");
    setIsStreaming(true);
    setActiveTool(null);

    try {
      const response = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ messages: nextMessages, enabled_tools: enabledTools }),
      });

      if (response.status === 401) {
        logout();
        throw new Error("Session expired — please sign in again.");
      }
      if (!response.body) throw new Error("No response body from backend");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split(/\r\n\r\n|\n\n/);
        buffer = events.pop() || "";

        for (const rawEvent of events) {
          // An SSE event may span multiple `data:` lines; concatenate them.
          const data = rawEvent
            .split(/\r\n|\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("");
          if (!data) continue;
          const event = JSON.parse(data);

          if (event.type === "phase") {
            if (event.value === "generating") setActiveTool(null);
            patchLast(setMessages, (m) => ({ ...m, phase: event.value }));
          } else if (event.type === "tool_call") {
            setActiveTool(event.name);
            patchLast(setMessages, (m) => ({
              ...m,
              phase: null,
              steps: [
                ...(m.steps ?? []),
                {
                  name: event.name,
                  kind: KIND_BY_NAME[event.name],
                  arguments: event.arguments,
                  sql: event.arguments?.sql,
                },
              ],
            }));
          } else if (event.type === "tool_result") {
            patchLast(setMessages, (m) => {
              const steps = [...(m.steps ?? [])];
              // Attach the result to the most recent unfinished step of this tool.
              for (let i = steps.length - 1; i >= 0; i--) {
                if (steps[i].name === event.name && !steps[i].done) {
                  steps[i] = {
                    ...steps[i],
                    done: true,
                    kind: event.kind ?? steps[i].kind,
                    sources: event.sources,
                    rowCount: event.row_count,
                    sql: event.sql ?? steps[i].sql,
                    error: event.error,
                  };
                  break;
                }
              }
              return { ...m, steps };
            });
          } else if (event.type === "token") {
            setActiveTool(null);
            patchLast(setMessages, (m) => ({
              ...m,
              phase: null,
              content: m.content + event.content,
            }));
          } else if (event.type === "error") {
            patchLast(setMessages, (m) => ({
              ...m,
              phase: null,
              content: `⚠ ${event.content}`,
            }));
          }
        }
      }
    } catch (err) {
      patchLast(setMessages, (m) => ({
        ...m,
        phase: null,
        content: "⚠ Failed to reach the assistant backend.",
      }));
    } finally {
      setIsStreaming(false);
      setActiveTool(null);
    }
  }

  const isEmpty = messages.length === 0;

  const composer = (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-2 flex justify-center sm:justify-start">
        <StatusBar />
      </div>
      <div className="relative flex flex-col rounded-3xl border border-input bg-card shadow-sm transition-colors focus-within:border-muted-foreground/40">
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-[200px] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          placeholder={isStreaming ? "Routing your enquiry…" : "Ask anything…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          disabled={isStreaming}
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {TOOL_TOGGLES.map(({ name, label, Icon, tone }) => {
              const on = enabledTools.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTool(name)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                    on
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", on ? tone : "opacity-60")} />
                  {label}
                </button>
              );
            })}
          </div>
          <button
            aria-label="Send"
            onClick={() => sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Empty / landing state ─────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-14">
        <div className="rise w-full max-w-2xl text-center">
          <div className="mb-6">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            One desk for the whole company
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Ask a question it retrieves from the internal knowledge base, queries
            live business data, or searches the open web, and shows you exactly which
            source it used.
          </p>

          <div className="mt-8">{composer}</div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => sendMessage(p)}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Conversation state ────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto pt-20 pb-40">
        <div className="mx-auto flex max-w-2xl flex-col gap-10 px-4">
          {messages.map((message, idx) => {
            const isLast = idx === messages.length - 1;
            const streamingThis = isStreaming && isLast && message.role === "assistant";

            if (message.role === "user") {
              return (
                <div key={idx} className="rise flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">
                    {message.content}
                  </div>
                </div>
              );
            }

            const steps = message.steps ?? [];
            const livePhase = streamingThis ? message.phase ?? null : null;
            const showTimeline = steps.length > 0 || livePhase !== null;

            return (
              <article key={idx} className="rise flex flex-col gap-3">
                {showTimeline && <ReasoningTimeline steps={steps} phase={livePhase} />}

                <div className="flex justify-start gap-3">
                  <Image
                    src="/ai-logo-purple.png"
                    alt="Assistant"
                    width={28}
                    height={28}
                    className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-contain"
                  />
                  <div className="min-w-0 max-w-[85%] flex-1">
                    {message.content ? (
                      <div className="prose-answer rounded-2xl rounded-tl-md bg-muted px-4 py-3 text-[15px] text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                        {streamingThis && (
                          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-foreground align-middle [animation:caret-blink_1s_steps(1)_infinite]" />
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                {message.content && <CitationsPanel steps={steps} />}
              </article>
            );
          })}
        </div>
      </div>

      {/* Sticky composer */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background to-transparent px-4 pb-5 pt-8 transition-[left] duration-200",
          sidebarOpen && "md:left-72",
        )}
      >
        {composer}
      </div>
    </div>
  );
}

// ── Reasoning timeline: shows the planner's tool choices as they happen ──────
function ReasoningTimeline({ steps, phase }: { steps: ToolStep[]; phase: Phase }) {
  const liveLabel =
    phase === "planning"
      ? "Planning…"
      : phase === "generating"
        ? "Generating answer…"
        : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 text-[13px]">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Reasoning
      </div>
      {steps.map((step, i) => (
        <TimelineStep key={i} step={step} />
      ))}
      {liveLabel && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{liveLabel}</span>
        </div>
      )}
    </div>
  );
}

function TimelineStep({ step }: { step: ToolStep }) {
  const meta = SOURCE_META[step.name] ?? {
    label: step.name,
    tone: "text-muted-foreground",
    Icon: Wrench,
  };
  const { Icon } = meta;
  const verb = step.kind === "database" ? "Querying" : "Searching";

  let detail: string | null = null;
  if (step.error) detail = "failed";
  else if (step.kind === "database" && step.rowCount != null)
    detail = `${step.rowCount} row${step.rowCount === 1 ? "" : "s"}`;
  else if (step.sources?.length) detail = `${step.sources.length} sources`;

  return (
    <div className="flex items-center gap-2">
      {step.done ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
      <span className="text-foreground">
        {verb} {meta.label}
      </span>
      {detail && (
        <span className={cn("text-muted-foreground", step.error && "text-destructive")}>
          · {detail}
        </span>
      )}
    </div>
  );
}

// ── Citations: the actual sources behind the answer (real RAG evidence) ──────
function CitationsPanel({ steps }: { steps: ToolStep[] }) {
  const knowledge = steps
    .filter((s) => s.kind === "knowledge")
    .flatMap((s) => s.sources ?? []);
  const web = steps.filter((s) => s.kind === "web").flatMap((s) => s.sources ?? []);
  const db = steps.filter((s) => s.kind === "database");

  if (knowledge.length === 0 && web.length === 0 && db.length === 0) return null;

  return (
    <div className="ml-10 flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <BookOpen className="h-3 w-3" />
        References
      </div>

      {db.map((s, i) => (
        <div key={`db-${i}`} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-src-db">
            <Database className="h-3.5 w-3.5" />
            PostgreSQL
            {s.rowCount != null && (
              <span className="text-muted-foreground">· {s.rowCount} rows</span>
            )}
          </div>
          {s.sql && (
            <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
              {s.sql}
            </pre>
          )}
        </div>
      ))}

      {knowledge.map((s, i) => (
        <div
          key={`kb-${i}`}
          className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-src-kb">
              <BookOpen className="h-3.5 w-3.5" />
              {s.source_file}
              {s.chunk_index != null && (
                <span className="font-normal text-muted-foreground">
                  · chunk {s.chunk_index}
                </span>
              )}
            </span>
            {typeof s.similarity === "number" && (
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {(s.similarity * 100).toFixed(0)}% match
              </span>
            )}
          </div>
          {s.snippet && (
            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {s.snippet}
            </p>
          )}
        </div>
      ))}

      {web.map((s, i) => (
        <a
          key={`web-${i}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col gap-0.5 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-src-web">
            <Globe className="h-3.5 w-3.5" />
            <span className="truncate">{s.title || s.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          {s.snippet && (
            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {s.snippet}
            </p>
          )}
        </a>
      ))}
    </div>
  );
}
