"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import Chat from "@/components/Chat";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  type Conversation,
  type Message,
  deriveTitle,
  loadConversations,
  newConversation,
  saveConversations,
} from "@/lib/conversations";

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Load persisted conversations on mount (client only).
  useEffect(() => {
    const loaded = loadConversations();
    if (loaded.length > 0) {
      setConversations(loaded);
      setActiveId(loaded[0].id);
    } else {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    }

    // Default the sidebar open on desktop, collapsed on mobile — unless the
    // user has a persisted preference.
    const saved = window.localStorage.getItem("ka.sidebarOpen");
    setSidebarOpen(saved != null ? saved === "1" : window.innerWidth >= 768);
    setHydrated(true);
  }, []);

  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("ka.sidebarOpen", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Persist whenever conversations change (after hydration).
  useEffect(() => {
    if (hydrated) saveConversations(conversations);
  }, [conversations, hydrated]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Controlled messages bridge: writes flow back into the active conversation,
  // keeping the title in sync with the first user message.
  const setMessages: Dispatch<SetStateAction<Message[]>> = (update) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const nextMessages =
          typeof update === "function"
            ? (update as (m: Message[]) => Message[])(c.messages)
            : update;
        return {
          ...c,
          messages: nextMessages,
          title: c.title === "New chat" ? deriveTitle(nextMessages) : c.title,
          updatedAt: Date.now(),
        };
      }),
    );
  };

  function handleNew() {
    // Reuse an existing empty conversation instead of piling up blanks.
    const empty = conversations.find((c) => c.messages.length === 0);
    if (empty) {
      setActiveId(empty.id);
    } else {
      const fresh = newConversation();
      setConversations((prev) => [fresh, ...prev]);
      setActiveId(fresh.id);
    }
    setSidebarOpen(false);
  }

  function handleSelect(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
  }

  function handleDelete(id: string) {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = newConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onClose={toggleSidebar}
      />

      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col transition-[padding] duration-200",
          sidebarOpen && "md:pl-72",
        )}
      >
        {/* Top bar */}
        <header
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-gradient-to-b from-background via-background/85 to-transparent px-3 transition-[left] duration-200",
            sidebarOpen && "md:left-72",
          )}
        >
          <div className="flex items-center gap-1">
            <button
              aria-label="Toggle sidebar"
              onClick={toggleSidebar}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="h-[18px] w-[18px]" />
            </button>
            <span className="flex items-center pl-1">
              <BrandLogo size="sm" />
            </span>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col">
          <Chat
            key={activeId ?? "none"}
            messages={active?.messages ?? []}
            setMessages={setMessages}
            sidebarOpen={sidebarOpen}
          />
        </main>
      </div>
    </div>
  );
}
