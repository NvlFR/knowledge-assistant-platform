"use client";

import { useEffect, useState } from "react";
import { BookOpen, Database, Globe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4447";

type Status = {
  knowledge: { connected: boolean; documents: number | null };
  database: { connected: boolean };
  web: { ready: boolean };
  cache: { connected: boolean };
};

export function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${BACKEND_URL}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as Status;
        if (!cancelled) {
          setStatus(data);
          setOffline(false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    }

    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (offline) {
    return (
      <div className="flex items-center gap-1.5 px-1 text-[11.5px] text-muted-foreground">
        <Dot ok={false} />
        Backend offline
      </div>
    );
  }

  if (!status) return <div className="h-[18px]" />;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-muted-foreground">
      <Item
        Icon={BookOpen}
        ok={status.knowledge.connected}
        label={
          status.knowledge.documents != null
            ? `${status.knowledge.documents} docs`
            : "Knowledge"
        }
      />
      <Item Icon={Database} ok={status.database.connected} label="Database" />
      <Item Icon={Globe} ok={status.web.ready} label="Web" />
      <Item Icon={Zap} ok={status.cache.connected} label="Cache" />
    </div>
  );
}

function Item({
  Icon,
  ok,
  label,
}: {
  Icon: typeof BookOpen;
  ok: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Dot ok={ok} />
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        ok ? "bg-emerald-500" : "bg-muted-foreground/40",
      )}
    />
  );
}
