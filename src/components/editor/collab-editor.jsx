"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { AuthorshipUnderlines } from "@/components/editor/authorship";
import { SlashCommand } from "@/components/editor/slash-command";
import { MentionNode, MentionSuggestions, filterMentionItems } from "@/components/editor/mention";
import { api } from "@/components/app-header";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Table as TableIcon,
  Minus,
  ImagePlus,
  CodeSquare,
  Pilcrow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

const ROLE_LABELS = {
  OWNER: "owner",
  EDITOR: "editor",
  COMMENTER: "commenter",
  VIEWER: "viewer",
};

export function CollabEditor({ documentId, ydoc, provider, role, presence }) {
  const providerReady = !!provider;
  const canEdit = role === "OWNER" || role === "EDITOR";

  // Slash-menu state, driven by the SlashCommand extension's callbacks.
  // Mirrored into slashRef because editorProps.handleKeyDown is created once
  // (stale closure otherwise) and must read the *current* menu state.
  const [slash, setSlash] = useState(null); // { items, selectedIndex, clientRect }
  const slashRef = useRef(null);
  const updateSlash = useCallback((updater) => {
    setSlash((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      slashRef.current = next;
      return next;
    });
  }, []);
  // The live Suggestion callback bundle ({ editor, range, items, clientRect,
  // command }); items' commands need it to delete the "/query" text.
  const suggestionRef = useRef(null);

  // Mention menu state, mirroring the slash menu's shape. The roster arrives
  // after mount (it is a request), so it lives in a ref: the suggestion reads
  // it on the next keystroke rather than being frozen at configure() time.
  const peopleRef = useRef([]);
  const [mention, setMention] = useState(null); // { items, selectedIndex, clientRect }
  const mentionRef = useRef(null);
  const updateMention = useCallback((updater) => {
    setMention((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      mentionRef.current = next;
      return next;
    });
  }, []);
  // The live Suggestion callback bundle for the open "@" menu; applying an
  // item needs it to replace the "/query" range with the mention node.
  const mentionSuggestionRef = useRef(null);

  const applyMentionItem = useCallback(
    (person) => {
      const props = mentionSuggestionRef.current;
      if (props && person) {
        props.command({ id: person.id, label: person.name });
      }
      updateMention(null);
    },
    [updateMention]
  );

  /**
   * Notify someone they were mentioned. Fire-and-forget by design: the mention
   * is already in the document, the API validates that the person can see it,
   * and a failed notification must never surface as an error in the editor of
   * whoever typed it.
   */
  const notifyMention = useCallback(
    (person) => {
      if (!person?.id) return;
      api(`/api/documents/${documentId}/mentions`, {
        method: "POST",
        body: JSON.stringify({ userIds: [person.id] }),
      }).catch(() => {});
    },
    [documentId]
  );

  // Mentionable people, fetched once per document. Editors only — a read-only
  // viewer has no menu to fill.
  useEffect(() => {
    if (!canEdit) return undefined;
    let cancelled = false;
    api(`/api/documents/${documentId}/mentions`)
      .then((data) => {
        if (!cancelled) peopleRef.current = data.people ?? [];
      })
      .catch(() => {
        // An unfetched roster is an empty menu, not a broken editor: everything
        // else keeps working, so this is not worth interrupting anyone over.
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, canEdit]);

  const applySlashItem = useCallback(
    (item) => {
      const props = suggestionRef.current;
      if (props && item) {
        item.command({ editor: props.editor, range: props.range, props });
      }
      updateSlash(null);
    },
    [updateSlash]
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          // The lowlight variant replaces the plain code block (both register
          // the "codeBlock" node name — registering both would throw).
          codeBlock: false,
        }),
        Placeholder.configure({
          placeholder: canEdit
            ? "Start writing — everything syncs in real time…"
            : "You have read-only access to this document.",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({ inline: false, allowBase64: true }),
        CodeBlockLowlight.configure({ lowlight }),
        // Unconditional, unlike the suggestion below it: a viewer who can never
        // insert a mention must still be able to *render* one. A node type the
        // schema does not know would make the whole document fail to load.
        MentionNode,
        // Collaboration binds to the ydoc unconditionally (when we have one):
        // the socket drops long before the network does — during a reconnect
        // or while the browser is offline — and unmounting the content then
        // would make offline editing impossible. Offline keystrokes land in
        // the ydoc, persist to IndexedDB (see editor-client), and Yjs merges
        // the delta with the server copy when the provider returns.
        // Caret and authorship need live awareness, so they stay provider-bound.
        ...(ydoc
          ? [
              Collaboration.configure({ document: ydoc }),
              ...(providerReady
                ? [
                    CollaborationCaret.configure({
                      provider,
                      // editor-client owns the identity (see the presence effect there):
                      // the Inkwell display name when it is known, a colour-only state
                      // until it isn't. Never a placeholder — peers see it verbatim.
                      user: presence ?? { color: "#44403c" },
                    }),
                    AuthorshipUnderlines.configure({ awareness: provider?.awareness }),
                  ]
                : []),
            ]
          : []),
        ...(canEdit
          ? [
              // The suggestion callbacks below touch refs, but only when the
              // plugin invokes them at editor runtime (on "@" typed, on keys)
              // — never during React render. The lint rule can't see that
              // distinction, hence the disable.
              // eslint-disable-next-line react-hooks/refs
              MentionSuggestions.configure({
                // Reading peopleRef inside items() rather than passing the
                // array is what lets the roster land after the editor mounts.
                items: (query) => filterMentionItems(peopleRef.current, query),
                onMention: notifyMention,
                render: () => ({
                  onStart: (props) => {
                    mentionSuggestionRef.current = props;
                    updateMention({
                      items: props.items,
                      selectedIndex: 0,
                      clientRect: props.clientRect?.() ?? null,
                    });
                  },
                  onUpdate: (props) => {
                    mentionSuggestionRef.current = props;
                    updateMention((prev) => ({
                      items: props.items,
                      selectedIndex: Math.min(
                        prev?.selectedIndex ?? 0,
                        Math.max(props.items.length - 1, 0)
                      ),
                      clientRect: props.clientRect?.() ?? null,
                    }));
                  },
                  onExit: () => {
                    mentionSuggestionRef.current = null;
                    updateMention(null);
                  },
                  // Suggestion delegates every key but Escape to the renderer
                  // (Escape it clears itself), so the menu owns its own
                  // navigation instead of sharing the editor-level handler
                  // the slash menu uses.
                  onKeyDown: (props) => {
                    const current = mentionRef.current;
                    const items = current?.items ?? [];
                    if (!items.length) return false;
                    const { event } = props;
                    if (event.key === "ArrowDown") {
                      updateMention((prev) => ({
                        ...prev,
                        selectedIndex: ((prev?.selectedIndex ?? 0) + 1) % items.length,
                      }));
                      return true;
                    }
                    if (event.key === "ArrowUp") {
                      updateMention((prev) => ({
                        ...prev,
                        selectedIndex:
                          ((prev?.selectedIndex ?? 0) - 1 + items.length) % items.length,
                      }));
                      return true;
                    }
                    if (event.key === "Enter") {
                      applyMentionItem(items[current?.selectedIndex ?? 0]);
                      return true;
                    }
                    return false;
                  },
                }),
              }),
              // The suggestion callbacks below touch refs, but only when the
              // plugin invokes them at editor runtime (on "/" typed, on keys)
              // — never during React render. The lint rule can't see that
              // distinction, hence the disable.
              // eslint-disable-next-line react-hooks/refs
              SlashCommand.configure({
                suggestion: {
                  items: ({ query, items, editor, range, clientRect }) => {
                    suggestionRef.current = { editor, range };
                    updateSlash((prev) => ({
                      ...(prev ?? { selectedIndex: 0, clientRect: null }),
                      items,
                      query,
                    }));
                    return items;
                  },
                  render: () => ({
                    onStart: (props) => {
                      suggestionRef.current = { editor: props.editor, range: props.range, command: props.command };
                      updateSlash({
                        items: props.items,
                        selectedIndex: 0,
                        clientRect: props.clientRect?.() ?? null,
                      });
                    },
                    onUpdate: (props) => {
                      suggestionRef.current = { editor: props.editor, range: props.range, command: props.command };
                      updateSlash((prev) => ({
                        items: props.items,
                        query: props.query,
                        selectedIndex: Math.min(prev?.selectedIndex ?? 0, Math.max(props.items.length - 1, 0)),
                        clientRect: props.clientRect?.() ?? null,
                      }));
                    },
                    onExit: () => {
                      suggestionRef.current = null;
                      updateSlash(null);
                    },
                  }),
                },
              }),
            ]
          : []),
      ],
      editable: canEdit,
      editorProps: {
        attributes: {
          class: "inkwell-editor focus:outline-none",
        },
        handleKeyDown: (view, event) => {
          const current = slashRef.current;
          if (!current || !current.items?.length) return false;
          const { selectedIndex, items } = current;
          if (event.key === "ArrowDown") {
            updateSlash((prev) => ({ ...prev, selectedIndex: (selectedIndex + 1) % items.length }));
            return true;
          }
          if (event.key === "ArrowUp") {
            updateSlash((prev) => ({ ...prev, selectedIndex: (selectedIndex - 1 + items.length) % items.length }));
            return true;
          }
          if (event.key === "Enter") {
            applySlashItem(items[selectedIndex]);
            return true;
          }
          if (event.key === "Escape") {
            updateSlash(null);
            return false; // let the editor also blur the suggestion
          }
          return false;
        },
      },
    },
    [provider]
  );

  if (!editor) {
    return (
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    );
  }

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between">
        <Toolbar editor={editor} canEdit={canEdit} />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          you are {ROLE_LABELS[role] ?? role}
        </span>
      </div>
      <EditorContent editor={editor} className="inkwell-editor" data-document-id={documentId} />
      {slash && slash.items?.length > 0 && canEdit ? (
        <SlashMenu
          items={slash.items}
          selectedIndex={slash.selectedIndex ?? 0}
          clientRect={slash.clientRect}
          onApply={applySlashItem}
          editor={editor}
        />
      ) : null}
      {mention && mention.items?.length > 0 && canEdit ? (
        <MentionMenu
          items={mention.items}
          selectedIndex={mention.selectedIndex ?? 0}
          clientRect={mention.clientRect}
          onApply={applyMentionItem}
        />
      ) : null}
    </div>
  );
}

/**
 * The floating "/" menu. Positioned from the suggestion's clientRect (viewport
 * coordinates) inside an absolutely-positioned wrapper relative to the editor
 * container; opens *below* the cursor so it never covers the line being typed.
 */
function SlashMenu({ items, selectedIndex, clientRect, onApply }) {
  const listRef = useRef(null);
  const containerRef = useRef(null);

  // Keep the highlighted item scrolled into view on arrow-key navigation.
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!clientRect) return null;
  const style = {
    left: clientRect.left,
    top: clientRect.bottom + 6,
  };

  // Group items for section headers while preserving rank order.
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  let flatIndex = -1;

  return (
    <div ref={containerRef} style={style} className="absolute z-50">
      <div
        className="max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        role="listbox"
        aria-label="Insert blocks"
      >
        {groups.map((g) => (
          <div key={g.group}>
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {g.group}
            </p>
            {g.items.map((item) => {
              flatIndex += 1;
              const idx = flatIndex;
              const selected = idx === selectedIndex;
              return (
                <button
                  key={item.title}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  ref={selected ? listRef : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                    selected ? "bg-accent" : "hover:bg-accent/60"
                  )}
                  onMouseDown={(e) => {
                    // mousedown, not click: the editor would blur first and
                    // destroy the suggestion state before onClick fires.
                    e.preventDefault();
                    onApply(item);
                  }}
                >
                  <SlashItemIcon icon={item.icon} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The floating "@" menu. Same anchoring as the slash menu (viewport rect from
 * the suggestion, offset below the line being typed) but much smaller: it is a
 * people picker, so it is a list of names and nothing else.
 */
function MentionMenu({ items, selectedIndex, clientRect, onApply }) {
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!clientRect) return null;

  return (
    <div
      style={{ left: clientRect.left, top: clientRect.bottom + 6 }}
      className="absolute z-50"
    >
      <div
        className="max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        role="listbox"
        aria-label="Mention a collaborator"
      >
        {items.map((person, index) => (
          <button
            key={person.id}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            ref={index === selectedIndex ? listRef : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
              index === selectedIndex ? "bg-accent" : "hover:bg-accent/60"
            )}
            onMouseDown={(e) => {
              // mousedown, not click: the editor would blur first and destroy
              // the suggestion state before onClick fires.
              e.preventDefault();
              onApply(person);
            }}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">
              {initials(person.name)}
            </span>
            <span className="min-w-0 truncate text-sm">{person.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two initials at most — the same convention as the avatar circles. */
function initials(name) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function SlashItemIcon({ icon }) {
  const cls = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground";
  const size = "h-4 w-4";
  switch (icon) {
    case "h1": return <span className={cn(cls, "text-xs font-bold")}>H1</span>;
    case "h2": return <span className={cn(cls, "text-xs font-bold")}>H2</span>;
    case "h3": return <span className={cn(cls, "text-xs font-bold")}>H3</span>;
    case "list": return <span className={cls}><List className={size} /></span>;
    case "list-ordered": return <span className={cls}><ListOrdered className={size} /></span>;
    case "check-square": return <span className={cls}><ListTodo className={size} /></span>;
    case "quote": return <span className={cls}><Quote className={size} /></span>;
    case "code": return <span className={cls}><Code className={size} /></span>;
    case "table": return <span className={cls}><TableIcon className={size} /></span>;
    case "minus": return <span className={cls}><Minus className={size} /></span>;
    case "image": return <span className={cls}><ImagePlus className={size} /></span>;
    default: return <span className={cls}><Pilcrow className={size} /></span>;
  }
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
      <ToolbarButton title="To-do list" onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")}>
        <ListTodo className="h-4 w-4" />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton title="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
        <CodeSquare className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        active={editor.isActive("table")}
      >
        <TableIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()} active={editor.isActive("horizontalRule")}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        title="Image from URL"
        onClick={() => {
          const url = window.prompt("Image URL");
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
        active={editor.isActive("image")}
      >
        <ImagePlus className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
