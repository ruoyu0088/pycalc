import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';

const pycalcTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#20252e',
      fontSize: '13.5px',
    },
    '.cm-content': {
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      padding: '10px 0',
      caretColor: '#2563eb',
    },
    '.cm-scroller': {
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: '1.65',
      maxHeight: '42vh',
    },
    '.cm-line': { padding: '0 12px' },
    '.cm-gutters': {
      backgroundColor: '#f6f7f9',
      color: '#9aa3b2',
      border: 'none',
      borderRight: '1px solid #eef0f4',
    },
    '.cm-activeLine': { backgroundColor: '#f8fafc' },
    '.cm-activeLineGutter': { backgroundColor: '#eef2f7' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#dbe7ff' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#dbe7ff' },
    '.cm-cursor': { borderLeftColor: '#2563eb' },
    '.cm-placeholder': { color: '#9aa3b2' },
  },
  { dark: false }
);

/**
 * Create a Python editor in `parent`.
 *
 * @param {HTMLElement} parent
 * @param {{value?: string, onChange?: (value: string) => void}} options
 */
export function create(parent, options = {}) {
  const onChange = options.onChange || (() => {});
  const extensions = [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    python(),
    placeholder('输入 Python 代码，Ctrl+Enter 运行…'),
    EditorView.lineWrapping,
    pycalcTheme,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: 'Mod-Enter',
        run: () => {
          if (typeof window.__pycalcRun === 'function') {
            window.__pycalcRun();
          }
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];

  const makeState = (value) =>
    EditorState.create({ doc: value == null ? '' : String(value), extensions });

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
    // Used when switching sessions: start a fresh state so undo/redo from the
    // previous session cannot leak into the new one.
    reset: (value) => {
      view.setState(makeState(value || ''));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
