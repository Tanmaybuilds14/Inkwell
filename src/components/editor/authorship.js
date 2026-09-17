"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ySyncPluginKey, relativePositionToAbsolutePosition } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { collectAuthorRuns } from "./authorship-runs";

/**
 * Per-user authorship underlines for the collab editor.
 *
 * Every Yjs item carries `item.id.client` — the clientID of whoever typed
 * it — which equals the awareness clientID, so runs map to the peer's
 * assigned presence color. Offline merges never rewrite item origins, so
 * authorship survives sync/merge.
 *
 * Rendering: a ProseMirror plugin holding a DecorationSet of inline
 * decorations (`author-underline` + inline text-decoration-color), rebuilt
 * by scanning the Y fragment. Y → PM positions use relative positions
 * anchored in the run's own parent type, so they resolve through y-tiptap's
 * mapping and survive concurrent edits between scan and render.
 *
 * Redraws: on init, on awareness changes (peers join/leave/recolor), on any
 * doc change (throttled) — remote edits add other-client runs, local typing
 * picks up its own underline shortly after.
 */

export const authorshipKey = new PluginKey("inkwellAuthorship");

const REDRAW_THROTTLE_MS = 300;
const DEFAULT_COLOR = "#a8a29e"; // muted stone — authors not in awareness anymore

function computeDecorations(state, ctx) {
  const ystate = ySyncPluginKey.getState(state);
  if (!ystate || !ystate.doc || !ystate.type || !ystate.binding) {
    return DecorationSet.empty;
  }

  // Refresh clientId → user; peers that left keep their last color so their
  // existing underlines stay attributed.
  for (const [clientId, aw] of ctx.awareness.getStates()) {
    if (aw && aw.user) ctx.userCache.set(clientId, aw.user);
  }

  const { runs } = collectAuthorRuns(ystate.type);
  const decorations = [];
  for (const run of runs) {
    if (!ctx.includeSelf && run.client === ctx.selfId()) continue;
    const color = ctx.userCache.get(run.client)?.color ?? DEFAULT_COLOR;

    // Anchor relative positions in the run's own parent (the paragraph's
    // inner YXmlText), then resolve to PM positions via the binding mapping.
    const anchor = Y.createRelativePositionFromTypeIndex(run.parent, run.offset);
    const head = Y.createRelativePositionFromTypeIndex(run.parent, run.offset + run.len);
    const from = relativePositionToAbsolutePosition(
      ystate.doc, ystate.type, anchor, ystate.binding.mapping
    );
    const to = relativePositionToAbsolutePosition(
      ystate.doc, ystate.type, head, ystate.binding.mapping
    );
    if (from == null || to == null || to <= from) continue;

    decorations.push(
      Decoration.inline(
        from,
        to,
        {
          class: "author-underline",
          style: `text-decoration-color:${color}`,
          "data-author": String(run.client),
        },
        { inclusiveStart: true, inclusiveEnd: true }
      )
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Underlines every author's text in their assigned color (self included by
 * default). Requires the provider's awareness; pass `includeSelf: false` to
 * underline only other users.
 */
export const AuthorshipUnderlines = Extension.create({
  name: "authorshipUnderlines",

  addOptions() {
    return { awareness: null, includeSelf: true };
  },

  addProseMirrorPlugins() {
    const awareness = this.options.awareness;
    if (!awareness) return [];

    const ctx = {
      awareness,
      userCache: new Map(), // clientId → { name, color }
      includeSelf: this.options.includeSelf,
      selfId: () => awareness.doc?.clientID ?? -1,
    };

    let redrawTimer = null;
    let viewRef = null; // set in view(); apply() can run before that

    const scheduleRedraw = () => {
      if (redrawTimer) return;
      redrawTimer = setTimeout(() => {
        redrawTimer = null;
        const view = viewRef;
        if (!view || view.isDestroyed) return;
        view.dispatch(view.state.tr.setMeta(authorshipKey, { redraw: true }));
      }, REDRAW_THROTTLE_MS);
    };

    const onAwarenessChange = () => scheduleRedraw();
    awareness.on("change", onAwarenessChange);

    return [
      new Plugin({
        key: authorshipKey,
        state: {
          init: (_, state) => computeDecorations(state, ctx),
          apply: (tr, prev, _old, newState) => {
            if (tr.getMeta(authorshipKey)) {
              return computeDecorations(newState, ctx);
            }
            if (!tr.docChanged) return prev;
            // Keep decorations position-valid through the edit, then ask
            // for a fresh scan (throttled).
            scheduleRedraw();
            return prev.map(tr.mapping, tr.doc);
          },
        },
        view: (view) => {
          viewRef = view;
          scheduleRedraw(); // initial scan (binding may settle after init)
          return {
            destroy: () => {
              viewRef = null;
              if (redrawTimer) {
                clearTimeout(redrawTimer);
                redrawTimer = null;
              }
              awareness.off("change", onAwarenessChange);
            },
          };
        },
      }),
    ];
  },
});
