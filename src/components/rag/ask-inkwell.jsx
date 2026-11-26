"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatPanel } from "@/components/rag/chat-panel";
import { cn } from "@/lib/utils";

/**
 * The entry point (PLAN §9.1): a button that opens the chat as a right-hand
 * sheet, used by the dashboard header ("All my documents") and the editor
 * ("This document"). Header follows the Version history panel's pattern.
 */
export function AskInkwell({
  documentId = null,
  folderId = null,
  label = "Ask Inkwell",
  variant = "outline",
  size = "sm",
  className,
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant={variant} size={size} className={cn(className)}>
          <Sparkles className="h-4 w-4" />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent className="left-auto right-0 w-full max-w-md border-l border-r-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3 pr-12">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Ask Inkwell
          </SheetTitle>
        </SheetHeader>
        <ChatPanel documentId={documentId} folderId={folderId} />
      </SheetContent>
    </Sheet>
  );
}
