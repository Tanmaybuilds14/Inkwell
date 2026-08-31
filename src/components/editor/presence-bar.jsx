"use client";

import { cn } from "@/lib/utils";

export function PresenceBar({ peers }) {
  if (!peers || peers.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {peers.slice(0, 5).map((peer, i) => (
        <span
          key={`${peer.name}-${i}`}
          title={peer.name}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white"
          style={{
            background: peer.color ?? "#78716c",
          }}
        >
          {initials(peer.name)}
        </span>
      ))}
      {peers.length > 5 ? (
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-muted-foreground bg-secondary"
        >
          +{peers.length - 5}
        </span>
      ) : null}
    </div>
  );
}

function initials(name) {
  return (name ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
