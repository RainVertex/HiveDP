// All colors read the app's --c-* variables, so the editor follows data-theme switches live.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const chrome = EditorView.theme({
  "&": {
    backgroundColor: "var(--c-surface)",
    color: "var(--c-text)",
  },
  ".cm-content": {
    caretColor: "var(--c-text)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--c-text)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--c-primary-soft)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--c-text) 5%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--c-primary-soft)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--c-warning-soft)",
    outline: "1px solid var(--c-warning)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--c-warning)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--c-primary-soft)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--c-bg-sunken)",
    color: "var(--c-text-subtle)",
    borderRight: "1px solid var(--c-border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--c-surface-hover)",
    color: "var(--c-text)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--c-surface-hover)",
    border: "1px solid var(--c-border)",
    color: "var(--c-text-muted)",
  },
  ".cm-panels": {
    backgroundColor: "var(--c-bg-sunken)",
    color: "var(--c-text)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--c-border)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--c-border)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--c-surface)",
    border: "1px solid var(--c-border)",
    color: "var(--c-text)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--c-primary)",
    color: "var(--c-primary-foreground)",
  },
});

// Per-theme --c-syntax-* overrides win, otherwise the closest semantic token is used.
const highlight = HighlightStyle.define([
  { tag: [t.atom, t.propertyName], color: "var(--c-syntax-key, var(--c-primary))" },
  { tag: t.string, color: "var(--c-syntax-string, var(--c-success))" },
  {
    tag: [t.number, t.bool, t.null, t.keyword],
    color: "var(--c-syntax-literal, var(--c-accent))",
  },
  {
    tag: [t.variableName, t.definition(t.variableName)],
    color: "var(--c-syntax-ref, var(--c-accent))",
  },
  { tag: t.meta, color: "var(--c-text-muted)" },
  { tag: t.comment, color: "var(--c-text-muted)", fontStyle: "italic" },
  { tag: t.invalid, color: "var(--c-danger)" },
]);

export const codeMirrorTheme: Extension = [chrome, syntaxHighlighting(highlight)];
