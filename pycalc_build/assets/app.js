(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtTime(ts) {
    try {
      const locale = I18n.lang === 'zh' ? 'zh-CN' : I18n.lang === 'ja' ? 'ja-JP' : 'en-US';
      return new Date(ts).toLocaleTimeString(locale, {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (_) {
      return '';
    }
  }

  function fmtDateTime(ts) {
    try {
      const locale = I18n.lang === 'zh' ? 'zh-CN' : I18n.lang === 'ja' ? 'ja-JP' : 'en-US';
      return new Date(ts).toLocaleString(locale);
    } catch (_) {
      return '';
    }
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (_) { /* fall through */ }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---------------------------------------------------------------------
  // Configuration and i18n
  // ---------------------------------------------------------------------

  const CFG = JSON.parse($('pycalc-config').textContent);
  const ASSETS = JSON.parse($('pycalc-assets').textContent);
  const MESSAGES = JSON.parse($('pycalc-i18n').textContent);
  window.__pycalcVersion = {
    app: CFG.appVersion,
    pyodide: CFG.pyodideVersion,
    python: CFG.pythonVersion,
    runtime: CFG.runtimeMode,
  };
  const PY_GLUE_SOURCE = $('pycalc-glue').textContent;
  const AVAILABLE_LIBS = Array.isArray(CFG.availableLibraries) ? CFG.availableLibraries : [];
  const AVAILABLE_LIB_IDS = new Set(AVAILABLE_LIBS.map((lib) => lib.id));
  const LEGACY_LIBRARY_IDS = { pyplot: 'matplotlib.pyplot' };

  function normalizeLibraryId(value) {
    const id = String(value || '');
    if (AVAILABLE_LIB_IDS.has(id)) return id;
    const byAlias = AVAILABLE_LIBS.find((lib) => lib.alias === id);
    if (byAlias) return byAlias.id;
    return LEGACY_LIBRARY_IDS[id] || null;
  }

  function libraryAliasMap() {
    const result = {};
    for (const lib of AVAILABLE_LIBS) {
      if (lib.id && lib.alias) result[lib.id] = lib.alias;
    }
    return result;
  }

  function normalizeLibraryList(values) {
    const result = [];
    for (const value of values || []) {
      const id = normalizeLibraryId(value);
      if (id && AVAILABLE_LIB_IDS.has(id) && !result.includes(id)) result.push(id);
    }
    return result;
  }

  const BUILTIN_COMPLETIONS = [
    ['print', '(*args, sep=" ", end="\\n", file=None, flush=False)'],
    ['len', '(obj, /)'],
    ['range', '(start, stop=None, step=1)'],
    ['abs', '(x, /)'],
    ['all', '(iterable, /)'],
    ['any', '(iterable, /)'],
    ['bool', '(x=False)'],
    ['bytes', '(source, encoding, errors)'],
    ['chr', '(i, /)'],
    ['dict', '(**kwargs)'],
    ['dir', '(obj=None)'],
    ['divmod', '(x, y, /)'],
    ['enumerate', '(iterable, start=0)'],
    ['filter', '(function, iterable, /)'],
    ['float', '(x=0.0)'],
    ['format', '(value, format_spec="")'],
    ['frozenset', '(iterable=())'],
    ['getattr', '(obj, name, default)'],
    ['hasattr', '(obj, name, /)'],
    ['hash', '(obj, /)'],
    ['hex', '(number, /)'],
    ['id', '(obj, /)'],
    ['input', '(prompt="")'],
    ['int', '(x=0, base=10)'],
    ['isinstance', '(obj, class_or_tuple, /)'],
    ['issubclass', '(cls, class_or_tuple, /)'],
    ['iter', '(iterable, sentinel)'],
    ['list', '(iterable=())'],
    ['map', '(function, iterable, /)'],
    ['max', '(*args, key=None)'],
    ['min', '(*args, key=None)'],
    ['next', '(iterator, default)'],
    ['object', '()'],
    ['oct', '(number, /)'],
    ['open', '(file, mode="r", encoding=None)'],
    ['ord', '(c, /)'],
    ['pow', '(base, exp, mod=None)'],
    ['repr', '(obj, /)'],
    ['reversed', '(sequence, /)'],
    ['round', '(number, ndigits=None)'],
    ['set', '(iterable=())'],
    ['setattr', '(obj, name, value)'],
    ['sorted', '(iterable, key=None, reverse=False)'],
    ['str', '(object="", encoding, errors)'],
    ['sum', '(iterable, start=0)'],
    ['tuple', '(iterable=())'],
    ['type', '(object)'],
    ['vars', '(object=None)'],
    ['zip', '(*iterables, strict=False)'],
  ];

  function detectLanguage() {
    const nav = String(navigator.language || 'en').toLowerCase();
    if (nav.startsWith('ja')) return 'ja';
    if (nav.startsWith('zh')) return 'zh';
    return 'en';
  }

  function detectTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  const I18n = {
    lang: detectLanguage(),
    messages: MESSAGES,
    t(key, params) {
      const table = this.messages[this.lang] || this.messages.en || {};
      let text = table[key];
      if (text === undefined) text = (this.messages.en || {})[key];
      if (text === undefined) text = key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    setLanguage(lang) {
      this.lang = MESSAGES[lang] ? lang : 'en';
      document.documentElement.lang = this.lang;
      $('language-select').value = this.lang;
      this.applyStatic();
    },
    applyStatic(root = document) {
      root.querySelectorAll('[data-i18n]').forEach((node) => {
        node.textContent = this.t(node.dataset.i18n);
      });
      root.querySelectorAll('[data-i18n-title]').forEach((node) => {
        node.title = this.t(node.dataset.i18nTitle);
      });
      root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
        node.placeholder = this.t(node.dataset.i18nPlaceholder);
      });
    },
  };

  const DEFAULT_UI = {
    language: detectLanguage(),
    theme: detectTheme(),
    runKey: 'ctrl-enter',
    sidebarHidden: false,
    sidebarWidth: 292,
    sympyOutput: 'text',
    sessionBarHidden: false,
  };

  const state = {
    storage: null,
    sessions: [],
    activeId: null,
    activeName: '',
    history: [],
    executionCount: 0,
    draft: '',
    libraries: [],
    namespace: null,
    namespaceMeta: null,
    engine: 'unknown',
    busy: false,
    running: false,
    ready: false,
    saveChain: Promise.resolve(),
    saveTimer: null,
    draftTimer: null,
    objectUrls: [],
    activeOutput: null,
    completions: [],
    attributeCache: new Map(),
    historyNav: { index: null, draft: '' },
    redoStack: [],
    suppressEditorSave: false,
    ui: { ...DEFAULT_UI },
    status: null,
    overlay: null,
    mobileSidebarOpen: false,
  };

  let editor = null;
  let pyodide = null;
  let py = null;
  let mobileKeyboard = null;

  // ---------------------------------------------------------------------
  // Small UI helpers
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function toast(key, params) {
    const node = $('toast');
    node.textContent = I18n.t(key, params);
    node.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.add('hidden'), 4200);
  }

  let bannerTimer = null;
  function banner(key, params, kind = 'warn', sticky = false) {
    const node = $('banner');
    node.textContent = I18n.t(key, params);
    node.className = `banner ${kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : ''}`;
    node.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    if (!sticky) bannerTimer = setTimeout(() => node.classList.add('hidden'), 9000);
  }

  function hideBanner() {
    $('banner').classList.add('hidden');
  }

  function setStatus(key, params) {
    state.status = key ? { key, params: params || {} } : null;
    renderStatus();
  }

  function renderStatus() {
    $('save-status').textContent = '';
    return;
    if (!state.status) {
      $('save-status').textContent = '';
      return;
    }
    $('save-status').textContent = I18n.t(state.status.key, state.status.params);
  }

  function setEngine(engine) {
    state.engine = engine;
  }

  function setTypeHint(text) {
    const element = $('type-hint');
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('hidden', !text);
  }

  function setOverlay(titleKey, detailKey, params, error) {
    state.overlay = {
      titleKey, detailKey, params: params || {}, error: error || '',
    };
    renderOverlay();
  }

  function setStage(detailKey, params) {
    if (!state.overlay) return;
    state.overlay.detailKey = detailKey;
    state.overlay.params = params || {};
    renderOverlay();
  }

  function renderOverlay() {
    const node = $('overlay');
    if (!state.overlay) {
      node.classList.add('hidden');
      return;
    }
    node.classList.remove('hidden');
    $('overlay-title').textContent = I18n.t(state.overlay.titleKey, state.overlay.params);
    $('overlay-detail').textContent = I18n.t(state.overlay.detailKey, state.overlay.params);
    const err = $('overlay-error');
    if (state.overlay.error) {
      err.textContent = state.overlay.error;
      err.classList.remove('hidden');
      $('overlay-retry').classList.remove('hidden');
    } else {
      err.classList.add('hidden');
      $('overlay-retry').classList.add('hidden');
    }
  }

  function hideOverlay() {
    state.overlay = null;
    $('overlay').classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // Inlined assets and fetch shim
  // ---------------------------------------------------------------------

  const decoded = new Map();

  function b64ToBytes(data) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data);
    const raw = atob(data);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function decodeAsset(name) {
    if (decoded.has(name)) return decoded.get(name);
    const asset = ASSETS[name];
    if (!asset) throw new Error(`missing inline asset: ${name}`);
    let bytes = b64ToBytes(asset.data);
    if (asset.enc === 'gzip') {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('this browser does not support DecompressionStream');
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    decoded.set(name, bytes);
    return bytes;
  }

  const MIME = {
    '.wasm': 'application/wasm',
    '.zip': 'application/zip',
    '.whl': 'application/zip',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
  };

  function normalizeUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === 'string') return input.url;
    return String(input);
  }

  function baseName(url) {
    try {
      return new URL(url, location.href).pathname.split('/').pop().split('?')[0];
    } catch (_) {
      return url.split('/').pop().split('?')[0];
    }
  }

  function installFetchShim() {
    window.fetch = async (input) => {
      const url = normalizeUrl(input);
      const name = baseName(url);
      if (Object.prototype.hasOwnProperty.call(ASSETS, name)) {
        const bytes = await decodeAsset(name);
        const ext = name.slice(name.lastIndexOf('.'));
        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': String(bytes.length),
          },
        });
      }
      console.warn('[PyCalc] blocked external request:', url);
      throw new Error(`external request blocked: ${url}`);
    };
  }

  // ---------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------

  const streamDecoders = {
    stdout: new TextDecoder('utf-8'),
    stderr: new TextDecoder('utf-8'),
  };

  function dispatchStream(kind, text) {
    if (!text) return;
    if (state.activeOutput && typeof state.activeOutput[kind] === 'function') {
      state.activeOutput[kind](text);
    } else {
      console.log(`[pyodide:${kind}]`, text);
    }
  }

  function flushStreams() {
    for (const kind of ['stdout', 'stderr']) {
      const rest = streamDecoders[kind].decode();
      if (rest) dispatchStream(kind, rest);
    }
  }

  async function loadRuntime() {
    setStage('overlay.runtime', { version: CFG.pyodideVersion, python: CFG.pythonVersion });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let createPyodideModule;
    if (CFG.runtimeMode === 'esm') {
      const asmSource = $('pycalc-asm-mjs').textContent;
      const blobUrl = URL.createObjectURL(new Blob([asmSource], { type: 'text/javascript' }));
      try {
        const mod = await import(blobUrl);
        createPyodideModule = mod.default;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    setStage('overlay.packages', { libs: (CFG.libs || []).join(', ') || 'cloudpickle' });
    const options = {
      indexURL: 'https://pycalc.local/',
      packages: CFG.packages,
      stdout: (text) => dispatchStream('stdout', text),
      stderr: (text) => dispatchStream('stderr', text),
    };
    if (createPyodideModule) options.createPyodideModule = createPyodideModule;
    pyodide = await loadPyodide(options);
    pyodide.setStdout({
      write: (buffer) => {
        dispatchStream('stdout', streamDecoders.stdout.decode(buffer, { stream: true }));
        return buffer.byteLength;
      },
    });
    pyodide.setStderr({
      write: (buffer) => {
        dispatchStream('stderr', streamDecoders.stderr.decode(buffer, { stream: true }));
        return buffer.byteLength;
      },
    });

    setStage('overlay.init');
    pyodide.globals.set('_pycalc_glue_source', PY_GLUE_SOURCE);
    pyodide.runPython(`
import types as _pycalc_types
import __main__ as _pycalc_main
_pycalc_mod = _pycalc_types.ModuleType('_pycalc_glue')
exec(_pycalc_glue_source, _pycalc_mod.__dict__)
for _pycalc_name in (
    '_pycalc_run', '_pycalc_figures', '_pycalc_self_test',
    '_pycalc_reset', '_pycalc_snapshot_to_file', '_pycalc_restore_from_file',
    '_pycalc_replay_imports', '_pycalc_namespace_info',
    '_pycalc_set_libraries', '_pycalc_is_complete',
    '_pycalc_list_vars', '_pycalc_list_funcs', '_pycalc_set_plot_theme',
    '_pycalc_completion_items', '_pycalc_attribute_items',
):
    setattr(_pycalc_main, _pycalc_name, getattr(_pycalc_mod, _pycalc_name))
del _pycalc_name
del _pycalc_mod
del _pycalc_types
del _pycalc_main
del _pycalc_glue_source
`);
    py = {
      run: pyodide.globals.get('_pycalc_run'),
      figures: pyodide.globals.get('_pycalc_figures'),
      selfTest: pyodide.globals.get('_pycalc_self_test'),
      reset: pyodide.globals.get('_pycalc_reset'),
      snapshot: pyodide.globals.get('_pycalc_snapshot_to_file'),
      restore: pyodide.globals.get('_pycalc_restore_from_file'),
      replayImports: pyodide.globals.get('_pycalc_replay_imports'),
      namespaceInfo: pyodide.globals.get('_pycalc_namespace_info'),
      setLibraries: pyodide.globals.get('_pycalc_set_libraries'),
      isComplete: pyodide.globals.get('_pycalc_is_complete'),
      listVars: pyodide.globals.get('_pycalc_list_vars'),
      listFuncs: pyodide.globals.get('_pycalc_list_funcs'),
      setPlotTheme: pyodide.globals.get('_pycalc_set_plot_theme'),
      listCompletions: pyodide.globals.get('_pycalc_completion_items'),
      attributeItems: pyodide.globals.get('_pycalc_attribute_items'),
    };
  }

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------

  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_INDEX = 'sessionIndex';
  const STORE_DATA = 'sessionData';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(CFG.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_INDEX)) {
          db.createObjectStore(STORE_INDEX, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('could not open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another page'));
    });
  }

  function txPromise(db, stores, mode, action) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(stores, mode);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      try {
        action(tx);
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
  }

  function reqValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getMeta(db, key) {
    const tx = db.transaction(STORE_META, 'readonly');
    return reqValue(tx.objectStore(STORE_META).get(key));
  }

  async function putMeta(db, value) {
    await txPromise(db, [STORE_META], 'readwrite', (tx) => {
      tx.objectStore(STORE_META).put(value);
    });
  }

  async function listIndex(db) {
    const tx = db.transaction(STORE_INDEX, 'readonly');
    return (await reqValue(tx.objectStore(STORE_INDEX).getAll())) || [];
  }

  async function getSessionData(db, id) {
    const tx = db.transaction(STORE_DATA, 'readonly');
    return reqValue(tx.objectStore(STORE_DATA).get(id));
  }

  async function putSession(db, index, data) {
    await txPromise(db, [STORE_INDEX, STORE_DATA], 'readwrite', (tx) => {
      tx.objectStore(STORE_INDEX).put(index);
      tx.objectStore(STORE_DATA).put(data);
    });
  }

  async function deleteSessionRecord(db, id) {
    await txPromise(db, [STORE_INDEX, STORE_DATA], 'readwrite', (tx) => {
      tx.objectStore(STORE_INDEX).delete(id);
      tx.objectStore(STORE_DATA).delete(id);
    });
  }

  class IdbStorage {
    constructor(db) { this.db = db; }
    listSessions() { return listIndex(this.db); }
    getSession(id) { return getSessionData(this.db, id); }
    putSession(index, data) { return putSession(this.db, index, data); }
    deleteSession(id) { return deleteSessionRecord(this.db, id); }
    getMeta(key) { return getMeta(this.db, key); }
    putMeta(value) { return putMeta(this.db, value); }
  }

  class MemoryStorage {
    constructor() {
      this.sessions = new Map();
      this.data = new Map();
      this.meta = new Map();
    }
    async listSessions() { return [...this.sessions.values()]; }
    async getSession(id) { return this.data.get(id) || null; }
    async putSession(index, data) {
      this.sessions.set(index.id, JSON.parse(JSON.stringify(index)));
      this.data.set(data.id, data);
    }
    async deleteSession(id) { this.sessions.delete(id); this.data.delete(id); }
    async getMeta(key) { return this.meta.get(key) || null; }
    async putMeta(value) { this.meta.set(value.key, value); }
  }

  async function openStorage() {
    const db = await openDb();
    const appMeta = await getMeta(db, 'app');
    const existing = await listIndex(db);
    if (!appMeta) {
      if (existing.length > 0) {
        throw new Error(I18n.t('banner.foreignDb', { db: CFG.dbName }));
      }
      await putMeta(db, {
        key: 'app',
        appId: CFG.appId,
        schemaVersion: CFG.schemaVersion,
        createdAt: Date.now(),
      });
    } else if (appMeta.appId !== CFG.appId) {
      throw new Error(I18n.t('banner.foreignDb', { db: CFG.dbName }));
    } else {
      const stored = Number(appMeta.schemaVersion || 1);
      if (stored > CFG.schemaVersion) {
        throw new Error(I18n.t('banner.schemaNewer', {
          stored, current: CFG.schemaVersion,
        }));
      }
      if (stored < CFG.schemaVersion) {
        appMeta.schemaVersion = CFG.schemaVersion;
        appMeta.updatedAt = Date.now();
        await putMeta(db, appMeta);
      }
    }
    return new IdbStorage(db);
  }

  async function loadUiMeta() {
    let meta = null;
    try {
      meta = await state.storage.getMeta('ui');
    } catch (err) {
      console.warn('could not read UI settings', err);
    }
    if (!meta) {
      meta = { key: 'ui', ...DEFAULT_UI };
      try { await state.storage.putMeta(meta); } catch (err) { console.warn(err); }
    }
    const language = MESSAGES[meta.language] ? meta.language : DEFAULT_UI.language;
    const theme = meta.theme === 'dark' ? 'dark' : 'light';
    const runKey = meta.runKey === 'enter' ? 'enter' : 'ctrl-enter';
    return {
      ...DEFAULT_UI,
      ...meta,
      language,
      theme,
      runKey,
      sidebarHidden: Boolean(meta.sidebarHidden),
      sidebarWidth: clampSidebarWidth(meta.sidebarWidth),
      sympyOutput: meta.sympyOutput === 'math' ? 'math' : 'text',
      sessionBarHidden: Boolean(meta.sessionBarHidden),
    };
  }

  async function saveUiMeta() {
    if (!state.storage) return;
    try {
      await state.storage.putMeta({
        key: 'ui',
        language: state.ui.language,
        theme: state.ui.theme,
        runKey: state.ui.runKey,
        sidebarHidden: state.ui.sidebarHidden,
        sidebarWidth: state.ui.sidebarWidth,
        sympyOutput: state.ui.sympyOutput,
        sessionBarHidden: state.ui.sessionBarHidden,
      });
    } catch (err) {
      console.warn('could not save UI settings', err);
    }
  }

  // ---------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------

  function activeSession() {
    return state.sessions.find((session) => session.id === state.activeId) || null;
  }

  function uniqueName(base) {
    const names = new Set(state.sessions.map((session) => session.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} (${n})`)) n += 1;
    return `${base} (${n})`;
  }

  function migrateSessionData(data) {
    if (!data.schemaVersion) data.schemaVersion = 1;
    if (Number(data.schemaVersion) < 2) {
      data.libraries = Array.isArray(data.libraries) ? data.libraries : [];
      data.schemaVersion = 2;
    }
    if (Number(data.schemaVersion) > CFG.schemaVersion) {
      throw new Error(I18n.t('banner.schemaNewer', {
        stored: data.schemaVersion, current: CFG.schemaVersion,
      }));
    }
    if (!Array.isArray(data.libraries)) data.libraries = [];
    data.libraries = data.libraries.filter((id) => typeof id === 'string');
    return data;
  }

  function buildIndex(overrides = {}) {
    const current = activeSession();
    return {
      id: state.activeId,
      name: state.activeName,
      createdAt: current ? current.createdAt : Date.now(),
      updatedAt: Date.now(),
      executionCount: state.executionCount,
      schemaVersion: CFG.schemaVersion,
      ...overrides,
    };
  }

  function buildData() {
    return {
      id: state.activeId,
      schemaVersion: CFG.schemaVersion,
      libraries: state.libraries,
      history: state.history,
      draft: state.draft,
      namespace: state.namespace,
      namespaceMeta: state.namespaceMeta,
    };
  }

  function renderSessionSelect() {
    const select = $('session-select');
    select.innerHTML = '';
    const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const session of sorted) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.name;
      option.title = fmtDateTime(session.updatedAt);
      select.appendChild(option);
    }
    if (state.activeId) select.value = state.activeId;
  }

  function updateHeader() {
    document.title = state.activeName ? `PyCalc — ${state.activeName}` : 'PyCalc';
    renderSessionSelect();
  }

  async function createSessionRecord(name) {
    const id = uuid();
    const now = Date.now();
    const index = {
      id,
      name: uniqueName(name || I18n.t('session.defaultName')),
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
      schemaVersion: CFG.schemaVersion,
    };
    const data = {
      id,
      schemaVersion: CFG.schemaVersion,
      libraries: [],
      history: [],
      draft: '',
      namespace: null,
      namespaceMeta: null,
    };
    await state.storage.putSession(index, data);
    state.sessions.push(index);
    return index;
  }

  async function ensureAtLeastOneSession() {
    if (state.sessions.length > 0) return;
    const created = await createSessionRecord(I18n.t('session.defaultName'));
    state.activeId = created.id;
    state.activeName = created.name;
    state.history = [];
    state.executionCount = 0;
    state.draft = '';
    state.libraries = [];
    state.namespace = null;
    state.namespaceMeta = null;
    const active = await state.storage.getMeta('active');
    if (!active) await state.storage.putMeta({ key: 'active', value: created.id });
  }

  function renderLibraryBar() {
    const host = $('library-list');
    host.innerHTML = '';
    const note = $('library-note');
    note.textContent = I18n.t('libraries.hint');
    if (AVAILABLE_LIBS.length === 0) {
      note.textContent = I18n.t('libraries.none');
      return;
    }
    for (const lib of AVAILABLE_LIBS) {
      const label = el('label', 'lib-chip');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = lib.id;
      input.checked = state.libraries.includes(lib.id);
      input.disabled = state.busy;
      label.classList.toggle('checked', input.checked);
      input.addEventListener('change', onLibraryChange);
      label.appendChild(input);
      // const text = lib.alias ? `${lib.label} (${lib.alias})` : lib.label;
      // label.appendChild(el('span', '', text));
      const text = lib.alias || lib.label;
      const span = el('span', '', text);
      if (lib.alias) {
        span.title = lib.label;   // hint
      }
      label.appendChild(span);      
      host.appendChild(label);
    }
  }

  async function loadSessionIntoState(id) {
    const index = state.sessions.find((session) => session.id === id);
    if (!index) throw new Error('session not found');
    const raw = await state.storage.getSession(id);
    const data = migrateSessionData(raw || {
      id,
      schemaVersion: CFG.schemaVersion,
      libraries: [],
      history: [],
      draft: '',
      namespace: null,
      namespaceMeta: null,
    });
    state.activeId = id;
    state.activeName = index.name;
    state.history = Array.isArray(data.history) ? data.history : [];
    state.executionCount = Number(index.executionCount || 0);
    state.draft = data.draft || '';
    state.libraries = normalizeLibraryList(data.libraries);
    state.namespace = data.namespace || null;
    state.namespaceMeta = data.namespaceMeta || null;
    state.historyNav = { index: null, draft: '' };
    state.redoStack = [];
    renderConsole();
    resetEditorForSession(state.draft);
    renderLibraryBar();
    updateHeader();
    updateHistoryButtons();
  }

  async function restoreActiveSession() {
    await ensureAtLeastOneSession();
    const activeMeta = await state.storage.getMeta('active');
    let id = activeMeta ? activeMeta.value : null;
    if (!id || !state.sessions.some((session) => session.id === id)) {
      const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      id = sorted[0] ? sorted[0].id : state.activeId;
    }
    await loadSessionIntoState(id);
    await state.storage.putMeta({ key: 'active', value: id });
  }

  async function doSave({ snapshot }) {
    if (!state.storage || !state.activeId) return;
    const index = buildIndex();
    const data = buildData();
    if (snapshot && py) {
      try {
        setStatus('status.saving');
        const info = JSON.parse(py.snapshot('/tmp/pycalc-snapshot.bin'));
        if (info.ok) {
          const bytes = pyodide.FS.readFile('/tmp/pycalc-snapshot.bin');
          data.namespace = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          data.namespaceMeta = {
            engine: info.engine,
            size: info.size,
            failed: info.failed || [],
            pyodideVersion: CFG.pyodideVersion,
            pythonVersion: CFG.pythonVersion,
          };
          state.namespace = data.namespace;
          state.namespaceMeta = data.namespaceMeta;
        } else {
          data.namespace = state.namespace;
          data.namespaceMeta = state.namespaceMeta;
          if (info.reason === 'too-large') banner('banner.snapshotTooLarge');
          else if (info.reason) banner('banner.snapshotFailed', { error: info.reason });
        }
      } catch (err) {
        console.warn('snapshot failed', err);
        data.namespace = state.namespace;
        data.namespaceMeta = state.namespaceMeta;
        banner('banner.snapshotFailed', { error: err.message || err });
      }
    }
    try {
      await state.storage.putSession(index, data);
      const existing = state.sessions.find((session) => session.id === index.id);
      if (existing) {
        existing.name = index.name;
        existing.updatedAt = index.updatedAt;
        existing.executionCount = index.executionCount;
      }
      setStatus('status.savedAt', { time: fmtTime(Date.now()) });
    } catch (err) {
      console.warn('save failed', err);
      setStatus('status.saveFailed');
      banner('banner.saveFailed', { error: err.message || err }, 'bad');
    }
  }

  function queueSave(options) {
    const opts = { snapshot: true, ...(options || {}) };
    state.saveChain = state.saveChain.then(() => doSave(opts)).catch((err) => {
      console.warn('save chain error', err);
    });
    return state.saveChain;
  }

  function scheduleSave(options) {
    const opts = { snapshot: true, delay: 500, ...(options || {}) };
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      queueSave(opts);
    }, opts.delay);
  }

  async function saveNow(options) {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    return queueSave({ snapshot: true, ...(options || {}) });
  }

  async function switchSession(id) {
    if (state.busy || !id || id === state.activeId) return;
    state.busy = true;
    updateBusyUi();
    try {
      await saveNow();
      await loadSessionIntoState(id);
      await state.storage.putMeta({ key: 'active', value: id });
      await applyNamespaceForActiveSession();
      if (editor) editor.focus();
      toast('session.switched', { name: state.activeName });
    } catch (err) {
      console.warn(err);
      renderSessionSelect();
      banner('banner.switchFailed', { error: err.message || err }, 'bad', true);
    } finally {
      state.busy = false;
      updateBusyUi();
      refreshInspector();
    }
  }

  async function createSessionByName(name) {
    if (state.busy) return null;
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast('session.nameEmpty');
      return null;
    }
    state.busy = true;
    updateBusyUi();
    try {
      await saveNow();
      const created = await createSessionRecord(trimmed);
      await loadSessionIntoState(created.id);
      await state.storage.putMeta({ key: 'active', value: created.id });
      await applyNamespaceForActiveSession();
      if (editor) editor.focus();
      toast('session.created', { name: state.activeName });
      return created.id;
    } catch (err) {
      console.warn(err);
      banner('banner.newFailed', { error: err.message || err }, 'bad', true);
      return null;
    } finally {
      state.busy = false;
      updateBusyUi();
      refreshInspector();
    }
  }

  async function newSession() {
    if (state.busy) return;
    const raw = window.prompt(
      I18n.t('session.promptNew'),
      I18n.t('session.newName', { n: state.sessions.length + 1 })
    );
    if (raw === null) return;
    await createSessionByName(raw);
  }

  async function renameSessionTo(name) {
    if (state.busy || !state.activeId) return false;
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast('session.nameEmpty');
      return false;
    }
    if (state.sessions.some((session) => session.name === trimmed && session.id !== state.activeId)) {
      toast('session.nameDuplicate');
      return false;
    }
    try {
      state.activeName = trimmed;
      const index = buildIndex({ name: trimmed });
      const current = state.sessions.find((session) => session.id === state.activeId);
      if (current) current.name = trimmed;
      await state.storage.putSession(index, buildData());
      updateHeader();
      toast('session.renamed');
      return true;
    } catch (err) {
      banner('banner.renameFailed', { error: err.message || err }, 'bad');
      return false;
    }
  }

  async function renameSession() {
    if (state.busy || !state.activeId) return;
    const raw = window.prompt(I18n.t('session.promptRename'), state.activeName);
    if (raw === null) return;
    await renameSessionTo(raw);
  }

  async function deleteSessionById(id, ask = false) {
    if (state.busy || !id) return false;
    const target = state.sessions.find((session) => session.id === id);
    if (!target) return false;
    if (ask && !window.confirm(I18n.t('session.deleteConfirm', { name: target.name }))) {
      return false;
    }
    const wasActive = id === state.activeId;
    state.busy = true;
    updateBusyUi();
    try {
      await state.storage.deleteSession(id);
      state.sessions = state.sessions.filter((session) => session.id !== id);
      if (wasActive) {
        if (state.sessions.length === 0) {
          const created = await createSessionRecord(I18n.t('session.defaultName'));
          await loadSessionIntoState(created.id);
          await state.storage.putMeta({ key: 'active', value: created.id });
          await applyNamespaceForActiveSession();
        } else {
          const next = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
          await loadSessionIntoState(next.id);
          await state.storage.putMeta({ key: 'active', value: next.id });
          await applyNamespaceForActiveSession();
        }
      } else {
        renderSessionSelect();
      }
      toast('session.deleted');
      return true;
    } catch (err) {
      console.warn(err);
      banner('banner.deleteFailed', { error: err.message || err }, 'bad', true);
      return false;
    } finally {
      state.busy = false;
      updateBusyUi();
      refreshInspector();
    }
  }

  async function deleteSession() {
    if (state.busy || !state.activeId) return;
    await deleteSessionById(state.activeId, true);
  }

  async function clearCurrentSession(ask = true) {
    if (state.busy || !state.ready || !state.activeId) return false;
    if (ask && !window.confirm(I18n.t('session.clearConfirm', { name: state.activeName }))) {
      return false;
    }
    state.busy = true;
    updateBusyUi();
    try {
      if (py) {
        py.reset();
        applyLibraries(false);
        py.setPlotTheme(state.ui.theme);
      }
      state.history = [];
      state.redoStack = [];
      state.executionCount = 0;
      state.draft = '';
      state.namespace = null;
      state.namespaceMeta = null;
      state.historyNav = { index: null, draft: '' };
      state.activeOutput = null;
      renderConsole();
      resetEditorForSession('');
      updateHeader();
      refreshInspector();
      updateHistoryButtons();
      setStatus('status.ready');
      toast('session.cleared');
      await queueSave({ snapshot: false });
      return true;
    } catch (err) {
      console.warn('clear session failed', err);
      banner('session.clearFailed', { error: err.message || err }, 'bad', true);
      return false;
    } finally {
      state.busy = false;
      updateBusyUi();
      updateHistoryButtons();
    }
  }

  // ---------------------------------------------------------------------
  // Python glue: libraries, namespace restore, inspector
  // ---------------------------------------------------------------------

  async function applyNamespaceForActiveSession() {
    if (!py) return;
    setStage('overlay.restore');
    window.__pycalcBootStage = 'restore:start';
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      window.__pycalcBootStage = 'restore:reset';
      py.reset();
      window.__pycalcBootStage = 'restore:libraries';
      const libResult = JSON.parse(py.setLibraries(
        JSON.stringify(state.libraries), JSON.stringify(libraryAliasMap())
      ));
      if (libResult.conflicts && libResult.conflicts.length) {
        banner('banner.libraryConflict', { names: libResult.conflicts.join(', ') }, 'warn', true);
      }
      if (libResult.errors && libResult.errors.length) {
        banner('banner.libraryImport', { names: libResult.errors.join('; ') }, 'bad', true);
      }
      window.__pycalcBootStage = 'restore:imports';
      const codes = state.history.map((entry) => entry.code).filter(Boolean);
      const replay = JSON.parse(py.replayImports(JSON.stringify(codes)));
      if (replay.failed && replay.failed.length) {
        banner('banner.importReplay', { names: replay.failed.slice(0, 3).join('; ') });
      }
      const meta = state.namespaceMeta;
      if (meta && state.namespace &&
          ((meta.pythonVersion && meta.pythonVersion !== CFG.pythonVersion) ||
           (meta.pyodideVersion && meta.pyodideVersion !== CFG.pyodideVersion))) {
        banner('banner.versionMismatch', {
          fromPyodide: meta.pyodideVersion || '?',
          fromPython: meta.pythonVersion || '?',
          toPyodide: CFG.pyodideVersion,
          toPython: CFG.pythonVersion,
        });
      }
      window.__pycalcBootStage = 'restore:snapshot';
      if (state.namespace) {
        const bytes = new Uint8Array(state.namespace);
        pyodide.FS.writeFile('/tmp/pycalc-restore.bin', bytes);
        const info = JSON.parse(py.restore('/tmp/pycalc-restore.bin'));
        if (!info.ok) {
          banner('banner.restoreFailed', { error: info.error || I18n.t('error.unknown') }, 'warn', true);
        } else if (info.failed && info.failed.length) {
          banner('banner.partialRestore', {
            count: info.failed.length,
            names: info.failed.slice(0, 4).map((item) => item.name).join(', '),
          }, 'warn', true);
        }
      }
    } catch (err) {
      console.warn('restore failed', err);
      banner('banner.restoreFailed', { error: err.message || err }, 'bad', true);
    }
    window.__pycalcBootStage = 'restore:inspector';
    refreshInspector();
    // Importing pyplot (inside reset/setLibraries) can reset rcParams to the
    // default style; re-apply the UI plot theme after the namespace is ready.
    if (py) {
      try { py.setPlotTheme(state.ui.theme); } catch (err) { console.warn('plot theme failed', err); }
    }
    window.__pycalcBootStage = 'restore:done';
  }

  function applyLibraries(announce = true) {
    if (!py) return [];
    try {
      const result = JSON.parse(py.setLibraries(
        JSON.stringify(state.libraries), JSON.stringify(libraryAliasMap())
      ));
      const conflicts = result.conflicts || [];
      if (announce && conflicts.length) {
        banner('banner.libraryConflict', { names: conflicts.join(', ') }, 'warn', true);
      }
      if (announce && result.errors && result.errors.length) {
        banner('banner.libraryImport', { names: result.errors.join('; ') }, 'bad', true);
      }
      return conflicts;
    } catch (err) {
      console.warn('set libraries failed', err);
      return [];
    }
  }

  async function onLibraryChange() {
    const checked = [...$('library-list').querySelectorAll('input[type="checkbox"]')]
      .filter((input) => input.checked)
      .map((input) => input.value);
    state.libraries = checked;
    for (const label of $('library-list').querySelectorAll('.lib-chip')) {
      const input = label.querySelector('input');
      label.classList.toggle('checked', Boolean(input && input.checked));
    }
    applyLibraries(true);
    if (py) {
      try { py.setPlotTheme(state.ui.theme); } catch (err) { console.warn('plot theme failed', err); }
    }
    refreshInspector();
    if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
    queueSave({ snapshot: false });
  }

  function refreshCompletions() {
    state.attributeCache.clear();
    if (!py || !state.ready) {
      state.completions = [];
      return;
    }
    try {
      const rows = JSON.parse(py.listCompletions());
      state.completions = Array.isArray(rows) ? rows : [];
    } catch (err) {
      console.warn('list completions failed', err);
      state.completions = [];
    }
  }

  function getCompletionOptions() {
    const items = state.completions.map((item) => ({
      label: item.label,
      type: item.type || 'variable',
      detail: item.detail || '',
      info: item.type === 'function'
        ? `${item.label}${item.detail || '(...)'}`
        : `${item.label} : ${item.detail || item.type || ''}`,
    }));
    const seen = new Set(items.map((item) => item.label));
    for (const [label, detail] of BUILTIN_COMPLETIONS) {
      if (seen.has(label)) continue;
      seen.add(label);
      items.push({
        label,
        type: 'function',
        detail,
        info: `${label}${detail}`,
      });
    }
    return items;
  }

  function getAttributeCompletions(expr, code = '') {
    const key = String(expr || '');
    if (state.attributeCache.has(key)) return state.attributeCache.get(key);
    const empty = { expr: key, type: null, source: 'live', items: [] };
    if (!py || !state.ready || !key) return empty;
    try {
      const data = JSON.parse(py.attributeItems(key, String(code || '')));
      const value = {
        expr: data.expr || key,
        type: data.type || null,
        source: data.source || 'live',
        items: Array.isArray(data.items) ? data.items : [],
      };
      // Live objects are stable until the next execution; static inference
      // depends on the editor text, so it is not cached across edits.
      if (value.source === 'live') state.attributeCache.set(key, value);
      return value;
    } catch (err) {
      console.warn('attribute completion failed', err);
      return empty;
    }
  }

  function signatureFor(name) {
    if (!name) return null;
    if (name.includes('.')) {
      const index = name.lastIndexOf('.');
      const expr = name.slice(0, index);
      const attr = name.slice(index + 1);
      const data = getAttributeCompletions(expr);
      const item = data.items.find((row) => row.label === attr);
      if (item && (item.type === 'function' || item.type === 'method')) {
        return item.detail || '(...)';
      }
      return null;
    }
    const item = state.completions.find((row) => row.label === name);
    if (item && item.type === 'function') return item.detail || '(...)';
    const builtin = BUILTIN_COMPLETIONS.find((row) => row[0] === name);
    if (builtin) return builtin[1];
    return null;
  }

  function refreshInspector() {
    const varsBody = $('vars-body');
    const funcsBody = $('funcs-body');
    const varsCard = varsBody.closest('.side-card');
    const funcsCard = funcsBody.closest('.side-card');
    varsBody.innerHTML = '';
    funcsBody.innerHTML = '';
    if (!py || !state.ready) {
      state.completions = [];
      varsCard.classList.add('empty');
      funcsCard.classList.add('empty');
      return;
    }
    refreshCompletions();
    try {
      const vars = JSON.parse(py.listVars());
      for (const row of vars) {
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', row.name));
        const typeCell = el('td', '', row.type);
        typeCell.title = row.type;
        tr.appendChild(typeCell);
        const valueCell = el('td', '', row.value);
        valueCell.title = row.value;
        tr.appendChild(valueCell);
        varsBody.appendChild(tr);
      }
      varsCard.classList.toggle('empty', vars.length === 0);
    } catch (err) {
      console.warn('list variables failed', err);
      varsCard.classList.add('empty');
    }
    try {
      const funcs = JSON.parse(py.listFuncs());
      for (const row of funcs) {
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', row.name));
        const paramsCell = el('td', '', row.params);
        paramsCell.title = row.params;
        tr.appendChild(paramsCell);
        funcsBody.appendChild(tr);
      }
      funcsCard.classList.toggle('empty', funcs.length === 0);
    } catch (err) {
      console.warn('list functions failed', err);
      funcsCard.classList.add('empty');
    }
  }

  // ---------------------------------------------------------------------
  // Console rendering
  // ---------------------------------------------------------------------

  function revokeObjectUrls() {
    for (const url of state.objectUrls) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
    state.objectUrls = [];
  }

  function makeImage(blob, mime) {
    const img = document.createElement('img');
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    img.src = url;
    img.alt = 'figure';
    img.loading = 'lazy';
    img.dataset.mime = mime || 'image/png';
    img.addEventListener('load', () => scrollToBottom());
    return img;
  }

  function outputText(entry) {
    const parts = [];
    if (entry.stdout) parts.push(entry.stdout.replace(/\n$/, ''));
    if (entry.stderr) parts.push(entry.stderr.replace(/\n$/, ''));
    if (entry.result !== null && entry.result !== undefined) parts.push(String(entry.result));
    if (entry.error) parts.push(String(entry.error));
    return parts.filter(Boolean).join('\n');
  }

  function hasOutput(entry) {
    return Boolean(
      entry.stdout || entry.stderr ||
      (entry.result !== null && entry.result !== undefined) ||
      entry.error || (entry.images && entry.images.length)
    );
  }

  function promptButton(kind, n, entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `prompt-btn ${kind}`;
    button.dataset.kind = kind;
    button.dataset.n = String(n);
    button.textContent = `[${n}]`;
    button.title = I18n.t(kind === 'in' ? 'console.inputPromptTitle' : 'console.outputPromptTitle');
    button.addEventListener('click', () => insertEntryText(entry, kind));
    return button;
  }

  function insertEntryText(entry, kind) {
    const text = kind === 'in' ? entry.code : outputText(entry);
    if (!text) {
      toast('console.noText');
      return;
    }
    try {
      // Insert at the current selection; never clear the whole editor.
      editor.insertAtCursor(text);
      editor.focus();
      state.historyNav.index = null;
      toast(kind === 'in' ? 'console.copiedInput' : 'console.copiedOutput');
    } catch (err) {
      banner('banner.copyFailed', { error: err.message || err }, 'bad');
    }
  }

  function mathResult(mathml) {
    if (!mathml || typeof DOMParser === 'undefined') return null;
    try {
      // SymPy emits MathML named entities such as &InvisibleTimes;, which
      // the XML parser rejects. The HTML parser resolves them and keeps the
      // MathML namespace, so use it and extract the <math> element.
      const parsed = new DOMParser().parseFromString(mathml, 'text/html');
      const root = parsed.querySelector('math');
      if (!root) return null;
      const wrapper = el('div', 'math-result');
      const imported = document.importNode(root, true);
      for (const bad of imported.querySelectorAll('script,iframe,object,embed,foreignObject')) {
        bad.remove();
      }
      for (const node of [imported, ...imported.querySelectorAll('*')]) {
        for (const attr of [...node.attributes]) {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) node.removeAttribute(attr.name);
          if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
            node.removeAttribute(attr.name);
          }
        }
      }
      wrapper.appendChild(imported);
      return wrapper;
    } catch (err) {
      console.warn('mathml render failed', err);
      return null;
    }
  }

  function makeCell(entry) {
    const cell = el('div', 'entry');
    const inputRow = el('div', 'io-row');
    inputRow.appendChild(promptButton('in', entry.n, entry));
    inputRow.appendChild(el('pre', 'code', entry.code));
    cell.appendChild(inputRow);

    if (hasOutput(entry)) {
      const outputRow = el('div', 'io-row');
      outputRow.appendChild(promptButton('out', entry.n, entry));
      const body = el('div', 'output-body');
      if (entry.stdout) body.appendChild(el('pre', 'stream', entry.stdout));
      if (entry.stderr) body.appendChild(el('pre', 'stream stderr', entry.stderr));
      if (entry.result !== null && entry.result !== undefined) {
        const math = state.ui.sympyOutput === 'math' ? mathResult(entry.resultMathML) : null;
        if (math) body.appendChild(math);
        else body.appendChild(el('pre', 'result', entry.result));
      }
      if (entry.error) body.appendChild(el('pre', 'error', entry.error));
      if (entry.images && entry.images.length) {
        const images = el('div', 'images');
        for (const image of entry.images) {
          if (image && image.blob) images.appendChild(makeImage(image.blob, image.mime));
        }
        if (images.childNodes.length) body.appendChild(images);
      }
      outputRow.appendChild(body);
      cell.appendChild(outputRow);
    }
    return cell;
  }

  function emptyConsole() {
    const node = el('div', 'empty-state');
    node.appendChild(el('strong', '', I18n.t('console.emptyTitle')));
    node.appendChild(el('p', '', I18n.t('console.emptyBody', {
      key: I18n.t(state.ui.runKey === 'enter' ? 'run.enter' : 'run.ctrlEnter'),
    })));
    node.appendChild(el('p', '', I18n.t('console.emptyBody2')));
    return node;
  }

  function renderConsole() {
    revokeObjectUrls();
    const host = $('console');
    host.innerHTML = '';
    if (!state.history.length) {
      host.appendChild(emptyConsole());
      return;
    }
    for (const entry of state.history) host.appendChild(makeCell(entry));
    requestAnimationFrame(() => scrollToBottom());
  }

  function scrollToBottom() {
    const host = $('console');
    host.scrollTop = host.scrollHeight;
  }

  function updateHistoryButtons() {
    const undo = $('history-undo');
    const redo = $('history-redo');
    if (!undo || !redo) return;
    undo.disabled = state.busy || state.history.length === 0;
    redo.disabled = state.busy || state.redoStack.length === 0;
  }

  function undoHistory() {
    if (state.busy || state.history.length === 0) return;
    const entry = state.history.pop();
    state.redoStack.push(entry);
    if (entry.n === state.executionCount) {
      state.executionCount = Math.max(0, state.executionCount - 1);
    }
    state.historyNav = { index: null, draft: '' };
    renderConsole();
    updateHistoryButtons();
    queueSave({ snapshot: false });
  }

  function redoHistory() {
    if (state.busy || state.redoStack.length === 0) return;
    const entry = state.redoStack.pop();
    state.history.push(entry);
    state.executionCount = Math.max(state.executionCount, Number(entry.n) || 0);
    state.historyNav = { index: null, draft: '' };
    renderConsole();
    updateHistoryButtons();
    queueSave({ snapshot: false });
  }

  function createLiveCell(entry) {
    const host = $('console');
    const empty = host.querySelector('.empty-state');
    if (empty) empty.remove();

    const cell = el('div', 'entry');
    const inputRow = el('div', 'io-row');
    inputRow.appendChild(promptButton('in', entry.n, entry));
    inputRow.appendChild(el('pre', 'code', entry.code));
    cell.appendChild(inputRow);

    const outputRow = el('div', 'io-row hidden');
    outputRow.appendChild(promptButton('out', entry.n, entry));
    const body = el('div', 'output-body');
    const stdoutEl = el('pre', 'stream');
    const stderrEl = el('pre', 'stream stderr');
    stdoutEl.classList.add('hidden');
    stderrEl.classList.add('hidden');
    body.appendChild(stdoutEl);
    body.appendChild(stderrEl);
    outputRow.appendChild(body);
    cell.appendChild(outputRow);
    host.appendChild(cell);
    scrollToBottom();

    const ensureVisible = (node) => {
      outputRow.classList.remove('hidden');
      node.classList.remove('hidden');
    };

    return {
      cell,
      stdout(text) {
        ensureVisible(stdoutEl);
        stdoutEl.textContent += text;
        scrollToBottom();
      },
      stderr(text) {
        ensureVisible(stderrEl);
        stderrEl.textContent += text;
        scrollToBottom();
      },
      finish(finalEntry) {
        const stored = makeCell(finalEntry);
        cell.replaceWith(stored);
        requestAnimationFrame(() => scrollToBottom());
      },
    };
  }

  // ---------------------------------------------------------------------
  // Editor and run behaviour
  // ---------------------------------------------------------------------

  function setEditorText(value, updateDraft = true) {
    if (!editor) return;
    state.suppressEditorSave = true;
    try {
      editor.setValue(value == null ? '' : String(value));
      if (typeof editor.setCursorEnd === 'function') editor.setCursorEnd();
      if (updateDraft) state.draft = value == null ? '' : String(value);
    } finally {
      state.suppressEditorSave = false;
    }
  }

  function resetEditorForSession(value) {
    if (!editor) return;
    state.suppressEditorSave = true;
    try {
      if (typeof editor.reset === 'function') editor.reset(value || '');
      else editor.setValue(value || '');
      state.draft = value || '';
    } finally {
      state.suppressEditorSave = false;
    }
  }

  function onEditorChange(value) {
    if (state.suppressEditorSave) return;
    state.draft = value;
    state.historyNav.index = null;
    state.historyNav.draft = value;
    scheduleSave({ snapshot: false, delay: 1000 });
  }

  function navigateHistory(delta) {
    if (!state.ready || state.busy || state.history.length === 0) return false;
    if (state.historyNav.index === null) {
      state.historyNav.draft = editor.getValue();
      state.historyNav.index = state.history.length;
    }
    let next = state.historyNav.index + delta;
    if (next < 0) return true;
    if (next >= state.history.length) {
      state.historyNav.index = null;
      setEditorText(state.historyNav.draft, false);
    } else {
      state.historyNav.index = next;
      setEditorText(state.history[next].code, false);
    }
    if (typeof editor.setCursorEnd === 'function') editor.setCursorEnd();
    return true;
  }

  function tryRunOnEnter() {
    if (state.ui.runKey !== 'enter' || !state.ready || state.busy || !py) return false;
    const code = editor.getValue();
    if (!code.trim()) return false;
    try {
      const info = JSON.parse(py.isComplete(code));
      if (!info.complete) return false;
    } catch (err) {
      console.warn('completeness check failed', err);
      return false;
    }
    runCode();
    return true;
  }

  async function runCode() {
    if (!state.ready || state.busy) return undefined;
    const code = editor.getValue();
    if (!code.trim()) return undefined;

    // Clear the input immediately; the submitted code is kept in history.
    setEditorText('', true);
    state.historyNav.index = null;
    state.historyNav.draft = '';

    state.busy = true;
    state.running = true;
    state.redoStack = [];
    updateBusyUi();
    const n = state.executionCount + 1;
    state.executionCount = n;
    const entry = {
      n,
      code,
      ts: Date.now(),
      status: 'running',
      stdout: '',
      stderr: '',
      result: null,
      resultMathML: null,
      resultLatex: null,
      error: null,
      images: [],
    };
    state.history.push(entry);
    const live = createLiveCell(entry);
    state.activeOutput = {
      stdout: (text) => { entry.stdout += text; live.stdout(text); },
      stderr: (text) => { entry.stderr += text; live.stderr(text); },
    };
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const result = JSON.parse(py.run(code));
      entry.status = result.ok ? 'ok' : 'error';
      entry.result = result.ok ? result.result : null;
      entry.resultMathML = result.ok ? (result.resultMathML || null) : null;
      entry.resultLatex = result.ok ? (result.resultLatex || null) : null;
      entry.error = result.ok ? null : result.error;
      try {
        const images = JSON.parse(py.figures());
        entry.images = (images || []).map((data) => ({
          mime: 'image/png',
          blob: new Blob([b64ToBytes(data)], { type: 'image/png' }),
        }));
      } catch (err) {
        console.warn('figure capture failed', err);
      }
    } catch (err) {
      entry.status = 'error';
      entry.error = String((err && err.stack) || err);
    } finally {
      flushStreams();
      state.activeOutput = null;
      live.finish(entry);
      state.busy = false;
      state.running = false;
      refreshInspector();
      updateBusyUi();
      scheduleSave({ snapshot: true, delay: 250 });
      if (editor) editor.focus();
    }
    return entry;
  }

  function updateBusyUi() {
    $('run').disabled = state.busy || !state.ready;
    $('session-select').disabled = state.busy;
    $('session-new').disabled = state.busy;
    $('session-rename').disabled = state.busy;
    $('session-clear').disabled = state.busy;
    $('session-delete').disabled = state.busy;
    $('language-select').disabled = state.busy;
    $('run-key').disabled = state.busy;
    $('theme-toggle').disabled = state.busy;
    $('sympy-output-toggle').disabled = state.busy;
    for (const input of $('library-list').querySelectorAll('input')) {
      input.disabled = state.busy;
    }
    $('run').textContent = state.running
      ? I18n.t('run.running')
      : state.busy ? I18n.t('run.processing') : I18n.t('run.button');
    updateHistoryButtons();
  }

  // ---------------------------------------------------------------------
  // UI settings: language, theme, run key, sidebar
  // ---------------------------------------------------------------------

  function renderRunHint() {
    $('run-hint').textContent = I18n.t(
      state.ui.runKey === 'enter' ? 'run.hintEnter' : 'run.hintCtrl'
    );
    $('run-key').value = state.ui.runKey;
    window.__pycalcRunKeyMode = state.ui.runKey;
  }

  function applyTheme(theme, persist = true) {
    state.ui.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.ui.theme;
    $('theme-toggle').textContent = state.ui.theme === 'dark' ? '☀' : '☾';
    $('theme-toggle').title = I18n.t('theme.toggleTitle');
    if (editor && typeof editor.setTheme === 'function') editor.setTheme(state.ui.theme);
    if (py) {
      try { py.setPlotTheme(state.ui.theme); } catch (err) { console.warn('plot theme failed', err); }
    }
    if (persist) saveUiMeta();
  }

  function applyRunKey(runKey, persist = true) {
    state.ui.runKey = runKey === 'enter' ? 'enter' : 'ctrl-enter';
    renderRunHint();
    if (!state.history.length) renderConsole();
    if (persist) saveUiMeta();
  }

  function renderSympyControl() {
    const button = $('sympy-output-toggle');
    if (!button) return;
    const available = AVAILABLE_LIB_IDS.has('sympy');
    button.classList.toggle('hidden', !available);
    const math = state.ui.sympyOutput === 'math';
    button.textContent = math ? '∑' : 'T';
    button.title = I18n.t(math ? 'sympyOutput.toggleMath' : 'sympyOutput.toggleText');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(math));
  }

  function applySympyOutput(mode, persist = true) {
    state.ui.sympyOutput = mode === 'math' ? 'math' : 'text';
    renderSympyControl();
    if (!state.busy) renderConsole();
    if (persist) saveUiMeta();
  }

  function clampSidebarWidth(value) {
    const max = Math.max(220, Math.min(520, window.innerWidth * 0.45));
    const parsed = Number(value);
    return Math.max(200, Math.min(Number.isFinite(parsed) ? parsed : 292, max));
  }

  function applySidebarWidth(value, persist = false) {
    state.ui.sidebarWidth = clampSidebarWidth(value);
    document.documentElement.style.setProperty('--sidebar-width', `${state.ui.sidebarWidth}px`);
    if (persist) saveUiMeta();
  }

  function applySidebar() {
    const mobile = window.innerWidth <= 880;
    document.body.classList.toggle('sidebar-collapsed', !mobile && state.ui.sidebarHidden);
    document.body.classList.toggle('sidebar-open', mobile && state.mobileSidebarOpen);
    applySidebarWidth(state.ui.sidebarWidth);
  }

  function applySessionBar() {
    const mobile = window.innerWidth <= 880;
    const hidden = mobile && state.ui.sessionBarHidden;
    document.body.classList.toggle('session-bar-hidden', hidden);
    const button = $('session-bar-toggle');
    if (!button) return;
    button.textContent = hidden ? '▼' : '▲';
    button.title = I18n.t(hidden ? 'session.showBar' : 'session.hideBar');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!hidden));
  }

  async function setLanguage(lang) {
    state.ui.language = MESSAGES[lang] ? lang : 'en';
    applyLanguageToUi();
    hideBanner();
    $('toast').classList.add('hidden');
    await saveUiMeta();
  }

  function applyLanguageToUi() {
    I18n.setLanguage(state.ui.language);
    $('language-select').value = state.ui.language;
    $('theme-toggle').title = I18n.t('theme.toggleTitle');
    $('session-select').title = I18n.t('session.selectTitle');
    $('sidebar-toggle').title = I18n.t('sidebar.toggleTitle');
    $('run-key').value = state.ui.runKey;
    renderRunHint();
    renderStatus();
    updateBusyUi();
    applySessionBar();
    renderLibraryBar();
    renderSympyControl();
    updateHistoryButtons();
    if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
    renderConsole();
    refreshInspector();
    renderOverlay();
    if (editor && typeof editor.setPlaceholder === 'function') {
      editor.setPlaceholder(I18n.t('editor.placeholder'));
    }
  }

  function initMobileKeyboardUi() {
    if (mobileKeyboard || !window.initMobileKeyboard || !editor || !editor.getContentDOM) return;
    if (!CFG.keyboard) return;
    mobileKeyboard = window.initMobileKeyboard({
      layout: CFG.keyboard,
      t: (key) => I18n.t(key),
      insert: (text) => editor.insertAtCursor(text, { focus: false }),
      run: () => runCode(),
      getVariables: () => {
        try { return py ? JSON.parse(py.listVars()) : []; } catch (_) { return []; }
      },
      getFunctions: () => {
        try { return py ? JSON.parse(py.listFuncs()) : []; } catch (_) { return []; }
      },
      getLibraries: () => AVAILABLE_LIBS,
      getSelectedLibraries: () => {
        const byId = new Map(AVAILABLE_LIBS.map((lib) => [lib.id, lib]));
        return state.libraries.map((id) => byId.get(id)).filter(Boolean);
      },
      getTextBeforeCursor: () => editor.getTextBeforeCursor && editor.getTextBeforeCursor(),
      notify: (key) => toast(key),
      undo: () => editor.undo && editor.undo(),
      backspace: () => editor.deleteCharBefore && editor.deleteCharBefore(),
      tab: () => editor.insertTab && editor.insertTab(),
      newline: () => editor.insertNewline && editor.insertNewline(),
      clear: () => setEditorText('', true),
      triggerAutocomplete: () => {
        if (editor && editor.triggerAutocomplete) editor.triggerAutocomplete();
      },
      triggerSignature: () => {
        if (editor && editor.triggerSignature) editor.triggerSignature();
      },      
      moveCursor: (direction) => editor.moveCursor && editor.moveCursor(direction),
      moveLineStart: () => editor.moveLineStart && editor.moveLineStart(),
      moveLineEnd: () => editor.moveLineEnd && editor.moveLineEnd(),
      getEditorContentDOM: () => editor.getContentDOM && editor.getContentDOM(),
      setEditable: (editable) => editor.setEditable && editor.setEditable(editable),
      setCursorFromPoint: (x, y) => editor.setCursorFromPoint && editor.setCursorFromPoint(x, y),
    });
  }

  // ---------------------------------------------------------------------
  // Events and boot
  // ---------------------------------------------------------------------

  function bindUi() {
    $('run').addEventListener('click', runCode);
    $('session-select').addEventListener('change', (event) => switchSession(event.target.value));
    $('session-new').addEventListener('click', newSession);
    $('session-rename').addEventListener('click', renameSession);
    $('session-clear').addEventListener('click', () => clearCurrentSession(true));
    $('session-delete').addEventListener('click', deleteSession);
    $('history-undo').addEventListener('click', undoHistory);
    $('history-redo').addEventListener('click', redoHistory);
    $('overlay-retry').addEventListener('click', () => location.reload());
    $('language-select').addEventListener('change', (event) => setLanguage(event.target.value));
    $('run-key').addEventListener('change', (event) => applyRunKey(event.target.value));
    $('sympy-output-toggle').addEventListener('click', () => {
      applySympyOutput(state.ui.sympyOutput === 'math' ? 'text' : 'math');
    });
    $('theme-toggle').addEventListener('click', () => {
      applyTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    });
    $('session-bar-toggle').addEventListener('click', () => {
      if (window.innerWidth > 880) return;
      state.ui.sessionBarHidden = !state.ui.sessionBarHidden;
      applySessionBar();
      saveUiMeta();
    });
    $('sidebar-toggle').addEventListener('click', () => {
      if (window.innerWidth <= 880) {
        state.mobileSidebarOpen = !state.mobileSidebarOpen;
      } else {
        state.ui.sidebarHidden = !state.ui.sidebarHidden;
        saveUiMeta();
      }
      applySidebar();
    });
    window.addEventListener('resize', applySidebar);
    window.addEventListener('resize', applySessionBar);

    const resizer = $('sidebar-resizer');
    let resizing = false;
    const resizeMove = (event) => {
      if (!resizing) return;
      const workspace = $('workspace').getBoundingClientRect();
      applySidebarWidth(event.clientX - workspace.left);
    };
    const resizeEnd = () => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove('resizing-sidebar');
      applySidebarWidth(state.ui.sidebarWidth, true);
    };
    resizer.addEventListener('pointerdown', (event) => {
      if (window.innerWidth <= 880) return;
      resizing = true;
      document.body.classList.add('resizing-sidebar');
      if (typeof resizer.setPointerCapture === 'function') {
        try { resizer.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      event.preventDefault();
    });
    window.addEventListener('pointermove', resizeMove);
    window.addEventListener('pointerup', resizeEnd);
    window.addEventListener('pointercancel', resizeEnd);

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        runCode();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.ready) saveNow().catch(() => {});
    });

    window.addEventListener('error', (event) => {
      console.error(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
    });
  }

  function createEditor() {
    const textarea = $('editor');
    if (window.PyCalcEditor && typeof window.PyCalcEditor.create === 'function') {
      const host = el('div', 'cm-host');
      const initial = textarea.value;
      textarea.replaceWith(host);
      const cm = window.PyCalcEditor.create(host, {
        value: initial,
        theme: state.ui.theme,
        placeholder: I18n.t('editor.placeholder'),
        onChange: onEditorChange,
        onRun: runCode,
        onTryEnter: tryRunOnEnter,
        onHistory: navigateHistory,
        getCompletions: getCompletionOptions,
        getAttributes: getAttributeCompletions,
        getSignature: signatureFor,
        onTypeHint: setTypeHint,
      });
      return {
        isCodeMirror: true,
        getValue: () => cm.getValue(),
        setValue: (value) => cm.setValue(value),
        insertAtCursor: (text, options) => cm.insertAtCursor(text, options),
        insertTab: () => cm.insertTab(),
        insertNewline: () => cm.insertNewline(),
        undo: () => cm.undo(),
        deleteCharBefore: () => cm.deleteCharBefore(),
        moveCursor: (direction) => cm.moveCursor(direction),
        moveLineStart: () => cm.moveLineStart(),
        moveLineEnd: () => cm.moveLineEnd(),
        getContentDOM: () => cm.getContentDOM(),
        getTextBeforeCursor: () => cm.getTextBeforeCursor(),
        setEditable: (editable) => cm.setEditable(editable),
        setCursorFromPoint: (x, y) => cm.setCursorFromPoint(x, y),
        setCursorEnd: () => cm.setCursorEnd(),
        setTheme: (theme) => cm.setTheme(theme),
        setPlaceholder: (text) => cm.setPlaceholder(text),
        reset: (value) => cm.reset(value),
        focus: () => cm.focus(),
        triggerAutocomplete: () => cm.triggerAutocomplete(),
        triggerSignature: () => cm.triggerSignature(),        
      };
    }

    const onInput = () => onEditorChange(textarea.value);
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', (event) => {
      const composing = event.isComposing || event.keyCode === 229;
      if (composing) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        runCode();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && state.ui.runKey === 'enter' && !state.busy) {
        if (tryRunOnEnter()) event.preventDefault();
        return;
      }
      if (event.key === 'ArrowUp') {
        const before = textarea.value.slice(0, textarea.selectionStart);
        if (!before.includes('\n') && textarea.selectionStart === textarea.selectionEnd) {
          if (navigateHistory(-1)) event.preventDefault();
        }
      } else if (event.key === 'ArrowDown') {
        const after = textarea.value.slice(textarea.selectionEnd);
        if (!after.includes('\n') && textarea.selectionStart === textarea.selectionEnd) {
          if (navigateHistory(1)) event.preventDefault();
        }
      } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.setRangeText('    ', start, end, 'end');
        onInput();
      }
    });
    return {
      isCodeMirror: false,
      getValue: () => textarea.value,
      setValue: (value) => {
        textarea.value = value || '';
        state.suppressEditorSave = true;
        try { state.draft = textarea.value; } finally { state.suppressEditorSave = false; }
      },
      insertAtCursor: (text) => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.setRangeText(text, start, end, 'end');
        onInput();
      },
      setCursorEnd: () => {
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      },
      setTheme: () => {},
      setPlaceholder: (text) => { textarea.placeholder = text; },
      reset: (value) => {
        textarea.value = value || '';
        state.suppressEditorSave = true;
        try { state.draft = textarea.value; } finally { state.suppressEditorSave = false; }
      },
      focus: () => textarea.focus(),
      triggerAutocomplete: () => {},
      triggerSignature: () => {},      
    };
  }

  async function boot() {
    bindUi();
    I18n.setLanguage(detectLanguage());
    setOverlay('overlay.startTitle', 'overlay.startDetail');
    installFetchShim();

    setOverlay('overlay.startTitle', 'overlay.db');
    try {
      state.storage = await openStorage();
    } catch (err) {
      console.warn('IndexedDB unavailable', err);
      state.storage = new MemoryStorage();
      banner('banner.idbUnavailable', { error: err.message || err }, 'bad', true);
    }

    state.ui = await loadUiMeta();
    I18n.setLanguage(state.ui.language);
    document.documentElement.dataset.theme = state.ui.theme;
    $('language-select').value = state.ui.language;
    $('run-key').value = state.ui.runKey;
    $('theme-toggle').textContent = state.ui.theme === 'dark' ? '☀' : '☾';
    window.__pycalcRunKeyMode = state.ui.runKey;
    applySidebar();
    applySessionBar();

    editor = createEditor();
    applyLanguageToUi();
    state.sessions = (await state.storage.listSessions()) || [];
    await restoreActiveSession();

    setOverlay('overlay.startTitle', 'overlay.runtime', {
      version: CFG.pyodideVersion, python: CFG.pythonVersion,
    });
    try {
      await loadRuntime();
    } catch (err) {
      console.error(err);
      setOverlay(
        'overlay.runtimeTitle',
        'overlay.runtimeDetail',
        {},
        String((err && err.stack) || err)
      );
      return;
    }

    try {
      const test = JSON.parse(py.selfTest());
      setEngine(test.engine);
      if (test.engine === 'json') banner('banner.cloudpickleUnavailable', {}, 'warn', true);
    } catch (err) {
      console.warn('self test failed', err);
      setEngine('json');
    }

    window.__pycalcBootStage = 'boot:apply-namespace';
    await applyNamespaceForActiveSession();
    window.__pycalcBootStage = 'boot:ready';

    state.ready = true;
    window.__pycalcReady = true;
    refreshInspector();
    updateBusyUi();
    hideOverlay();
    setStatus('status.ready');
    initMobileKeyboardUi();
    if (editor) editor.focus();
    if (!state.history.length) renderConsole();
  }

  // Used by the CodeMirror Mod-Enter keymap and developer tooling.
  window.__pycalcRun = runCode;

  window.__pycalc = {
    get ready() { return state.ready; },
    engine: () => state.engine,
    sessions: () => state.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      executionCount: session.executionCount,
    })),
    active: () => ({
      id: state.activeId,
      name: state.activeName,
      count: state.executionCount,
      libraries: [...state.libraries],
    }),
    history: () => state.history.map((entry) => ({
      n: entry.n,
      code: entry.code,
      status: entry.status,
      result: entry.result,
      error: entry.error,
      stdout: entry.stdout,
      stderr: entry.stderr,
      images: (entry.images || []).length,
    })),
    undo: () => { undoHistory(); return state.history.length; },
    redo: () => { redoHistory(); return state.history.length; },
    clearSession: () => clearCurrentSession(false),
    runCell: async (code) => {
      if (!state.ready) throw new Error('PyCalc is not ready');
      setEditorText(code, true);
      return runCode();
    },
    createSession: createSessionByName,
    renameSession: renameSessionTo,
    switchSession: async (id) => {
      await switchSession(id);
      return state.activeId;
    },
    deleteSession: deleteSessionById,
    saveNow,
    lastEntry: () => state.history[state.history.length - 1] || null,
    setLanguage,
    setTheme: (theme) => applyTheme(theme),
    setPlotTheme: (theme) => (py ? py.setPlotTheme(theme) : null),
    setRunKey: (key) => applyRunKey(key),
    setSympyOutput: (mode) => applySympyOutput(mode),
    selectLibraries: async (ids) => {
      state.libraries = normalizeLibraryList(ids);
      renderLibraryBar();
      applyLibraries(true);
      refreshInspector();
      if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
      await queueSave({ snapshot: false });
      return [...state.libraries];
    },
    isComplete: (code) => {
      if (!py) return false;
      try { return Boolean(JSON.parse(py.isComplete(code)).complete); } catch (_) { return false; }
    },
    getEditorValue: () => (editor ? editor.getValue() : ''),
    setEditorText: (text) => setEditorText(text, true),
    historyNav: (delta) => navigateHistory(delta),
    tryRunOnEnter: () => tryRunOnEnter(),
    insertAtCursor: (text) => editor.insertAtCursor(text),
    variables: () => (py ? JSON.parse(py.listVars()) : []),
    functions: () => (py ? JSON.parse(py.listFuncs()) : []),
    completions: () => getCompletionOptions(),
    attributes: (expr) => getAttributeCompletions(expr),
    signature: (name) => signatureFor(name),
    ui: () => ({ ...state.ui }),
  };

  boot().catch((err) => {
    console.error(err);
    window.__pycalcBootError = String((err && err.stack) || err);
    setOverlay(
      'overlay.bootTitle',
      'overlay.bootDetail',
      {},
      window.__pycalcBootError
    );
  });
})();
