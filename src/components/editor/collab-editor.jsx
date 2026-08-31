"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ROLE_LABELS = {
  OWNER: "owner",
  EDITOR: "editor",
  COMMENTER: "commenter",
  VIEWER: "viewer",
};

export function CollabEditor({ documentId, ydoc, getProvider, role }) {
  const [providerReady, setProviderReady] = useState(false);
  const canEdit = role === "OWNER" || role === "EDITOR";

  useEffect(() => {
    const t = setInterval(() => {
      if (getProvider()) {
        setProviderReady(true);
        clearInterval(t);
      }
    }, 50);
    return () => clearInterval(t);
  }, [getProvider]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({
          placeholder: canEdit
            ? "Start writing — everything syncs in real time…"
            : "You have read-only access to this document.",
        }),
        ...(providerReady && ydoc
          ? [
              Collaboration.configure({ document: ydoc }),
              CollaborationCaret.configure({
                provider: getProvider(),
                user: getProvider()?.awareness?.getLocalState()?.user ?? { name: "You", color: "#44403c" },
              }),
            ]
          : []),
      ],
      editable: canEdit,
      editorProps: {
        attributes: {
          class: "inkwell-editor focus:outline-none",
        },
      },
    },
    [providerReady]
  );

  if (!editor) {
    return (
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Toolbar editor={editor} canEdit={canEdit} />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          you are {ROLE_LABELS[role] ?? role}
        </span>
      </div>
      <EditorContent editor={editor} className="inkwell-editor" data-document-id={documentId} />
    </div>
  );
}

function ToolbarButton({ onClick, active, disabled, children, title }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn("h-8 w-8", active && "bg-primary/10 text-primary")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function Toolbar({ editor, canEdit }) {
  if (!canEdit) return <span />;
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1">
      <ToolbarButton title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton title="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}>
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
        <Code className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
