import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';

const MONO =
  '"Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

const lightHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: '#7c3aed' },
  { tag: [tags.name, tags.variableName], color: '#20252e' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#2563eb' },
  { tag: [tags.className, tags.typeName, tags.namespace], color: '#0f766e' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#b45309' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#b91c1c' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#6b7280', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#475569' },
  { tag: tags.meta, color: '#9a6700' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: '#c792ea' },
  { tag: [tags.name, tags.variableName], color: '#e6edf3' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#79c0ff' },
  { tag: [tags.className, tags.typeName, tags.namespace], color: '#7ee787' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#ffa657' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#ff7b72' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8b949e', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#c9d1d9' },
  { tag: tags.meta, color: '#d2a8ff' },
]);

function makeTheme(dark) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: dark ? '#e6edf3' : '#20252e',
        fontSize: '13.5px',
      },
      '.cm-content': {
        fontFamily: MONO,
        padding: '10px 0',
        caretColor: dark ? '#79c0ff' : '#2563eb',
      },
      '.cm-scroller': { fontFamily: MONO, lineHeight: '1.65', maxHeight: '40vh' },
      '.cm-line': { padding: '0 12px' },
      '.cm-gutters': {
        backgroundColor: dark ? '#161b22' : '#f6f7f9',
        color: dark ? '#6e7681' : '#9aa3b2',
        border: 'none',
        borderRight: dark ? '1px solid #30363d' : '1px solid #eef0f4',
      },
      '.cm-activeLine': { backgroundColor: dark ? '#1b222b' : '#f8fafc' },
      '.cm-activeLineGutter': { backgroundColor: dark ? '#212a35' : '#eef2f7' },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: dark ? '#264f78' : '#dbe7ff',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: dark ? '#264f78' : '#dbe7ff',
      },
      '.cm-cursor': { borderLeftColor: dark ? '#79c0ff' : '#2563eb' },
      '.cm-placeholder': { color: dark ? '#6e7681' : '#9aa3b2' },
    },
    { dark }
  );
}

function themeExtensions(mode) {
  const dark = mode === 'dark';
  return [makeTheme(dark), syntaxHighlighting(dark ? darkHighlight : lightHighlight)];
}

function atFirstLine(view) {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  return view.state.doc.lineAt(selection.head).number === 1;
}

function atLastLine(view) {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  return view.state.doc.lineAt(selection.head).number === view.state.doc.lines;
}

/**
 * Create a Python editor.
 *
 * @param {HTMLElement} parent
 * @param {{
 *   value?: string,
 *   theme?: 'light'|'dark',
 *   placeholder?: string,
 *   onChange?: (value: string) => void,
 *   onRun?: () => void,
 *   onTryEnter?: () => boolean,
 *   onHistory?: (delta: number) => boolean
 * }} options
 */
export function create(parent, options = {}) {
  const onChange = options.onChange || (() => {});
  const onRun = options.onRun || (() => {});
  const onTryEnter = options.onTryEnter || (() => false);
  const onHistory = options.onHistory || (() => false);
  const themeCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  let currentTheme = options.theme === 'dark' ? 'dark' : 'light';
  let currentPlaceholder = options.placeholder || '';

  const customKeymap = Prec.highest(
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onRun();
          return true;
        },
      },
      {
        key: 'Enter',
        run: (view) => {
          if (view.composing) return false;
          return onTryEnter() === true;
        },
      },
      { key: 'Shift-Enter', run: insertNewlineAndIndent },
      {
        key: 'ArrowUp',
        run: (view) => {
          if (!atFirstLine(view)) return false;
          return onHistory(-1) === true;
        },
      },
      {
        key: 'ArrowDown',
        run: (view) => {
          if (!atLastLine(view)) return false;
          return onHistory(1) === true;
        },
      },
    ])
  );

  const buildExtensions = () => [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    python(),
    EditorView.lineWrapping,
    themeCompartment.of(themeExtensions(currentTheme)),
    placeholderCompartment.of(placeholder(currentPlaceholder)),
    customKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];

  const makeState = (value) =>
    EditorState.create({
      doc: value == null ? '' : String(value),
      extensions: buildExtensions(),
    });

  const view = new EditorView({ state: makeState(options.value || ''), parent });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (value) => {
      const text = value == null ? '' : String(value);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    insertAtCursor: (text) => {
      view.dispatch(view.state.replaceSelection(String(text)));
      view.focus();
    },
    setCursorEnd: () => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    },
    setTheme: (mode) => {
      currentTheme = mode === 'dark' ? 'dark' : 'light';
      view.dispatch({ effects: themeCompartment.reconfigure(themeExtensions(currentTheme)) });
    },
    setPlaceholder: (text) => {
      currentPlaceholder = text || '';
      view.dispatch({
        effects: placeholderCompartment.reconfigure(placeholder(currentPlaceholder)),
      });
    },
    reset: (value) => {
      view.setState(makeState(value || ''));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
