import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete';
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  defaultKeymap,
  deleteCharBackward,
  history,
  historyKeymap,
  indentMore,
  indentWithTab,
  insertNewlineAndIndent,
  undo,
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
        backgroundColor: dark ? '#3d5a80' : '#b6d4fe',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: dark ? '#4a6fa5' : '#a8c7fa',
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

// Move by editor tokens rather than single characters: skip whitespace, then
// consume a full identifier or numeric literal.  This is the behaviour the
// mobile left/right cursor keys need without relying on Ctrl/Alt modifiers.
function moveCursorWord(view, direction) {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const text = line.text;
  let offset = selection.head - line.from;
  const isSpace = (char) => /\s/.test(char);
  const identifier = /[\p{L}_][\p{L}\p{N}_]*/u;
  const number = /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/;

  if (direction < 0) {
    while (offset > 0 && isSpace(text[offset - 1])) offset -= 1;
    if (offset === 0) {
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      return;
    }
    const before = text.slice(0, offset);
    const identMatch = before.match(new RegExp(`${identifier.source}$`, 'u'));
    const numberMatch = before.match(new RegExp(`${number.source}$`));
    let length = 1;
    if (identMatch) length = Math.max(length, identMatch[0].length);
    if (numberMatch) length = Math.max(length, numberMatch[0].length);
    offset = Math.max(0, offset - length);
  } else {
    while (offset < text.length && isSpace(text[offset])) offset += 1;
    if (offset >= text.length) {
      view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
      return;
    }
    const after = text.slice(offset);
    const identMatch = after.match(new RegExp(`^${identifier.source}`, 'u'));
    const numberMatch = after.match(new RegExp(`^${number.source}`));
    let length = 1;
    if (identMatch) length = Math.max(length, identMatch[0].length);
    if (numberMatch) length = Math.max(length, numberMatch[0].length);
    offset = Math.min(text.length, offset + length);
  }
  view.dispatch({
    selection: { anchor: line.from + offset },
    scrollIntoView: true,
  });
}

function findCallContext(state) {
  const position = state.selection.main.head;
  const text = state.doc.toString();
  let depth = 0;
  const lowerBound = Math.max(0, position - 4000);
  for (let i = position - 1; i >= lowerBound; i -= 1) {
    const ch = text[i];
    if (ch === ')') {
      depth += 1;
    } else if (ch === '(') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      let end = i - 1;
      while (end >= 0 && /\s/.test(text[end])) end -= 1;
      const nameEnd = end + 1;
      while (end >= 0 && /[\w.]/.test(text[end])) end -= 1;
      const name = text.slice(end + 1, nameEnd);
      if (name && /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(name)) {
        return { name, open: i };
      }
      return null;
    }
  }
  return null;
}

function makeCompletionSource(getCompletions, getAttributes) {
  return async (context) => {
    // Attribute completion: x. / np. / np.linalg. / foo.bar
    const word = context.matchBefore(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.?/);
    if (word && word.text.includes('.')) {
      const dot = word.text.lastIndexOf('.');
      const expr = word.text.slice(0, dot);
      const prefix = word.text.slice(dot + 1);
      if (!expr) return null;
      const data = await getAttributes(expr, context.state.doc.sliceString(0, context.pos));
      if (!data || !data.items || data.items.length === 0) return null;
      // Hide dunders/private members until the user explicitly types "_".
      const options = prefix.startsWith('_')
        ? data.items
        : data.items.filter((item) => !item.label.startsWith('_'));
      if (options.length === 0) return null;
      return {
        from: word.from + dot + 1,
        options,
        validFor: /^[A-Za-z_]\w*$/,
      };
    }

    // Top-level names (variables, functions, modules, builtins).
    const name = context.matchBefore(/[A-Za-z_]\w*/);
    if (!name && !context.explicit) return null;
    const from = name ? name.from : context.pos;
    const options = getCompletions();
    if (!options || options.length === 0) return null;
    return {
      from,
      options,
      validFor: /^[A-Za-z_]\w*$/,
    };
  };
}

function findAttributeContext(state) {
  const position = state.selection.main.head;
  const text = state.doc.toString();
  let start = position;
  while (start > 0 && /[\w.]/.test(text[start - 1])) start -= 1;
  const token = text.slice(start, position);
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const expr = token.slice(0, dot);
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(expr)) return null;
  return { expr, prefix: token.slice(dot + 1) };
}

function typeHint(getAttributes, onTypeHint) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.last = null;
        this.sequence = 0;
        this.update(view);
      }

      update(update) {
        const context = findAttributeContext(update.state);
        if (!context) {
          this.sequence += 1;
          this.set('');
          return;
        }
        const sequence = ++this.sequence;
        const code = update.state.doc.sliceString(0, update.state.selection.main.head);
        Promise.resolve()
          .then(() => getAttributes(context.expr, code))
          .then((data) => {
            if (sequence !== this.sequence) return;
            if (!data || !data.type) {
              this.set('');
              return;
            }
            this.set(`${context.expr} : ${data.type}`);
          })
          .catch(() => {
            if (sequence === this.sequence) this.set('');
          });
      }

      set(text) {
        if (text === this.last) return;
        this.last = text;
        onTypeHint(text);
      }

      destroy() {
        onTypeHint('');
      }
    }
  );
}

function signatureHelp(getSignature, registerController) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.tip = document.createElement('div');
        this.tip.className = 'signature-tip hidden';
        document.body.appendChild(this.tip);
        this.positionTimer = null;
        this.sequence = 0;
        this.onScroll = () => this.updatePosition();
        this.onBlur = () => this.hide();
        view.scrollDOM.addEventListener('scroll', this.onScroll);
        view.dom.addEventListener('blur', this.onBlur);
        window.addEventListener('resize', this.onScroll);
        if (registerController) registerController(this);
      }

      update(update) {
        if (completionStatus(update.state) === 'active') {
          this.sequence += 1;
          this.hide();
          return;
        }
        const call = findCallContext(update.state);
        if (!call) {
          this.sequence += 1;
          this.hide();
          return;
        }
        const sequence = ++this.sequence;
        Promise.resolve()
          .then(() => getSignature(call.name))
          .then((signature) => {
            if (sequence !== this.sequence) return;
            if (!signature) {
              this.hide();
              return;
            }
            this.show(call.name, signature);
          })
          .catch(() => {
            if (sequence === this.sequence) this.hide();
          });
      }

      show(nameText, signature) {
        this.tip.textContent = '';
        const name = document.createElement('span');
        name.className = 'sig-name';
        name.textContent = nameText;
        const args = document.createElement('span');
        args.className = 'sig-args';
        args.textContent = signature;
        this.tip.append(name, args);
        this.tip.classList.remove('hidden');
        // Reading layout (coordsAtPos) is forbidden while CodeMirror is
        // updating; defer the positioning to the next task.
        this.schedulePosition();
      }

      trigger() {
        this.update({ state: this.view.state });
      }      

      schedulePosition() {
        if (this.positionTimer !== null) clearTimeout(this.positionTimer);
        this.positionTimer = setTimeout(() => {
          this.positionTimer = null;
          this.updatePosition();
        }, 0);
      }

      updatePosition() {
        if (this.tip.classList.contains('hidden')) return;
        const position = this.view.state.selection.main.head;
        const coords = this.view.coordsAtPos(position);
        if (!coords) {
          this.hide();
          return;
        }
        this.tip.style.left = '0px';
        this.tip.style.top = '0px';
        const rect = this.tip.getBoundingClientRect();
        let left = coords.left;
        if (left + rect.width > window.innerWidth - 8) {
          left = window.innerWidth - rect.width - 8;
        }
        let top = coords.bottom + 6;
        if (top + rect.height > window.innerHeight - 8) {
          top = coords.top - rect.height - 6;
        }
        this.tip.style.left = `${Math.max(8, left)}px`;
        this.tip.style.top = `${Math.max(8, top)}px`;
      }

      hide() {
        this.tip.classList.add('hidden');
      }

      destroy() {
        if (this.positionTimer !== null) clearTimeout(this.positionTimer);
        this.tip.remove();
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.view.dom.removeEventListener('blur', this.onBlur);
        window.removeEventListener('resize', this.onScroll);
      }
    }
  );
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
 *   onHistory?: (delta: number) => boolean,
 *   getCompletions?: () => Array<object>,
 *   getAttributes?: (expr: string) => {items: Array<object>, type?: string|null},
 *   getSignature?: (name: string) => string|null,
 *   onTypeHint?: (text: string) => void
 * }} options
 */
export function create(parent, options = {}) {
  const onChange = options.onChange || (() => {});
  const onRun = options.onRun || (() => {});
  const onTryEnter = options.onTryEnter || (() => false);
  const onHistory = options.onHistory || (() => false);
  const getCompletions = options.getCompletions || (() => []);
  const getAttributes = options.getAttributes || (() => ({ items: [] }));
  const getSignature = options.getSignature || (() => null);
  const onTypeHint = options.onTypeHint || (() => {});
  const themeCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const editableCompartment = new Compartment();
  let currentTheme = options.theme === 'dark' ? 'dark' : 'light';
  let currentPlaceholder = options.placeholder || '';
  let currentEditable = true;

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
          if (completionStatus(view.state) === 'active') return false;
          let outcome;
          try {
            outcome = onTryEnter();
          } catch (_) {
            return false;
          }
          if (outcome === true) return true;
          if (outcome && typeof outcome.then === 'function') {
            outcome
              .then((shouldRun) => {
                if (shouldRun) onRun();
                else insertNewlineAndIndent(view);
              })
              .catch(() => insertNewlineAndIndent(view));
            return true;
          }
          return false;
        },
      },
      { key: 'Shift-Enter', run: insertNewlineAndIndent },
      {
        key: 'ArrowUp',
        run: (view) => {
          if (completionStatus(view.state) === 'active') return false;
          if (!atFirstLine(view)) return false;
          return onHistory(-1) === true;
        },
      },
      {
        key: 'ArrowDown',
        run: (view) => {
          if (completionStatus(view.state) === 'active') return false;
          if (!atLastLine(view)) return false;
          return onHistory(1) === true;
        },
      },
    ])
  );

  let signatureController = null;
  const buildExtensions = () => [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [makeCompletionSource(getCompletions, getAttributes)],
      activateOnTyping: true,
      closeOnBlur: true,
      maxRenderedOptions: 80,
    }),
    typeHint(getAttributes, onTypeHint),
    signatureHelp(getSignature, (controller) => { signatureController = controller; }),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    python(),
    EditorView.lineWrapping,
    editableCompartment.of(EditorView.editable.of(currentEditable)),
    themeCompartment.of(themeExtensions(currentTheme)),
    placeholderCompartment.of(placeholder(currentPlaceholder)),
    customKeymap,
    keymap.of([
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
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
    insertAtCursor: (text, options = {}) => {
      view.dispatch(view.state.replaceSelection(String(text)));
      if (options.focus !== false) view.focus();
    },
    insertTab: () => {
      if (view.state.selection.ranges.some((range) => !range.empty)) {
        indentMore(view);
      } else {
        view.dispatch(view.state.replaceSelection('    '));
      }
    },
    insertNewline: () => insertNewlineAndIndent(view),
    undo: () => undo(view),
    deleteCharBefore: () => deleteCharBackward(view),
    moveCursor: (direction) => {
      (direction < 0 ? cursorCharLeft : cursorCharRight)(view);
    },
    moveCursorWord: (direction) => moveCursorWord(view, direction),
    moveHistoryOrCursor: (delta) => {
      if (delta < 0) {
        if (atFirstLine(view) && onHistory(-1) === true) return;
        cursorLineUp(view);
      } else {
        if (atLastLine(view) && onHistory(1) === true) return;
        cursorLineDown(view);
      }
    },
    moveLineStart: () => cursorLineStart(view),
    moveLineEnd: () => cursorLineEnd(view),
    getContentDOM: () => view.contentDOM,
    getTextBeforeCursor: () => {
      const from = view.state.selection.main.from;
      const line = view.state.doc.lineAt(from);
      return view.state.sliceDoc(line.from, from);
    },
    setEditable: (editable) => {
      currentEditable = Boolean(editable);
      view.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(currentEditable)),
      });
      if (!currentEditable) view.contentDOM.blur();
    },
    setCursorFromPoint: (x, y) => {
      let position = null;
      try {
        position = view.posAtCoords({ x, y });
      } catch (_) {
        position = null;
      }
      if (position === null) return false;
      view.dispatch({ selection: { anchor: position } });
      return true;
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
    
    triggerAutocomplete: () => {
      view.focus();
      startCompletion(view);
    },
    
    triggerSignature: () => {
      view.focus();
      if (signatureController) signatureController.trigger();
    },
  };
}
