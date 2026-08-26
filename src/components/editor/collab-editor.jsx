"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

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
        // CRDT owns history — local undo stack must be off.
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
                user: getProvider()?.awareness?.getLocalState()?.user ?? { name: "You", color: "#0f766e" },
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
      <div className="h-64 animate-pulse rounded-lg" style={{ background: "var(--inkwell-accent-soft)" }} />
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Toolbar editor={editor} canEdit={canEdit} />
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--inkwell-muted)" }}>
          you are {ROLE_LABELS[role] ?? role}
        </span>
      </div>
      <EditorContent editor={editor} className="inkwell-editor" data-document-id={documentId} />
    </div>
  );
}

function ToolbarButton({ onClick, active, disabled, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2 py-1 text-sm ${active ? "font-bold" : ""}`}
      style={{
        background: active ? "var(--inkwell-accent-soft)" : "transparent",
        color: active ? "var(--inkwell-accent)" : "inherit",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, canEdit }) {
  if (!canEdit) return <span />;
  return (
    <div className="flex items-center gap-0.5">
      <ToolbarButton title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
        B
      </ToolbarButton>
      <ToolbarButton title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Strike" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
        <s>S</s>
      </ToolbarButton>
      <span className="mx-1 h-5 w-px" style={{ background: "var(--inkwell-line)" }} />
      <ToolbarButton title="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}>
        H1
      </ToolbarButton>
      <ToolbarButton title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
        H2
      </ToolbarButton>
      <ToolbarButton title="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
        H3
      </ToolbarButton>
      <span className="mx-1 h-5 w-px" style={{ background: "var(--inkwell-line)" }} />
      <ToolbarButton title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
        •≡
      </ToolbarButton>
      <ToolbarButton title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        1≡
      </ToolbarButton>
      <ToolbarButton title="Blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        ❝
      </ToolbarButton>
      <ToolbarButton title="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
        {"</>"}
      </ToolbarButton>
    </div>
  );
}
