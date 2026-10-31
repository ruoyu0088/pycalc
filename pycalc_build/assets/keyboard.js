/* PyCalc mobile on-screen keyboard.
 *
 * The layout comes from CFG.keyboard (built from keyboard_layout.py), so this
 * file contains no key, math-function or library lists.
 */
(() => {
  'use strict';

  const COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)');
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let translate = (key) => key;

  const state = {
    layout: null,
    callbacks: null,
    activeTab: null,
    currentView: 'letters',
    uppercase: false,
    collapsed: false,
    drawerOpen: false,
    drawerId: null,
    drawerTimer: null,
    libraryTab: null,
    initialized: false,
  };

  function t(key) {
    try {
      return translate(key);
    } catch (_) {
      return key;
    }
  }

  function createKeyboardDOM() {
    const app = document.getElementById('app');
    if (!app || document.querySelector('.mobile-keyboard')) return;

    const keyboard = document.createElement('div');
    keyboard.className = 'mobile-keyboard';
    document.body.classList.add('mobile-keyboard-active');
    keyboard.innerHTML = `
      <div class="mk-tabs" id="mk-tabs"></div>
      <div class="mk-panel" id="mk-panel"></div>
    `;
    app.appendChild(keyboard);

    const backdrop = document.createElement('div');
    backdrop.className = 'mk-drawer-backdrop hidden';
    backdrop.id = 'mk-drawer-backdrop';
    // Close on pointerdown, not click.  The drawer opens on pointerup, so the
    // browser's synthetic click after that same tap can land on the newly
    // visible backdrop and immediately close the drawer again.
    backdrop.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      closeDrawer();
    });
    document.body.appendChild(backdrop);

    const drawer = document.createElement('div');
    drawer.className = 'mk-drawer hidden';
    drawer.id = 'mk-drawer';
    drawer.innerHTML = `
      <div class="mk-drawer-header">
        <span class="mk-drawer-title" id="mk-drawer-title"></span>
        <div role="button" tabindex="-1" class="mk-drawer-close" id="mk-drawer-close">×</div>
      </div>
      <div class="mk-lib-tabs hidden" id="mk-lib-tabs"></div>
      <div class="mk-drawer-list" id="mk-drawer-list"></div>
    `;
    document.body.appendChild(drawer);
    bindPress(document.getElementById('mk-drawer-close'), closeDrawer);
  }

  /**
   * Keep the system IME out of the editing surface.
   *
   * Android honours inputmode=none on a contenteditable, so the CodeMirror
   * caret stays visible.  iOS Safari does not; there we make CodeMirror
   * programmatically read-only (contenteditable=false) and draw its caret via
   * the mobile-keyboard-ios CSS.  Taps still move the selection through
   * posAtCoords, and all edits come from the custom keyboard.
   */
  function disableSystemKeyboard() {
    const contentDOM = state.callbacks.getEditorContentDOM
      ? state.callbacks.getEditorContentDOM()
      : null;
    if (!contentDOM) return;

    contentDOM.setAttribute('inputmode', 'none');
    contentDOM.setAttribute('virtualkeyboardpolicy', 'manual');
    contentDOM.setAttribute('autocorrect', 'off');
    contentDOM.setAttribute('autocapitalize', 'none');
    contentDOM.setAttribute('spellcheck', 'false');
    contentDOM.addEventListener('contextmenu', (event) => event.preventDefault(), true);

    if (IS_IOS) {
      document.body.classList.add('mobile-keyboard-ios');
      if (state.callbacks.setEditable) state.callbacks.setEditable(false);
      // A blurred CodeMirror hides and freezes its cursor layer.  Make the
      // contenteditable=false surface focusable, then focus it: focus alone is
      // harmless without contenteditable, but it lets CodeMirror repaint the
      // caret at the selection.
      contentDOM.setAttribute('tabindex', '0');
      contentDOM.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (state.callbacks.setCursorFromPoint) {
          state.callbacks.setCursorFromPoint(event.clientX, event.clientY);
        }
      }, true);
      requestAnimationFrame(() => {
        try { contentDOM.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      });
      return;
    }

    // Android: inputmode=none normally wins.  If an IME still appears, close
    // it when the visual viewport shrinks.
    const viewport = window.visualViewport;
    if (!viewport) return;
    let baseline = Math.max(window.innerHeight || 0, viewport.height || 0);
    contentDOM.addEventListener('focus', () => {
      baseline = Math.max(window.innerHeight || 0, viewport.height || 0);
    }, true);
    viewport.addEventListener('resize', () => {
      if (document.activeElement !== contentDOM) return;
      if (viewport.height < baseline - 120) contentDOM.blur();
    });
  }

  function renderTabs() {
    const host = document.getElementById('mk-tabs');
    if (!host) return;
    host.innerHTML = '';
    for (const tab of state.layout.tabs || []) {
      const button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '-1');
      button.className = 'mk-tab' + (tab.id === state.activeTab ? ' active' : '');
      button.textContent = t(tab.labelKey);
      button.dataset.tab = tab.id;
      bindPress(button, () => {
        if (state.drawerOpen) closeDrawer();
        if (state.collapsed) setCollapsed(false);
        if (tab.id === state.activeTab) return;
        state.activeTab = tab.id;
        state.currentView = 'letters';
        state.uppercase = false;
        renderTabs();
        renderActiveTab();
      });
      host.appendChild(button);
    }

    const autocompleteTab = document.createElement('div');
    autocompleteTab.setAttribute('role', 'button');
    autocompleteTab.setAttribute('tabindex', '-1');
    autocompleteTab.className = 'mk-tab mk-autocomplete-tab';
    autocompleteTab.textContent = t('keyboard.key.autocomplete');
    autocompleteTab.setAttribute('aria-label', autocompleteTab.textContent);
    bindPress(autocompleteTab, () => {
      if (state.callbacks.triggerAutocomplete) state.callbacks.triggerAutocomplete();
    });
    host.appendChild(autocompleteTab);

    const signatureTab = document.createElement('div');
    signatureTab.setAttribute('role', 'button');
    signatureTab.setAttribute('tabindex', '-1');
    signatureTab.className = 'mk-tab mk-signature-tab';
    signatureTab.textContent = t('keyboard.key.signature');
    signatureTab.setAttribute('aria-label', signatureTab.textContent);
    bindPress(signatureTab, () => {
      if (state.callbacks.triggerSignature) state.callbacks.triggerSignature();
    });
    // host.appendChild(signatureTab);

    const clear = document.createElement('div');
    clear.setAttribute('role', 'button');
    clear.setAttribute('tabindex', '-1');
    clear.className = 'mk-tab mk-clear-tab';
    clear.textContent = t('keyboard.key.clearInput');
    clear.setAttribute('aria-label', clear.textContent);
    bindPress(clear, () => {
      if (state.callbacks.clear) state.callbacks.clear();
    });
    host.appendChild(clear);

    const collapse = document.createElement('div');
    collapse.setAttribute('role', 'button');
    collapse.setAttribute('tabindex', '-1');
    collapse.className = 'mk-tab mk-collapse-tab';
    collapse.textContent = state.collapsed ? '▲' : '▼';
    collapse.setAttribute(
      'aria-label',
      t(state.collapsed ? 'keyboard.show' : 'keyboard.hide')
    );
    collapse.setAttribute('aria-expanded', String(!state.collapsed));
    collapse.title = t(state.collapsed ? 'keyboard.show' : 'keyboard.hide');
    bindPress(collapse, () => setCollapsed(!state.collapsed));
    host.appendChild(collapse);
  }

  function setCollapsed(value) {
    state.collapsed = Boolean(value);
    const keyboard = document.querySelector('.mobile-keyboard');
    const panel = document.getElementById('mk-panel');
    if (keyboard) keyboard.classList.toggle('collapsed', state.collapsed);
    if (panel) panel.classList.toggle('hidden', state.collapsed);
    const button = document.querySelector('.mk-collapse-tab');
    if (!button) return;
    button.textContent = state.collapsed ? '▲' : '▼';
    button.title = t(state.collapsed ? 'keyboard.show' : 'keyboard.hide');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!state.collapsed));
  }

  function activeTab() {
    return (state.layout.tabs || []).find((tab) => tab.id === state.activeTab)
      || (state.layout.tabs || [])[0]
      || null;
  }

  function renderActiveTab() {
    const panel = document.getElementById('mk-panel');
    const tab = activeTab();
    if (!panel || !tab) return;
    panel.innerHTML = '';
    if (tab.type === 'split') renderSplitTab(tab, panel);
    else if (tab.type === 'keyboard') renderKeyboardTab(tab, panel);
  }

  function renderSplitTab(tab, panel) {
    const split = document.createElement('div');
    split.className = 'mk-split';

    const left = document.createElement('div');
    left.className = 'mk-split-left';
    for (const item of (tab.left && tab.left.items) || []) {
      left.appendChild(createKeyButton(item));
    }
    split.appendChild(left);

    const right = document.createElement('div');
    right.className = 'mk-split-right';
    right.style.gridTemplateColumns = `repeat(${Number(tab.right.columns) || 5}, 1fr)`;
    for (const row of (tab.right && tab.right.rows) || []) {
      for (const key of row) right.appendChild(createKeyButton(key));
    }
    split.appendChild(right);
    panel.appendChild(split);
  }

  function renderKeyboardTab(tab, panel) {
    const view = document.createElement('div');
    view.className = 'mk-keyboard-view';
    const rows = (tab.views && (tab.views[state.currentView] || tab.views.letters)) || [];
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'mk-row';
      const items = typeof row === 'string' ? row.split(/\s+/).filter(Boolean) : row;
      for (const item of items) {
        if (typeof item === 'string') {
          for (const part of item.split(/\s+/).filter(Boolean)) {
            line.appendChild(createKeyButton(normalizeKey(part)));
          }
        } else {
          line.appendChild(createKeyButton(normalizeKey(item)));
        }
      }
      view.appendChild(line);
    }
    panel.appendChild(view);
  }

  function normalizeKey(item) {
    if (typeof item !== 'string') return item;
    const display = state.uppercase && /^[a-z]$/.test(item) ? item.toUpperCase() : item;
    return { label: display, insert: display };
  }

  function createKeyButton(key) {
    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '-1');
    button.className = 'mk-key';
    button.dataset.action = key.action || 'insert';
    if (key.style === 'run') button.classList.add('run');
    if (key.wide) button.classList.add('wide');
    if (key.span && Number(key.span) > 1) button.style.gridColumn = `span ${Number(key.span)}`;
    if (key.labelKey) button.textContent = t(key.labelKey);
    else button.textContent = key.label == null ? '' : String(key.label);
    if (key.action === 'shift' && state.uppercase) button.classList.add('shift-active');
    button.setAttribute('aria-label', button.textContent);
    bindPress(button, () => handleKeyPress(key));
    return button;
  }

  function insertText(text) {
    if (!state.callbacks.insert) return;
    state.callbacks.insert(text);
  }

  function insertKeyText(text) {
    insertText(text);
    if (state.uppercase) {
      state.uppercase = false;
      if (state.activeTab === 'en') renderActiveTab();
    }
  }

  function insertNewline() {
    if (state.callbacks.newline) state.callbacks.newline();
    else insertText('\n');
    if (state.uppercase) {
      state.uppercase = false;
      if (state.activeTab === 'en') renderActiveTab();
    }
  }

  function handleKeyPress(key) {
    if (key.insert !== undefined) {
      if (String(key.insert) === '\n') {
        insertNewline();
      } else {
        insertKeyText(String(key.insert));
      }
      return;
    }

    switch (key.action) {
      case 'run':
        if (state.callbacks.run) state.callbacks.run();
        break;
      case 'backspace':
        if (state.callbacks.backspace) state.callbacks.backspace();
        break;
      case 'cursorLeft':
        if (state.callbacks.moveCursor) state.callbacks.moveCursor(-1);
        break;
      case 'cursorRight':
        if (state.callbacks.moveCursor) state.callbacks.moveCursor(1);
        break;
      case 'lineStart':
        if (state.callbacks.moveLineStart) state.callbacks.moveLineStart();
        break;
      case 'lineEnd':
        if (state.callbacks.moveLineEnd) state.callbacks.moveLineEnd();
        break;
      case 'undo':
        if (state.callbacks.undo) state.callbacks.undo();
        break;
      case 'tab':
        if (state.callbacks.tab) state.callbacks.tab();
        break;
      case 'clear':
        if (state.callbacks.clear) state.callbacks.clear();
        break;
      case 'space':
        insertKeyText(' ');
        break;
      case 'enter':
        insertNewline();
        break;
      case 'shift':
        state.uppercase = !state.uppercase;
        renderActiveTab();
        break;
      case 'view:letters':
        state.currentView = 'letters';
        state.uppercase = false;
        renderActiveTab();
        break;
      case 'view:numbers':
        state.currentView = 'numbers';
        state.uppercase = false;
        renderActiveTab();
        break;
      case 'openDrawer':
        openDrawer(key.drawer);
        break;
      default:
        console.warn('[PyCalc] unknown keyboard action:', key.action);
    }
  }

  /**
   * Use Pointer Events where available and a touch/mouse fallback otherwise.
   * preventDefault on pointerdown keeps the CodeMirror content editable focused
   * (and prevents a click-generated focus shift).
   */
  function bindPress(element, handler) {
    if (!element) return;
    let pressed = false;

    const reset = () => {
      pressed = false;
      element.classList.remove('pressed');
    };
    const down = (event) => {
      event.preventDefault();
      pressed = true;
      element.classList.add('pressed');
      if (element.setPointerCapture && event.pointerId !== undefined) {
        try { element.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
    };
    const up = (event) => {
      event.preventDefault();
      if (!pressed) return;
      reset();
      handler();
    };

    if (window.PointerEvent) {
      element.addEventListener('pointerdown', down);
      element.addEventListener('pointerup', up);
      element.addEventListener('pointercancel', reset);
      element.addEventListener('pointerleave', reset);
    } else {
      element.addEventListener('touchstart', (event) => {
        event.preventDefault();
        down(event);
      }, { passive: false });
      element.addEventListener('touchend', (event) => {
        event.preventDefault();
        up(event);
      }, { passive: false });
      element.addEventListener('touchcancel', reset);
      element.addEventListener('mousedown', (event) => {
        event.preventDefault();
        down(event);
      });
      element.addEventListener('mouseup', up);
    }
  }

  function clearDrawerTimer() {
    if (state.drawerTimer !== null) {
      clearTimeout(state.drawerTimer);
      state.drawerTimer = null;
    }
  }

  function drawerItems(def) {
    let items = [];
    if (def.source === 'variables') items = state.callbacks.getVariables ? state.callbacks.getVariables() : [];
    else if (def.source === 'functions') items = state.callbacks.getFunctions ? state.callbacks.getFunctions() : [];
    else if (def.source === 'libraries') items = state.callbacks.getLibraries ? state.callbacks.getLibraries() : [];
    else if (def.items) items = def.items;
    return Array.isArray(items) ? items : [];
  }

  function drawerItemParts(def, item) {
    if (typeof item === 'string') {
      return { label: item, value: item, title: item };
    }
    const field = def.displayField || def.insertField;
    if (def.source === 'libraries') {
      const alias = item.alias || item.name || item.id || item.label || String(item);
      return {
        label: alias,
        value: item.alias || item.name || item.id || alias,
        title: item.label || item.module || alias,
      };
    }
    if (field && item[field] !== undefined) {
      return {
        label: item[field],
        value: item[field],
        title: item.type || item.label || item[field],
      };
    }
    if (item.label !== undefined) {
      return {
        label: item.label,
        value: item.insert !== undefined ? item.insert : item.label,
        title: item.label,
      };
    }
    return { label: String(item), value: String(item), title: '' };
  }

  function notify(key) {
    if (state.callbacks.notify) state.callbacks.notify(key);
  }

  function selectedLibraries() {
    const read = state.callbacks.getSelectedLibraries || state.callbacks.getLibraries;
    let libraries = read ? read() : [];
    if (!Array.isArray(libraries)) libraries = [];
    return libraries.filter((library) => library && library.id);
  }

  function libraryAlias(library) {
    return library.alias || library.label || library.id;
  }

  function classifyContext(before, alias) {
    const text = String(before || '');
    if (/[A-Za-z_]\w*\.$/.test(text)) {
      const token = /([A-Za-z_]\w*)\.$/.exec(text)[1];
      return token === alias ? 'aliasDot' : 'dot';
    }
    if (text.endsWith('.')) return 'dot';
    const identifier = /([A-Za-z_]\w*)$/.exec(text);
    if (identifier) return identifier[1] === alias ? 'alias' : 'identifier';
    if (/[)\]]$/.test(text)) return 'objectExpr';
    return 'other';
  }

  /**
   * Resolve the compact ? / ?. / . button notation.
   *
   *   ?name   library member
   *   ?.name  library member or member of the current object
   *   .name   member that only exists on objects
   *
   * A trailing "(" or "[" is preserved as an opening suffix; it never takes
   * part in the name/dot decisions.
   */
  function resolveMarkedInsert(raw, alias, before) {
    const source = String(raw == null ? '' : raw);
    if (!source.startsWith('?') && !source.startsWith('.')) return source;

    let mode;
    let body;
    if (source.startsWith('?.')) {
      mode = 'shared';
      body = source.slice(2);
    } else if (source.startsWith('?')) {
      mode = 'library';
      body = source.slice(1);
    } else {
      mode = 'object';
      body = source.slice(1);
    }

    let suffix = '';
    if (body.endsWith('(') || body.endsWith('[')) {
      suffix = body.slice(-1);
      body = body.slice(0, -1);
    }

    const prefixText = before === undefined
      ? (state.callbacks.getTextBeforeCursor ? String(state.callbacks.getTextBeforeCursor() || '') : '')
      : String(before || '');
    const context = classifyContext(prefixText, alias);

    let prefix;
    if (mode === 'library') {
      if (context === 'aliasDot') prefix = '';
      else if (context === 'alias') prefix = '.';
      else prefix = `${alias}.`;
    } else if (mode === 'shared') {
      if (context === 'aliasDot' || context === 'dot') prefix = '';
      else if (context === 'alias' || context === 'identifier' || context === 'objectExpr') prefix = '.';
      else prefix = `${alias}.`;
    } else {
      if (context === 'dot') prefix = '';
      else if (context === 'identifier' || context === 'objectExpr') prefix = '.';
      else return null;
    }
    return prefix + body + suffix;
  }

  function renderLibraryTabs(libraries, activeId) {
    const host = document.getElementById('mk-lib-tabs');
    if (!host) return;
    host.innerHTML = '';
    host.classList.toggle('hidden', libraries.length === 0);
    for (const library of libraries) {
      const button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '-1');
      button.className = 'mk-lib-tab' + (library.id === activeId ? ' active' : '');
      button.textContent = libraryAlias(library);
      bindPress(button, () => {
        if (state.libraryTab === library.id) return;
        state.libraryTab = library.id;
        renderDrawerContent('libraries');
      });
      host.appendChild(button);
    }
  }

  function emptyDrawer(list, key) {
    const empty = document.createElement('div');
    empty.className = 'mk-drawer-empty';
    empty.textContent = t(key);
    list.appendChild(empty);
  }

  function renderLibraryDrawer(def) {
    const list = document.getElementById('mk-drawer-list');
    if (!list) return;
    list.innerHTML = '';

    const libraries = selectedLibraries();
    if (!libraries.length) {
      renderLibraryTabs([], null);
      emptyDrawer(list, def.emptyKey || 'keyboard.empty.libraryTabs');
      return;
    }

    let active = libraries.find((library) => library.id === state.libraryTab);
    if (!active) active = libraries[0];
    state.libraryTab = active.id;
    renderLibraryTabs(libraries, active.id);

    const alias = libraryAlias(active);
    const quick = state.layout.library_quick && state.layout.library_quick[active.id];
    const items = Array.isArray(quick) ? quick : [];
    if (!items.length) {
      emptyDrawer(list, def.emptyQuickKey || 'keyboard.empty.libraryQuick');
      return;
    }

    for (const item of items) {
      const button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '-1');
      button.className = 'mk-drawer-item';
      button.textContent = item.label;
      button.title = item.insert;
      bindPress(button, () => {
        const text = resolveMarkedInsert(item.insert, alias);
        if (text === null) {
          notify('keyboard.needObject');
          return;
        }
        insertText(text);
        closeDrawer();
      });
      list.appendChild(button);
    }
  }

  function renderDrawerContent(drawerId) {
    const def = state.layout.drawers && state.layout.drawers[drawerId];
    if (!def) return;
    const title = document.getElementById('mk-drawer-title');
    const list = document.getElementById('mk-drawer-list');
    const tabs = document.getElementById('mk-lib-tabs');
    if (!title || !list) return;
    title.textContent = t(def.titleKey);
    list.innerHTML = '';

    if (def.tabs) {
      renderLibraryDrawer(def);
      return;
    }
    if (tabs) tabs.classList.add('hidden');

    const items = drawerItems(def);
    if (!items.length) {
      emptyDrawer(list, def.emptyKey || 'keyboard.empty.generic');
      return;
    }

    for (const item of items) {
      const parts = drawerItemParts(def, item);
      const button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '-1');
      button.className = 'mk-drawer-item';
      button.textContent = parts.label;
      if (parts.title) button.title = parts.title;
      bindPress(button, () => {
        insertText(parts.value + (def.suffix || ''));
        closeDrawer();
      });
      list.appendChild(button);
    }
  }

  function openDrawer(drawerId) {
    const def = state.layout.drawers && state.layout.drawers[drawerId];
    if (!def) return;
    clearDrawerTimer();
    state.drawerOpen = true;
    state.drawerId = drawerId;
    renderDrawerContent(drawerId);

    const drawer = document.getElementById('mk-drawer');
    const backdrop = document.getElementById('mk-drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => {
      if (!state.drawerOpen || state.drawerId !== drawerId) return;
      drawer.classList.add('open');
      backdrop.classList.add('open');
    });
  }

  function closeDrawer() {
    if (!state.drawerOpen && !document.getElementById('mk-drawer')) return;
    state.drawerOpen = false;
    state.drawerId = null;
    clearDrawerTimer();
    const drawer = document.getElementById('mk-drawer');
    const backdrop = document.getElementById('mk-drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    state.drawerTimer = setTimeout(() => {
      drawer.classList.add('hidden');
      backdrop.classList.add('hidden');
      state.drawerTimer = null;
    }, 180);
  }

  function refresh() {
    renderTabs();
    renderActiveTab();
    if (state.drawerOpen && state.drawerId) renderDrawerContent(state.drawerId);
  }

  function initMobileKeyboard(options) {
    if (!COARSE || !COARSE.matches) return null;
    if (state.initialized) return window.__pycalcKeyboard || null;
    if (!options || !options.layout) {
      console.warn('[PyCalc] keyboard layout is missing');
      return null;
    }

    state.callbacks = options;
    state.layout = options.layout;
    translate = typeof options.t === 'function' ? options.t : (key) => key;
    state.activeTab = (state.layout.tabs[0] && state.layout.tabs[0].id) || 'calc';

    createKeyboardDOM();
    disableSystemKeyboard();
    renderTabs();
    renderActiveTab();

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.drawerOpen) closeDrawer();
    });

    state.initialized = true;
    const api = {
      refresh,
      closeDrawer,
      isCoarse: () => Boolean(COARSE && COARSE.matches),
      activeTab: () => state.activeTab,
      libraryTab: () => state.libraryTab,
      resolveInsert: (raw, alias, before) => resolveMarkedInsert(raw, alias, before),
    };
    window.__pycalcKeyboard = api;
    return api;
  }

  window.initMobileKeyboard = initMobileKeyboard;
})();
