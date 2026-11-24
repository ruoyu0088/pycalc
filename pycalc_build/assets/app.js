(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------
  // Add-variable dialog
  // ---------------------------------------------------------------------

  function setupVariableDialog() {
    const title = document.querySelector('h3[data-i18n="sidebar.variables"]');
    if (!title) return;
    const label = document.createElement('span');
    label.dataset.i18n = title.dataset.i18n;
    title.removeAttribute('data-i18n');
    title.textContent = '';
    title.appendChild(label);
    const add = document.createElement('button');
    add.type = 'button';
    add.id = 'variable-add';
    add.className = 'icon-btn side-add-btn';
    add.dataset.i18nTitle = 'variables.addTitle';
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';

    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'sidebar-close';
    close.className = 'icon-btn side-add-btn mobile-only';
    close.dataset.i18nTitle = 'sidebar.closeTitle';
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';

    const actions = document.createElement('span');
    actions.className = 'side-head-actions';
    actions.appendChild(add);
    actions.appendChild(close);
    title.appendChild(actions);

    close.addEventListener('click', () => {
      if (window.innerWidth <= 880) {
        state.mobileSidebarOpen = false;
      } else {
        state.ui.sidebarHidden = true;
      }
      applySidebar();
    });

    const dialog = document.createElement('div');
    dialog.id = 'variable-dialog';
    dialog.className = 'display-dialog hidden';
    dialog.innerHTML = `
      <div class="display-backdrop" id="variable-backdrop"></div>
      <section class="display-panel variable-panel" role="dialog" aria-modal="true" aria-labelledby="variable-title">
        <header class="display-header">
          <h2 id="variable-title" data-i18n="variables.addTitle"></h2>
          <button id="variable-close" class="icon-btn" type="button" data-i18n-title="display.close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          </button>
        </header>
        <div class="display-body">
          <label id="variable-name-row" class="display-row variable-field">
            <span data-i18n="variables.name"></span>
            <input id="variable-name" class="compact-input" type="text" autocomplete="off" spellcheck="false">
          </label>
          <label class="display-row variable-field">
            <span data-i18n="variables.type"></span>
            <select id="variable-type" class="compact-select">
              <option value="string" data-i18n="variables.typeString"></option>
              <option value="array" data-i18n="variables.typeArray"></option>
              <option value="dataframe" data-i18n="variables.typeDataframe"></option>
              <option value="code" data-i18n="variables.typeCode"></option>
              <option value="snippet" data-i18n="variables.typeSnippet"></option>
            </select>
          </label>
          <label id="variable-ignore-spaces-row" class="display-check hidden">
            <input id="variable-ignore-spaces" type="checkbox">
            <span data-i18n="variables.ignoreSpaces"></span>
          </label>
          <label class="variable-text-label">
            <span id="variable-text-label-text" data-i18n="variables.text"></span>
            <textarea id="variable-text" class="variable-text" spellcheck="false"></textarea>
          </label>
          <div id="variable-error" class="variable-error hidden"></div>
          <div class="variable-actions">
            <button id="variable-cancel" class="secondary" type="button" data-i18n="variables.cancel"></button>
            <button id="variable-ok" class="run-btn" type="button" data-i18n="variables.ok"></button>
          </div>
        </div>
      </section>
    `;
    document.getElementById('app').appendChild(dialog);

    add.addEventListener('click', openVariableDialog);
    dialog.querySelector('#variable-close').addEventListener('click', closeVariableDialog);
    dialog.querySelector('#variable-cancel').addEventListener('click', closeVariableDialog);
    dialog.querySelector('#variable-backdrop').addEventListener('click', closeVariableDialog);
    dialog.querySelector('#variable-type').addEventListener('change', updateVariableTypeUi);
    dialog.querySelector('#variable-ok').addEventListener('click', submitVariableDialog);
    dialog.querySelector('#variable-text').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submitVariableDialog();
      }
    });
    document.addEventListener('keydown', (event) => {
      const node = $('variable-dialog');
      if (event.key === 'Escape' && node && !node.classList.contains('hidden')) {
        closeVariableDialog();
      }
    });
  }

  function openVariableDialog() {
    if (!state.ready || state.busy) {
      toast('variables.notReady');
      return;
    }
    const dialog = $('variable-dialog');
    if (!dialog) return;
    $('variable-name').value = '';
    $('variable-text').value = '';
    $('variable-type').value = 'string';
    $('variable-ignore-spaces').checked = false;
    $('variable-error').textContent = '';
    $('variable-error').classList.add('hidden');
    $('variable-ok').disabled = false;
    I18n.applyStatic(dialog);
    updateVariableTypeUi();
    dialog.classList.remove('hidden');
    $('variable-name').focus();
  }

  function closeVariableDialog() {
    const dialog = $('variable-dialog');
    if (dialog) dialog.classList.add('hidden');
  }

  function updateVariableTypeUi() {
    const type = $('variable-type') ? $('variable-type').value : 'string';
    const isCode = type === 'code';
    const isSnippet = type === 'snippet';
    const row = $('variable-ignore-spaces-row');
    if (row) row.classList.toggle('hidden', type !== 'dataframe');
    const nameRow = $('variable-name-row');
    if (nameRow) nameRow.classList.toggle('hidden', isCode);
    const textLabel = $('variable-text-label-text');
    if (textLabel) textLabel.textContent = I18n.t(isCode || isSnippet ? 'variables.codeText' : 'variables.text');
  }

  async function submitVariableDialog() {
    const name = ($('variable-name').value || '').trim();
    const type = $('variable-type').value;
    const isCode = type === 'code';
    const isSnippet = type === 'snippet';
    const text = $('variable-text').value;
    const ignoreSpaces = $('variable-ignore-spaces').checked;
    const error = $('variable-error');
    const ok = $('variable-ok');
    const showError = (message) => {
      error.textContent = message;
      error.classList.remove('hidden');
    };
    if (isCode) {
      if (!text.trim()) {
        showError(I18n.t('variables.codeRequired'));
        return;
      }
    } else if (isSnippet) {
      if (!name) {
        showError(I18n.t('variables.nameRequired'));
        return;
      }
    } else {
      if (!name) {
        showError(I18n.t('variables.nameRequired'));
        return;
      }
      if (!/^[A-Za-z_]\w*$/.test(name)) {
        showError(I18n.t('variables.nameInvalid'));
        return;
      }
    }
    error.classList.add('hidden');
    ok.disabled = true;
    try {
      if (isSnippet) {
        if (state.snippets.some((item) => item.name === name)) {
          showError(I18n.t('variables.snippetDuplicate'));
          return;
        }
        state.snippets.push({ name, code: text });
        sortSnippets();
        await saveSnippetsMeta();
        renderSnippets();
        closeVariableDialog();
        toast('variables.snippetCreated', { name });
        return;
      }
      const raw = await workerCall('createVariable', [name, type, text, ignoreSpaces ? '1' : '0']);
      const result = JSON.parse(raw);
      if (!result.ok) {
        const message = result.errorKey
          ? I18n.t(result.errorKey, result.errorParams || {})
          : (result.error || I18n.t('error.unknown'));
        showError(message);
        return;
      }
      closeVariableDialog();
      await refreshInspector();
      queueSave({ snapshot: true });
      if (isCode) toast('variables.codeExecuted');
      else toast('variables.created', { name });
    } catch (err) {
      showError(I18n.t('variables.createFailed', {
        error: String((err && err.message) || err),
      }));
    } finally {
      ok.disabled = false;
    }
  }

  setupVariableDialog();

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
  let ASSETS_TEXT = $('pycalc-assets').textContent;
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
    ['display', '(*objs)'],
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
    numpyOutput: 'default',
    dataframeOutput: 'text',
    dataframeRows: 20,
    dataframeCols: 10,
    numpyTabs: 5,
    numpyRows: 20,
    numpyCols: 10,
    floatDigits: 10,
    hidePlotResult: false,
    showPrompts: true,
    sessionBarHidden: false,
    aiHistoryScope: 'recent',
    aiHistoryCount: 5,
    aiIncludeOutputs: true,
    aiIncludeEditor: true,
    aiIncludeContext: true,
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
    variables: [],
    functions: [],
    snippets: [],
    attributeCache: new Map(),
    historyNav: { index: null, draft: '' },
    redoStack: [],
    deleteStack: [],
    promptMenu: null,
    suppressEditorSave: false,
    ui: { ...DEFAULT_UI },
    status: null,
    runtimeStatus: null,
    overlay: null,
    mobileSidebarOpen: false,
  };

    // ---- 启动性能打点（仅 console 输出，不改行为） ----
  const perf = {
    marks: [],
    mark(label) {
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const prev = this.marks[this.marks.length - 1];
      this.marks.push({ label, t: now });
      if (prev) {
        console.log(`[perf] ${prev.label} → ${label}: ${(now - prev.t).toFixed(0)} ms`);
      } else {
        console.log(`[perf] start: ${label}`);
      }
    },
    summary() {
      console.table(this.marks.map((m, i) => ({
        step: m.label,
        delta_ms: i ? Math.round(m.t - this.marks[i - 1].t) : 0,
        total_ms: Math.round(m.t - this.marks[0].t),
      })));
    },
  };
  window.__pycalcPerf = perf;
  // ------------------------------------------------------
  let editor = null;
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

  function setRuntimeStatus(key, params) {
    state.runtimeStatus = key ? { key, params: params || {} } : null;
    renderStatus();
  }

  function positionRuntimeStatus() {
    const node = $('runtime-status');
    if (!node || node.classList.contains('hidden')) return;
    const topbar = document.querySelector('.topbar');
    const bottom = topbar ? topbar.getBoundingClientRect().bottom : 0;
    node.style.top = `${Math.round(bottom + 8)}px`;
  }

  function renderStatus() {
    const node = $('runtime-status');
    if (!node) return;
    if (!state.runtimeStatus) {
      node.textContent = '';
      node.classList.add('hidden');
      return;
    }
    node.textContent = I18n.t(state.runtimeStatus.key, state.runtimeStatus.params);
    node.classList.remove('hidden');
    positionRuntimeStatus();
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
  // Images / binary helpers
  // ---------------------------------------------------------------------

  function b64ToBytes(data) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data);
    const raw = atob(data);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  // ---------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------

  // 启动阶段先收集 Pyodide 输出，别把 [perf] 日志冲掉
  const bootLogs = [];
  window.__pycalcBootLogs = () => bootLogs;  

  function dispatchStream(kind, text) {
    if (!text) return;
    if (state.activeOutput && typeof state.activeOutput[kind] === 'function') {
      state.activeOutput[kind](text);
    } else if (!state.ready) {
      bootLogs.push(`[${kind}] ${text}`);
    } else {
      console.log(`[pyodide:${kind}]`, text);
    }
  }

  // ---------------------------------------------------------------------
  // Python runtime worker
  // ---------------------------------------------------------------------

  let runtimeWorker = null;
  let workerSeq = 0;
  const workerPending = new Map();

  function workerCall(method, args = [], transfer = []) {
    if (!runtimeWorker) return Promise.reject(new Error('Python runtime is not started'));
    const id = ++workerSeq;
    return new Promise((resolve, reject) => {
      workerPending.set(id, { resolve, reject });
      runtimeWorker.postMessage({ type: 'call', id, method, args }, transfer);
    });
  }

  function makeRuntimeProxy() {
    const call = (method) => (...args) => workerCall(method, args);
    return {
      run: call('run'),
      figures: call('figures'),
      selfTest: call('selfTest'),
      reset: call('reset'),
      replayImports: call('replayImports'),
      namespaceInfo: call('namespaceInfo'),
      setLibraries: call('setLibraries'),
      isComplete: call('isComplete'),
      listVars: call('listVars'),
      listFuncs: call('listFuncs'),
      setPlotTheme: call('setPlotTheme'),
      listCompletions: call('listCompletions'),
      attributeItems: call('attributeItems'),
      snapshot: () => workerCall('snapshot'),
      restore: (bytes) => workerCall('restore', [bytes], [bytes]),
    };
  }

  function rejectWorkerPending(error) {
    for (const entry of workerPending.values()) entry.reject(error);
    workerPending.clear();
  }

  function startRuntimeWorker() {
    const pyodideSource = $('pycalc-pyodide-js').textContent;
    const workerSource = $('pycalc-runtime-worker').textContent;
    const asmSource = CFG.runtimeMode === 'esm'
      ? $('pycalc-asm-mjs').textContent
      : $('pycalc-asm-js').textContent;
    perf.mark('runtime:readSources');

    // pyodide.js must run inside the worker.  For the classic runtime the asm
    // script also has to be in the same worker global before loadPyodide().
    //
    // Pyodide 314 refuses classic workers only because it probes
    // importScripts(); hiding that probe lets the worker use the same
    // createPyodideModule path as the main thread.  This also keeps blob
    // workers working from file://, where module workers are rejected.
    const classicEsm = CFG.runtimeMode === 'esm' && location.protocol === 'file:';
    const useModule = CFG.runtimeMode === 'esm' && !classicEsm;
    const prelude = classicEsm
      ? [
        'try { Object.defineProperty(self, "importScripts", { value: undefined, configurable: true }); }',
        'catch (_) {}',
        '',
      ].join('\n')
      : '';
    const source = CFG.runtimeMode === 'esm'
      ? `${prelude}${pyodideSource}\n${workerSource}`
      : `${prelude}${pyodideSource}\n${asmSource}\n${workerSource}`;
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    perf.mark('runtime:createWorkerBlob');
    const worker = new Worker(blobUrl, { type: useModule ? 'module' : 'classic' });
    runtimeWorker = worker;
    perf.mark('runtime:workerCreated');

    const ready = new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === 'status') {
          setRuntimeStatus(message.key, message.params);
          return;
        }
        if (message.type === 'stream') {
          dispatchStream(message.kind, message.text);
          return;
        }
        if (message.type === 'ready') {
          perf.mark('runtime:workerReady');
          URL.revokeObjectURL(blobUrl);
          resolve();
          return;
        }
        if (message.type === 'error') {
          const error = new Error(message.error || 'Python worker failed');
          URL.revokeObjectURL(blobUrl);
          setRuntimeStatus(null);
          reject(error);
          rejectWorkerPending(error);
          return;
        }
        if (message.type === 'result') {
          const pending = workerPending.get(message.id);
          if (!pending) return;
          workerPending.delete(message.id);
          if (message.ok) pending.resolve(message.value);
          else pending.reject(new Error(message.error || 'Python call failed'));
        }
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || 'Python worker failed to start');
        URL.revokeObjectURL(blobUrl);
        setRuntimeStatus(null);
        reject(error);
        rejectWorkerPending(error);
      };
    });

    worker.postMessage({
      type: 'init',
      config: CFG,
      assetsText: ASSETS_TEXT,
      glue: PY_GLUE_SOURCE,
      asmSource,
      runtimeMode: CFG.runtimeMode,
    });
    // The worker owns the runtime payload now; release the large inline
    // script texts so the main thread does not keep a second copy in memory.
    ASSETS_TEXT = null;
    for (const id of [
      'pycalc-assets', 'pycalc-pyodide-js', 'pycalc-runtime-worker',
      'pycalc-asm-mjs', 'pycalc-asm-js',
    ]) {
      const node = $(id);
      if (node) node.remove();
    }
    return ready;
  }

  async function loadRuntime() {
    setStage('overlay.runtime', { version: CFG.pyodideVersion, python: CFG.pythonVersion });
    setRuntimeStatus('runtime.loading');
    await new Promise((resolve) => setTimeout(resolve, 0));
    perf.mark('runtime:yield');
    await startRuntimeWorker();
    py = makeRuntimeProxy();
    perf.mark('runtime:initGlue');
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
      sympyOutput: meta.sympyOutput === 'all'
        ? 'all' : meta.sympyOutput === 'math' ? 'math' : 'text',
      numpyOutput: meta.numpyOutput === 'pretty'
        ? 'pretty' : meta.numpyOutput === 'table' ? 'table' : 'default',
      dataframeOutput: meta.dataframeOutput === 'table' ? 'table' : 'text',
      dataframeRows: Math.max(1, Math.min(200, Number(meta.dataframeRows) || 20)),
      dataframeCols: Math.max(1, Math.min(50, Number(meta.dataframeCols) || 10)),
      numpyTabs: Math.max(1, Math.min(20, Number(meta.numpyTabs) || 5)),
      numpyRows: Math.max(1, Math.min(100, Number(meta.numpyRows) || 20)),
      numpyCols: Math.max(1, Math.min(50, Number(meta.numpyCols) || 10)),
      floatDigits: meta.floatDigits === 'auto'
        ? 'auto'
        : [6, 8, 10, 12, 15].includes(Number(meta.floatDigits))
          ? Number(meta.floatDigits) : 10,
      hidePlotResult: Boolean(meta.hidePlotResult),
      showPrompts: meta.showPrompts !== false,
      sessionBarHidden: Boolean(meta.sessionBarHidden),
      aiHistoryScope: ['none', 'recent', 'all'].includes(meta.aiHistoryScope)
        ? meta.aiHistoryScope : 'recent',
      aiHistoryCount: Math.max(1, Math.min(100, Number(meta.aiHistoryCount) || 5)),
      aiIncludeOutputs: meta.aiIncludeOutputs !== false,
      aiIncludeEditor: meta.aiIncludeEditor !== false,
      aiIncludeContext: meta.aiIncludeContext !== false,
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
        numpyOutput: state.ui.numpyOutput,
        dataframeOutput: state.ui.dataframeOutput,
        dataframeRows: state.ui.dataframeRows,
        dataframeCols: state.ui.dataframeCols,
        numpyTabs: state.ui.numpyTabs,
        numpyRows: state.ui.numpyRows,
        numpyCols: state.ui.numpyCols,
        floatDigits: state.ui.floatDigits,
        hidePlotResult: state.ui.hidePlotResult,
        showPrompts: state.ui.showPrompts,
        sessionBarHidden: state.ui.sessionBarHidden,
        aiHistoryScope: state.ui.aiHistoryScope,
        aiHistoryCount: state.ui.aiHistoryCount,
        aiIncludeOutputs: state.ui.aiIncludeOutputs,
        aiIncludeEditor: state.ui.aiIncludeEditor,
        aiIncludeContext: state.ui.aiIncludeContext,
      });
    } catch (err) {
      console.warn('could not save UI settings', err);
    }
  }

  function sortSnippets() {
    state.snippets.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  }

  async function loadSnippetsMeta() {
    if (!state.storage) return;
    try {
      const meta = await state.storage.getMeta('snippets');
      const items = meta && Array.isArray(meta.items) ? meta.items : [];
      state.snippets = items
        .filter((item) => item && typeof item.name === 'string' && typeof item.code === 'string')
        .map((item) => ({ name: item.name, code: item.code }));
    } catch (err) {
      console.warn('could not read snippets', err);
      state.snippets = [];
    }
    sortSnippets();
    renderSnippets();
  }

  async function saveSnippetsMeta() {
    if (!state.storage) return;
    try {
      await state.storage.putMeta({ key: 'snippets', items: state.snippets });
    } catch (err) {
      console.warn('could not save snippets', err);
    }
  }

  function renderSnippets() {
    const host = $('snippets-list');
    if (!host) return;
    const card = host.closest('.side-card');
    host.innerHTML = '';
    for (const snippet of state.snippets) {
      const item = el('div', 'snippet-item');
      const header = el('div', 'snippet-header');
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'snippet-name';
      name.textContent = snippet.name;
      name.title = I18n.t('snippets.insertTitle');
      name.addEventListener('click', () => insertSnippet(snippet));
      header.appendChild(name);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'snippet-edit-btn';
      edit.title = I18n.t('snippets.editTitle');
      edit.setAttribute('aria-label', I18n.t('snippets.editTitle'));
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"></path><path d="m13.5 6.5 3 3"></path></svg>';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        openSnippetEditDialog(snippet);
      });
      header.appendChild(edit);
      item.appendChild(header);
      item.appendChild(el('pre', 'snippet-code', snippet.code || ''));
      host.appendChild(item);
    }
    if (card) card.classList.toggle('empty', state.snippets.length === 0);
  }

  function closeMobileSidebarAfterInsert() {
    if (window.innerWidth <= 880 && state.mobileSidebarOpen) {
      state.mobileSidebarOpen = false;
      applySidebar();
    }
  }

  function insertNameIntoEditor(name) {
    const text = String(name || '');
    if (!text || !editor) return;
    try {
      editor.insertAtCursor(text);
      if (editor.focus) editor.focus();
      state.historyNav.index = null;
      closeMobileSidebarAfterInsert();
    } catch (err) {
      banner('banner.copyFailed', { error: err.message || err }, 'bad');
    }
  }

  function insertSnippet(snippet) {
    if (!snippet || typeof snippet.code !== 'string') return;
    setEditorText(snippet.code, true);
    state.historyNav.index = null;
    state.historyNav.draft = snippet.code;
    if (editor && editor.focus) editor.focus();
    closeMobileSidebarAfterInsert();
  }

  let snippetEditTarget = null;

  function setupSnippetEditDialog() {
    const dialog = document.createElement('div');
    dialog.id = 'snippet-edit-dialog';
    dialog.className = 'display-dialog hidden';
    dialog.innerHTML = `
      <div class="display-backdrop" id="snippet-edit-backdrop"></div>
      <section class="display-panel variable-panel" role="dialog" aria-modal="true" aria-labelledby="snippet-edit-title">
        <header class="display-header">
          <h2 id="snippet-edit-title" data-i18n="snippets.editTitle"></h2>
          <button id="snippet-edit-close" class="icon-btn" type="button" data-i18n-title="display.close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          </button>
        </header>
        <div class="display-body">
          <label class="display-row variable-field">
            <span data-i18n="variables.name"></span>
            <input id="snippet-edit-name" class="compact-input" type="text" autocomplete="off" spellcheck="false">
          </label>
          <label class="variable-text-label">
            <span data-i18n="variables.codeText"></span>
            <textarea id="snippet-edit-code" class="variable-text" spellcheck="false"></textarea>
          </label>
          <div id="snippet-edit-error" class="variable-error hidden"></div>
          <div class="variable-actions">
            <button id="snippet-edit-delete" class="secondary" type="button" data-i18n="snippets.delete"></button>
            <button id="snippet-edit-cancel" class="secondary" type="button" data-i18n="variables.cancel"></button>
            <button id="snippet-edit-save" class="run-btn" type="button" data-i18n="snippets.save"></button>
          </div>
        </div>
      </section>
    `;
    document.getElementById('app').appendChild(dialog);

    dialog.querySelector('#snippet-edit-close').addEventListener('click', closeSnippetEditDialog);
    dialog.querySelector('#snippet-edit-cancel').addEventListener('click', closeSnippetEditDialog);
    dialog.querySelector('#snippet-edit-backdrop').addEventListener('click', closeSnippetEditDialog);
    dialog.querySelector('#snippet-edit-save').addEventListener('click', saveSnippetEdit);
    dialog.querySelector('#snippet-edit-delete').addEventListener('click', deleteSnippetFromDialog);
    dialog.querySelector('#snippet-edit-code').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveSnippetEdit();
      }
    });
    document.addEventListener('keydown', (event) => {
      const node = $('snippet-edit-dialog');
      if (event.key === 'Escape' && node && !node.classList.contains('hidden')) {
        closeSnippetEditDialog();
      }
    });
  }

  function openSnippetEditDialog(snippet) {
    if (!snippet) return;
    snippetEditTarget = snippet;
    const dialog = $('snippet-edit-dialog');
    if (!dialog) return;
    $('snippet-edit-name').value = snippet.name;
    $('snippet-edit-code').value = snippet.code || '';
    $('snippet-edit-error').textContent = '';
    $('snippet-edit-error').classList.add('hidden');
    $('snippet-edit-save').disabled = false;
    $('snippet-edit-delete').disabled = false;
    I18n.applyStatic(dialog);
    dialog.classList.remove('hidden');
    $('snippet-edit-name').focus();
  }

  function closeSnippetEditDialog() {
    const dialog = $('snippet-edit-dialog');
    if (dialog) dialog.classList.add('hidden');
    snippetEditTarget = null;
  }

  async function saveSnippetEdit() {
    if (!snippetEditTarget) return;
    const name = ($('snippet-edit-name').value || '').trim();
    const code = $('snippet-edit-code').value;
    const error = $('snippet-edit-error');
    const showError = (message) => {
      error.textContent = message;
      error.classList.remove('hidden');
    };
    if (!name) {
      showError(I18n.t('variables.nameRequired'));
      return;
    }
    if (state.snippets.some((item) => item !== snippetEditTarget && item.name === name)) {
      showError(I18n.t('variables.snippetDuplicate'));
      return;
    }
    error.classList.add('hidden');
    const target = snippetEditTarget;
    target.name = name;
    target.code = code;
    sortSnippets();
    await saveSnippetsMeta();
    renderSnippets();
    closeSnippetEditDialog();
    toast('snippets.updated', { name });
  }

  async function deleteSnippetFromDialog() {
    if (!snippetEditTarget) return;
    const target = snippetEditTarget;
    if (!window.confirm(I18n.t('snippets.deleteConfirm', { name: target.name }))) {
      return;
    }
    state.snippets = state.snippets.filter((item) => item !== target);
    await saveSnippetsMeta();
    renderSnippets();
    closeSnippetEditDialog();
    toast('snippets.deleted', { name: target.name });
  }

  setupSnippetEditDialog();

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

  function renderSessionTitle() {
    const name = $('session-title-name');
    if (!name) return;
    name.textContent = state.activeName || I18n.t('session.defaultName');
  }

  function renderSessionMenu() {
    const menu = $('session-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const session of sorted) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'session-menu-item';
      item.setAttribute('role', 'menuitem');
      item.title = session.name;
      item.appendChild(el('span', 'session-menu-check', session.id === state.activeId ? '✓' : ''));
      item.appendChild(el('span', 'session-menu-name', session.name));
      if (session.id === state.activeId) item.classList.add('active');
      item.addEventListener('click', () => {
        closeSessionMenu();
        if (session.id !== state.activeId) switchSession(session.id);
      });
      menu.appendChild(item);
    }
  }

  function openSessionMenu() {
    const title = $('session-title');
    const menu = $('session-menu');
    if (!title || !menu || title.disabled) return;
    renderSessionMenu();
    menu.classList.remove('hidden');
    const rect = title.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    title.setAttribute('aria-expanded', 'true');
  }

  function closeSessionMenu() {
    const menu = $('session-menu');
    const title = $('session-title');
    if (menu) menu.classList.add('hidden');
    if (title) title.setAttribute('aria-expanded', 'false');
  }

  function toggleSessionMenu() {
    const menu = $('session-menu');
    if (!menu || menu.classList.contains('hidden')) openSessionMenu();
    else closeSessionMenu();
  }

  function updateHeader() {
    document.title = state.activeName ? `PyCalc — ${state.activeName}` : 'PyCalc';
    renderSessionSelect();
    renderSessionTitle();
    const menu = $('session-menu');
    if (menu && !menu.classList.contains('hidden')) renderSessionMenu();
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
    state.deleteStack = [];
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
    if (snapshot && py && state.ready) {
      try {
        setStatus('status.saving');
        const snap = await py.snapshot();
        const info = snap.info;
        if (info.ok) {
          data.namespace = snap.bytes;
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
    closeSessionMenu();
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
        await py.reset();
        await applyLibraries(false);
        await py.setPlotTheme(state.ui.theme);
      }
      state.history = [];
      state.redoStack = [];
      state.deleteStack = [];
      state.executionCount = 0;
      state.draft = '';
      state.namespace = null;
      state.namespaceMeta = null;
      state.historyNav = { index: null, draft: '' };
      state.activeOutput = null;
      renderConsole();
      resetEditorForSession('');
      updateHeader();
      await refreshInspector();
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
    setRuntimeStatus('runtime.restore');
    window.__pycalcBootStage = 'restore:start';
    await new Promise((resolve) => setTimeout(resolve, 0));
    perf.mark('restore:yield');
    try {
      window.__pycalcBootStage = 'restore:reset';
      await py.reset();
      perf.mark('restore:reset');
      window.__pycalcBootStage = 'restore:libraries';
      const libResult = JSON.parse(await py.setLibraries(
        JSON.stringify(state.libraries), JSON.stringify(libraryAliasMap())
      ));
      perf.mark('restore:setLibraries');
      if (libResult.conflicts && libResult.conflicts.length) {
        banner('banner.libraryConflict', { names: libResult.conflicts.join(', ') }, 'warn', true);
      }
      if (libResult.errors && libResult.errors.length) {
        banner('banner.libraryImport', { names: libResult.errors.join('; ') }, 'bad', true);
      }
      window.__pycalcBootStage = 'restore:imports';
      const codes = state.history.map((entry) => entry.code).filter(Boolean);
      const replay = JSON.parse(await py.replayImports(JSON.stringify(codes)));
      perf.mark('restore:replayImports');
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
        const source = state.namespace instanceof ArrayBuffer
          ? state.namespace
          : state.namespace.buffer;
        // The structured-clone transfer detaches the buffer on this side;
        // keep state.namespace usable for later snapshots/saves.
        const bytes = source.slice(0);
        const info = JSON.parse(await py.restore(bytes));
        perf.mark('restore:snapshot');
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
    await refreshInspector();
    // Importing pyplot (inside reset/setLibraries) can reset rcParams to the
    // default style; re-apply the UI plot theme after the namespace is ready.
    if (py) {
      try { await py.setPlotTheme(state.ui.theme); } catch (err) { console.warn('plot theme failed', err); }
    }
    perf.mark('restore:inspector');
    setRuntimeStatus(null);
    window.__pycalcBootStage = 'restore:done';
  }

  async function applyLibraries(announce = true) {
    if (!py || !state.ready) return [];
    try {
      const result = JSON.parse(await py.setLibraries(
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
    await applyLibraries(true);
    if (py) {
      try { await py.setPlotTheme(state.ui.theme); } catch (err) { console.warn('plot theme failed', err); }
    }
    await refreshInspector();
    if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
    queueSave({ snapshot: false });
  }

  async function refreshCompletions() {
    state.attributeCache.clear();
    if (!py || !state.ready) {
      state.completions = [];
      return;
    }
    try {
      const rows = JSON.parse(await py.listCompletions());
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

  async function getAttributeCompletions(expr, code = '') {
    const key = String(expr || '');
    if (state.attributeCache.has(key)) return state.attributeCache.get(key);
    const empty = { expr: key, type: null, source: 'live', items: [] };
    if (!py || !state.ready || !key) return empty;
    const promise = py.attributeItems(key, String(code || ''))
      .then((raw) => {
        const data = JSON.parse(raw);
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
      })
      .catch((err) => {
        console.warn('attribute completion failed', err);
        return empty;
      });
    if (!state.attributeCache.has(key)) {
      // Coalesce concurrent completion requests for the same expression.
      state.attributeCache.set(key, promise);
      promise.then((value) => {
        if (value.source !== 'live' && state.attributeCache.get(key) === promise) {
          state.attributeCache.delete(key);
        }
      });
    }
    return promise;
  }

  async function signatureFor(name) {
    if (!name) return null;
    if (name.includes('.')) {
      const index = name.lastIndexOf('.');
      const expr = name.slice(0, index);
      const attr = name.slice(index + 1);
      const data = await getAttributeCompletions(expr);
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

  const VARIABLE_VALUE_INLINE_LIMIT = 48;

  async function refreshInspector() {
    const varsBody = $('vars-body');
    const funcsBody = $('funcs-body');
    const varsCard = varsBody.closest('.side-card');
    const funcsCard = funcsBody.closest('.side-card');
    varsBody.innerHTML = '';
    funcsBody.innerHTML = '';
    if (!py || !state.ready) {
      state.completions = [];
      state.variables = [];
      state.functions = [];
      varsCard.classList.add('empty');
      funcsCard.classList.add('empty');
      return;
    }
    await refreshCompletions();
    try {
      const vars = JSON.parse(await py.listVars());
      state.variables = Array.isArray(vars) ? vars : [];
      for (const row of vars) {
        const valueText = row.value == null ? '' : String(row.value);
        const isLongValue = valueText.length > VARIABLE_VALUE_INLINE_LIMIT
          || valueText.includes('\n');
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'side-name-btn';
        nameBtn.textContent = row.name;
        nameBtn.title = I18n.t('sidebar.insertName');
        nameBtn.addEventListener('click', () => insertNameIntoEditor(row.name));
        nameCell.appendChild(nameBtn);
        tr.appendChild(nameCell);
        const typeCell = el('td', '', row.type);
        typeCell.title = row.type;
        tr.appendChild(typeCell);
        const valueCell = el('td', '', isLongValue? '' : valueText);
        valueCell.title = valueText;
        if (isLongValue) valueCell.classList.add('side-value-truncated');
        tr.appendChild(valueCell);
        varsBody.appendChild(tr);
        if (isLongValue) {
          const detailTr = document.createElement('tr');
          detailTr.className = 'side-value-detail-row';
          const detailCell = document.createElement('td');
          detailCell.colSpan = 3;
          detailCell.className = 'side-value-detail';
          detailCell.textContent = valueText;
          detailTr.appendChild(detailCell);
          varsBody.appendChild(detailTr);
        }
      }
      varsCard.classList.toggle('empty', vars.length === 0);
    } catch (err) {
      console.warn('list variables failed', err);
      state.variables = [];
      varsCard.classList.add('empty');
    }
    try {
      const funcs = JSON.parse(await py.listFuncs());
      state.functions = Array.isArray(funcs) ? funcs : [];
      for (const row of funcs) {
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'side-name-btn';
        nameBtn.textContent = row.name;
        nameBtn.title = I18n.t('sidebar.insertName');
        nameBtn.addEventListener('click', () => insertNameIntoEditor(row.name));
        nameCell.appendChild(nameBtn);
        tr.appendChild(nameCell);
        const paramsCell = el('td', '', row.params);
        paramsCell.title = row.params;
        tr.appendChild(paramsCell);
        funcsBody.appendChild(tr);
      }
      funcsCard.classList.toggle('empty', funcs.length === 0);
    } catch (err) {
      console.warn('list functions failed', err);
      state.functions = [];
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
    if (entry.outputHidden) return '';
    const parts = [];
    if (entry.stdout) parts.push(entry.stdout.replace(/\n$/, ''));
    if (entry.stderr) parts.push(entry.stderr.replace(/\n$/, ''));
    if (Array.isArray(entry.displays)) {
      for (const item of entry.displays) {
        if (!item || item.resultPlotly || item.image) continue;
        if (item.result !== null && item.result !== undefined) {
          parts.push(String(item.result));
        }
      }
    }
    if (entry.result !== null && entry.result !== undefined) parts.push(String(entry.result));
    if (entry.error) parts.push(String(entry.error));
    return parts.filter(Boolean).join('\n');
  }

  function hasOutput(entry) {
    if (entry.outputHidden) return false;
    return Boolean(
      entry.stdout || entry.stderr ||
      (Array.isArray(entry.displays) && entry.displays.length) ||
      (entry.result !== null && entry.result !== undefined) ||
      entry.error || entry.resultPlotly ||
      (entry.images && entry.images.length)
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
    button.addEventListener('click', (event) => {
      // A long-press on touch opens the context menu; ignore the
      // synthetic click the browser fires when the finger is released.
      if (lastPromptMenu && lastPromptMenu.button === button
          && Date.now() - lastPromptMenu.at < 700) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      insertEntryText(entry, kind);
    });
    attachPromptMenu(button, entry, kind);
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
      if (kind === 'in' && typeof editor.insertBlockAtCursor === 'function') {
        editor.insertBlockAtCursor(text);
      } else {
        editor.insertAtCursor(text);
      }
      editor.focus();
      state.historyNav.index = null;
      toast(kind === 'in' ? 'console.copiedInput' : 'console.copiedOutput');
    } catch (err) {
      banner('banner.copyFailed', { error: err.message || err }, 'bad');
    }
  }

  // ---------------------------------------------------------------------
  // Console prompt context menu (copy / delete)
  // ---------------------------------------------------------------------

  let lastPromptMenu = null;

  function attachPromptMenu(button, entry, kind) {
    const show = (x, y) => {
      lastPromptMenu = { button, at: Date.now() };
      openPromptMenu(entry, kind, x, y);
    };

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      show(event.clientX, event.clientY);
    });

    if (typeof window.PointerEvent !== 'function') return;

    let timer = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        show(startX, startY);
      }, 500);
    });
    button.addEventListener('pointermove', (event) => {
      if (timer === null) return;
      if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) {
        cancel();
      }
    });
    button.addEventListener('pointerup', cancel);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
  }

  function openPromptMenu(entry, kind, x, y) {
    const menu = $('prompt-menu');
    if (!menu) return;
    const copy = menu.querySelector('[data-action="copy"]');
    const del = menu.querySelector('[data-action="delete"]');
    if (copy) {
      copy.textContent = I18n.t(kind === 'in' ? 'console.menuCopyCode' : 'console.menuCopyOutput');
    }
    if (del) {
      del.textContent = I18n.t(kind === 'in' ? 'console.menuDeleteEntry' : 'console.menuDeleteOutput');
    }
    state.promptMenu = { entry, kind };
    menu.classList.remove('hidden');
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, Math.round(left))}px`;
    menu.style.top = `${Math.max(8, Math.round(top))}px`;
  }

  function closePromptMenu() {
    const menu = $('prompt-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    state.promptMenu = null;
  }

  function deleteEntryAt(index) {
    if (index < 0 || index >= state.history.length) return;
    const entry = state.history[index];
    state.history.splice(index, 1);
    if (entry.n === state.executionCount) {
      state.executionCount = Math.max(0, state.executionCount - 1);
    }
    state.deleteStack.push({ kind: 'entry', entry, index });
    if (state.deleteStack.length > 50) state.deleteStack.shift();
    state.redoStack = [];
    state.historyNav = { index: null, draft: '' };
    renderConsole();
    updateHistoryButtons();
    queueSave({ snapshot: false });
  }

  function deleteEntryOutput(entry) {
    if (!entry || entry.outputHidden) return;
    if (!hasOutput(entry)) return;
    const index = state.history.indexOf(entry);
    if (index < 0) return;
    entry.outputHidden = true;
    state.deleteStack.push({ kind: 'output', entry, index });
    if (state.deleteStack.length > 50) state.deleteStack.shift();
    state.historyNav = { index: null, draft: '' };
    renderConsole();
    updateHistoryButtons();
    queueSave({ snapshot: false });
  }

  function fallbackCopyText(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    document.body.appendChild(area);
    let ok = false;
    try {
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    } finally {
      area.remove();
    }
    return ok;
  }

  function copyTextToClipboard(text) {
    const value = String(text == null ? '' : text);
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value).then(
        () => true,
        () => fallbackCopyText(value)
      );
    }
    return Promise.resolve(fallbackCopyText(value));
  }

  function readTextFromClipboard() {
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      return navigator.clipboard.readText();
    }
    return Promise.reject(new Error('Clipboard read API unavailable'));
  }

  function pasteFromClipboard() {
    if (!editor) return Promise.resolve(false);
    // Invoke readText() synchronously inside the click handler so browsers
    // (especially Safari / iOS) keep transient user activation.
    return readTextFromClipboard()
      .then((raw) => {
        const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
        if (!text) {
          toast('editor.pasteEmpty');
          if (editor.focus) editor.focus();
          return false;
        }
        editor.insertAtCursor(text);
        if (editor.focus) editor.focus();
        state.historyNav.index = null;
        return true;
      })
      .catch(() => {
        toast('editor.pasteFailed');
        if (editor.focus) editor.focus();
        return false;
      });
  }

  function handlePromptMenuAction(action) {
    const context = state.promptMenu;
    if (!context) return;
    const { entry, kind } = context;
    if (action === 'copy') {
      const text = kind === 'in' ? entry.code : outputText(entry);
      if (!text) {
        toast('console.noText');
        return;
      }
      copyTextToClipboard(text).then((ok) => {
        toast(ok ? 'console.copiedToClipboard' : 'console.clipboardFailed');
      }).catch(() => {
        toast('console.clipboardFailed');
      });
      return;
    }
    if (action === 'delete') {
      if (kind === 'in') {
        deleteEntryAt(state.history.indexOf(entry));
      } else {
        deleteEntryOutput(entry);
      }
    }
  }

  function setupPromptMenu() {
    if ($('prompt-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'prompt-menu';
    menu.className = 'prompt-menu hidden';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button type="button" class="prompt-menu-item" data-action="copy" role="menuitem"></button>
      <button type="button" class="prompt-menu-item danger" data-action="delete" role="menuitem"></button>
    `;
    document.getElementById('app').appendChild(menu);

    menu.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      handlePromptMenuAction(action);
      closePromptMenu();
    });

    document.addEventListener('pointerdown', (event) => {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(event.target)) return;
      closePromptMenu();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePromptMenu();
    });
    window.addEventListener('resize', closePromptMenu);
    window.addEventListener('scroll', closePromptMenu, true);
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

  function formatFloatNumber(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return Number(number.toPrecision(digits)).toString();
  }

  function formatNumberTree(node, digits, numpyPretty) {
    if (!node) return '';
    if (node.kind === 'text') return node.text;
    if (node.kind === 'float') return formatFloatNumber(node.value, digits);
    if (node.kind === 'numpy-float') {
      const number = formatFloatNumber(node.value, digits);
      return numpyPretty ? number : `np.${node.name}(${number})`;
    }
    if (node.kind === 'numpy-array') {
      const inner = formatNumberTree(node.items, digits, numpyPretty);
      return numpyPretty ? inner : `array(${inner})`;
    }
    const items = node.items || [];
    if (node.kind === 'dict') {
      return '{' + items.map(([key, value]) => (
        `${formatNumberTree(key, digits, numpyPretty)}: ${formatNumberTree(value, digits, numpyPretty)}`
      )).join(', ') + '}';
    }
    if (node.kind === 'tuple') {
      const parts = items.map((item) => formatNumberTree(item, digits, numpyPretty));
      return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
    }
    const parts = items.map((item) => formatNumberTree(item, digits, numpyPretty));
    if (node.kind === 'set') return '{' + parts.join(', ') + '}';
    return '[' + parts.join(', ') + ']';
  }

  function formatTableCell(value, digits) {
    if (typeof value === 'number' && digits !== 'auto' && !Number.isInteger(value)) {
      return formatFloatNumber(value, digits);
    }
    return value === null || value === undefined ? '' : String(value);
  }

  function pythonString(value) {
    return "'" + String(value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') + "'";
  }

  function formatArrayCell(value, digits) {
    if (typeof value === 'number') return formatTableCell(value, digits);
    if (typeof value === 'string') return pythonString(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (value === null) return 'None';
    return String(value);
  }

  function formatArrayPretty(array) {
    if (!array || !Array.isArray(array.data)) return null;
    const digits = state.ui.floatDigits;
    if (array.shape.length === 1) {
      return '[' + array.data.map((item) => formatArrayCell(item, digits)).join(', ') + ']';
    }
    if (array.shape.length !== 2) return null;
    const rows = array.data;
    if (!rows.length) return '[]';
    const tokens = rows.map((row) => row.map((item) => formatArrayCell(item, digits)));
    const widths = [];
    for (let col = 0; col < (tokens[0] || []).length; col += 1) {
      widths[col] = Math.max(...tokens.map((row) => (row[col] || '').length));
    }
    return tokens.map((row, index) => {
      const cells = row.map((text, col) => {
        const numeric = typeof rows[index][col] === 'number';
        return numeric ? text.padStart(widths[col]) : text.padEnd(widths[col]);
      });
      const prefix = index === 0 ? '[[' : ' [';
      const suffix = index === tokens.length - 1 ? ']]' : '],';
      return prefix + cells.join(', ') + suffix;
    }).join('\n');
  }

  function numpyArrayTable(data, maxRows, maxCols) {
    const rows = data.slice(0, maxRows);
    const colCount = Math.min(data[0]?.length || 0, maxCols);
    const wrap = el('div', 'np-table-wrap');
    const table = document.createElement('table');
    table.className = 'np-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(el('th', '', ''));
    for (let col = 0; col < colCount; col += 1) headRow.appendChild(el('th', '', `[${col}]`));
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', '', `[${rowIndex}]`));
      for (let col = 0; col < colCount; col += 1) {
        tr.appendChild(el('td', '', formatArrayCell(row[col], state.ui.floatDigits)));
      }
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function numpyVectorTable(data) {
    if (!Array.isArray(data) || data.length > state.ui.numpyCols) return null;
    const wrap = el('div', 'np-table-wrap');
    const table = document.createElement('table');
    table.className = 'np-table np-vector';
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    for (const value of data) {
      row.appendChild(el('td', '', formatArrayCell(value, state.ui.floatDigits)));
    }
    body.appendChild(row);
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function numpyTable(array) {
    if (!array || !Array.isArray(array.shape)) return null;
    const maxRows = state.ui.numpyRows;
    const maxCols = state.ui.numpyCols;
    if (array.shape.length === 1) {
      return numpyVectorTable(array.data);
    }
    if (array.shape.length === 2) {
      return numpyArrayTable(array.data, maxRows, maxCols);
    }
    if (array.shape.length !== 3) return null;
    const wrap = el('div', 'np-array-table');
    const tabs = el('div', 'np-tabs');
    const body = el('div', 'np-tab-body');
    const count = Math.min(array.data.length, state.ui.numpyTabs);
    const show = (index) => {
      body.innerHTML = '';
      body.appendChild(numpyArrayTable(array.data[index], maxRows, maxCols));
      for (const tab of tabs.querySelectorAll('.np-tab')) {
        tab.classList.toggle('active', Number(tab.dataset.index) === index);
      }
    };
    for (let index = 0; index < count; index += 1) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'np-tab';
      tab.dataset.index = String(index);
      tab.textContent = `[${index}]`;
      tab.addEventListener('click', () => show(index));
      tabs.appendChild(tab);
    }
    wrap.appendChild(tabs);
    wrap.appendChild(body);
    if (count) show(0);
    return wrap;
  }

  function entryResultText(entry) {
    if (state.ui.numpyOutput === 'pretty' && entry.resultArray) {
      const pretty = formatArrayPretty(entry.resultArray);
      if (pretty) return pretty;
    }
    const digits = state.ui.floatDigits;
    if (digits !== 'auto' && entry.resultNumbers) {
      return formatNumberTree(entry.resultNumbers, digits, state.ui.numpyOutput === 'pretty');
    }
    if (state.ui.numpyOutput === 'pretty' && entry.resultPretty) return entry.resultPretty;
    return entry.result;
  }

  function dataframeTable(table) {
    const wrap = el('div', 'df-table-wrap');
    const node = document.createElement('table');
    node.className = 'df-table';
    const allColumns = table.columns || [];
    const maxCols = state.ui.dataframeCols;
    let indices = allColumns.map((_, index) => index);
    let ellipsisAt = -1;
    if (allColumns.length > maxCols) {
      const headCount = Math.ceil(maxCols / 2);
      const tailCount = Math.floor(maxCols / 2);
      indices = [
        ...Array.from({ length: headCount }, (_, index) => index),
        ...Array.from(
          { length: tailCount },
          (_, index) => allColumns.length - tailCount + index,
        ),
      ];
      ellipsisAt = headCount;
    }
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    if (Array.isArray(table.index)) headRow.appendChild(el('th', '', '#'));
    indices.forEach((index, position) => {
      if (position === ellipsisAt) headRow.appendChild(el('th', 'df-ellipsis', '…'));
      headRow.appendChild(el('th', '', String(allColumns[index])));
    });
    if (ellipsisAt === indices.length) headRow.appendChild(el('th', 'df-ellipsis', '…'));
    head.appendChild(headRow);
    node.appendChild(head);
    const body = document.createElement('tbody');
    for (let row = 0; row < (table.rows || []).length; row += 1) {
      const tr = document.createElement('tr');
      if (Array.isArray(table.index)) {
        tr.appendChild(el('td', 'df-index', String(table.index[row] ?? '')));
      }
      indices.forEach((index, position) => {
        if (position === ellipsisAt) tr.appendChild(el('td', 'df-ellipsis', '…'));
        const value = (table.rows[row] || [])[index];
        const text = formatTableCell(value, state.ui.floatDigits);
        const td = el('td', '', text);
        td.title = text;
        tr.appendChild(td);
      });
      if (ellipsisAt === indices.length) tr.appendChild(el('td', 'df-ellipsis', '…'));
      body.appendChild(tr);
    }
    node.appendChild(body);
    wrap.appendChild(node);
    if (table.truncatedRows || table.truncatedColumns) {
      wrap.appendChild(el('div', 'df-table-note', I18n.t('display.tableTruncated', {
        rows: (table.rows || []).length,
        totalRows: table.totalRows,
        columns: (table.columns || []).length,
        totalColumns: table.totalColumns,
      })));
    }
    return wrap;
  }

  function plotlyThemeName() {
    return document.documentElement.dataset.theme === 'light'
      ? 'plotly_white'
      : 'plotly_dark';
  }

  function plotlyFontColor() {
    return getComputedStyle(document.body).color;
  }

  function plotlyThemePatch() {
    const color = plotlyFontColor();
    return {
      template: plotlyThemeName(),
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      'font.color': color,
      'title.font.color': color,
    };
  }

  function applyPlotlyTheme() {
    if (typeof Plotly === 'undefined') return;
    const patch = plotlyThemePatch();
    for (const node of document.querySelectorAll('.plotly-figure')) {
      // Skip a chart that is still waiting for its first Plotly.newPlot().
      if (!node._fullLayout) continue;
      try {
        const pending = Plotly.relayout(node, patch);
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (err) {
        console.warn('plotly theme failed', err);
      }
    }
  }

  function plotlyFigure(specJson) {
    if (!specJson || typeof Plotly === 'undefined') return null;
    let spec;
    try {
      spec = JSON.parse(specJson);
    } catch (err) {
      return null;
    }
    if (!spec || typeof spec !== 'object') return null;
    const host = el('div', 'plotly-figure');
    const layout = Object.assign({}, spec.layout || {});
    layout.autosize = true;
    layout.paper_bgcolor = 'rgba(0,0,0,0)';
    layout.plot_bgcolor = 'rgba(0,0,0,0)';
    // Plotly's default 80px left/right margins waste most of a phone screen.
    // Keep enough room for axis labels, but let the plot use the cell width.
    const compact = window.matchMedia('(max-width: 640px)').matches;
    const defaultMargin = compact
      ? { l: 44, r: 10, t: 44, b: 36, pad: 0 }
      : { l: 56, r: 18, t: 48, b: 40, pad: 0 };
    const figureMargin = spec.layout && spec.layout.margin;
    layout.margin = Object.assign(
      defaultMargin,
      figureMargin && typeof figureMargin === 'object' ? figureMargin : {}
    );
    if (compact && layout.title && layout.title.text) {
      layout.title = Object.assign({}, layout.title, { x: 0.5, xanchor: 'center' });
    }
    // Let Plotly reclaim the space needed by long tick labels and axis titles
    // instead of clipping them at the compact margins above.
    if (!layout.xaxis) layout.xaxis = {};
    if (!layout.yaxis) layout.yaxis = {};
    for (const axis of Object.keys(layout)) {
      if (/^[xy]axis\d*$/.test(axis)) {
        layout[axis] = Object.assign({}, layout[axis], { automargin: true });
      }
    }
    layout.template = plotlyThemeName();
    layout.font = Object.assign(
      {},
      layout.font || {},
      { color: plotlyFontColor() }
    );
    requestAnimationFrame(() => {
      try {
        Plotly.newPlot(host, spec.data || [], layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: !compact,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
      } catch (err) {
        host.textContent = String(err);
      }
    });
    return host;
  }

  function renderFormattedResult(item, outputRow, body, { hideResult = false } = {}) {
    if (!item) return;
    if (item.image && item.image.blob) {
      const images = el('div', 'images');
      images.appendChild(makeImage(item.image.blob, item.image.mime));
      body.appendChild(images);
      return;
    }
    const plotlyNode = item.resultPlotly ? plotlyFigure(item.resultPlotly) : null;
    if (plotlyNode) {
      outputRow.classList.add('plotly-row');
      body.appendChild(plotlyNode);
      return;
    }
    if (hideResult || item.result === null || item.result === undefined) return;
    if (state.ui.dataframeOutput === 'table' && item.resultTable) {
      body.appendChild(dataframeTable(item.resultTable));
    } else if (
      state.ui.numpyOutput === 'table'
      && item.resultArray
      && [1, 2, 3].includes(item.resultArray.shape.length)
    ) {
      const table = numpyTable(item.resultArray);
      if (table) {
        body.appendChild(table);
      } else {
        const pretty = item.resultArray.shape.length === 1
          ? formatArrayPretty(item.resultArray)
          : null;
        body.appendChild(el('pre', 'result', pretty || entryResultText(item)));
      }
    } else {
      let math = null;
      if (state.ui.sympyOutput === 'all') {
        math = mathResult(item.resultMathMLAll || item.resultMathML);
      } else if (state.ui.sympyOutput === 'math') {
        math = mathResult(item.resultMathML);
      }
      if (math) {
        body.appendChild(math);
      } else {
        body.appendChild(el('pre', 'result', entryResultText(item)));
      }
    }
  }

  function makeCell(entry) {
    const cell = el('div', 'entry');
    const inputRow = el('div', 'io-row io-input');
    inputRow.appendChild(promptButton('in', entry.n, entry));
    inputRow.appendChild(el('pre', 'code', entry.code));
    cell.appendChild(inputRow);

    if (hasOutput(entry)) {
      const outputRow = el('div', 'io-row io-output');
      outputRow.appendChild(promptButton('out', entry.n, entry));
      const body = el('div', 'output-body');
      if (entry.stdout) body.appendChild(el('pre', 'stream', entry.stdout));
      if (entry.stderr) body.appendChild(el('pre', 'stream stderr', entry.stderr));
      if (Array.isArray(entry.displays)) {
        for (const item of entry.displays) {
          renderFormattedResult(item, outputRow, body);
        }
      }
      const hideResult = state.ui.hidePlotResult && entry.images && entry.images.length > 0;
      renderFormattedResult(entry, outputRow, body, { hideResult });
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
    const host = $('console');
    // Detach old figures before revoking their Blob URLs.  Safari can keep
    // showing broken-image placeholders if the URL is revoked while the old
    // <img> is still connected.
    host.innerHTML = '';
    revokeObjectUrls();
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

  function redrawSessionHistory() {
    if (!state.activeId) return;
    // Rebuild every entry and, importantly, recreate Blob URLs for figures.
    // Safari can leave <img> elements broken after a session switch even when
    // the stored image Blob is still valid.
    renderConsole();
    toast('session.redrawn');
  }

  function updateHistoryButtons() {
    const undo = $('history-undo');
    const redo = $('history-redo');
    if (!undo || !redo) return;
    undo.disabled = state.busy || (state.history.length === 0 && state.deleteStack.length === 0);
    redo.disabled = state.busy || state.redoStack.length === 0;
  }

  function undoHistory() {
    if (state.busy) return;
    if (state.deleteStack.length > 0) {
      const item = state.deleteStack.pop();
      if (item.kind === 'entry') {
        const at = Math.max(0, Math.min(item.index, state.history.length));
        state.history.splice(at, 0, item.entry);
        state.executionCount = Math.max(state.executionCount, Number(item.entry.n) || 0);
      } else if (item.kind === 'output') {
        item.entry.outputHidden = false;
      }
      state.historyNav = { index: null, draft: '' };
      renderConsole();
      updateHistoryButtons();
      queueSave({ snapshot: false });
      return;
    }
    if (state.history.length === 0) return;
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
    const inputRow = el('div', 'io-row io-input');
    inputRow.appendChild(promptButton('in', entry.n, entry));
    inputRow.appendChild(el('pre', 'code', entry.code));
    cell.appendChild(inputRow);

    const outputRow = el('div', 'io-row io-output hidden');
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

  async function tryRunOnEnter() {
    if (state.ui.runKey !== 'enter' || !state.ready || state.busy || !py) return false;
    const code = editor.getValue();
    if (!code.trim()) return false;
    try {
      const info = JSON.parse(await py.isComplete(code));
      return Boolean(info.complete);
    } catch (err) {
      console.warn('completeness check failed', err);
      return false;
    }
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
      resultMathMLAll: null,
      resultPretty: null,
      resultTable: null,
      resultNumbers: null,
      resultArray: null,
      resultPlotly: null,
      displays: [],
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
      const result = JSON.parse(await py.run(
        code,
        JSON.stringify({ dataframeRows: state.ui.dataframeRows })
      ));
      entry.status = result.ok ? 'ok' : 'error';
      entry.result = result.ok ? result.result : null;
      entry.resultMathML = result.ok ? (result.resultMathML || null) : null;
      entry.resultLatex = result.ok ? (result.resultLatex || null) : null;
      entry.resultMathMLAll = result.ok ? (result.resultMathMLAll || null) : null;
      entry.resultPretty = result.ok ? (result.resultPretty || null) : null;
      entry.resultTable = result.ok ? (result.resultTable || null) : null;
      entry.resultNumbers = result.ok ? (result.resultNumbers || null) : null;
      entry.resultArray = result.ok ? (result.resultArray || null) : null;
      entry.resultPlotly = result.ok ? (result.resultPlotly || null) : null;
      entry.displays = Array.isArray(result.displays)
        ? result.displays.map((item) => {
          if (!item || typeof item !== 'object') return null;
          const next = {
            result: item.result ?? null,
            resultMathML: item.resultMathML || null,
            resultLatex: item.resultLatex || null,
            resultMathMLAll: item.resultMathMLAll || null,
            resultPretty: item.resultPretty || null,
            resultTable: item.resultTable || null,
            resultNumbers: item.resultNumbers || null,
            resultArray: item.resultArray || null,
            resultPlotly: item.resultPlotly || null,
            image: item.imagePng
              ? { mime: 'image/png', blob: new Blob([b64ToBytes(item.imagePng)], { type: 'image/png' }) }
              : null,
          };
          return next;
        }).filter(Boolean)
        : [];
      entry.error = result.ok ? null : result.error;
      try {
        const images = JSON.parse(await py.figures());
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
      state.activeOutput = null;
      live.finish(entry);
      state.busy = false;
      state.running = false;
      await refreshInspector();
      updateBusyUi();
      scheduleSave({ snapshot: true, delay: 250 });
      if (editor) editor.focus();
    }
    return entry;
  }

  function updateBusyUi() {
    $('run').disabled = state.busy || !state.ready;
    $('session-select').disabled = state.busy || !state.ready;
    $('session-title').disabled = state.busy || !state.ready;
    if ($('session-title').disabled) closeSessionMenu();
    $('session-new').disabled = state.busy || !state.ready;
    $('session-rename').disabled = state.busy || !state.ready;
    $('session-redraw').disabled = state.busy || !state.activeId;
    $('session-sweep').disabled = state.busy || !state.ready;
    $('session-delete').disabled = state.busy || !state.ready;
    $('language-select').disabled = state.busy;
    const runKey = $('run-key');
    if (runKey) runKey.disabled = state.busy;
    const aiBtn = $('ai-prompt');
    if (aiBtn) aiBtn.disabled = state.busy;
    $('display-settings').disabled = state.busy;
    for (const input of $('library-list').querySelectorAll('input')) {
      input.disabled = state.busy || !state.ready;
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
    const hint = $('run-hint');
    if (hint) {
      hint.textContent = I18n.t(
        state.ui.runKey === 'enter' ? 'run.hintEnter' : 'run.hintCtrl'
      );
    }
    const select = $('run-key');
    if (select) select.value = state.ui.runKey;
    window.__pycalcRunKeyMode = state.ui.runKey;
  }

  function applyTheme(theme, persist = true) {
    state.ui.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.ui.theme;
    const themeRadio = document.querySelector(`input[name="ui-theme"][value="${state.ui.theme}"]`);
    if (themeRadio) themeRadio.checked = true;
    if (editor && typeof editor.setTheme === 'function') editor.setTheme(state.ui.theme);
    applyPlotlyTheme();
    requestAnimationFrame(applyPlotlyTheme);
    if (py) {
      Promise.resolve(py.setPlotTheme(state.ui.theme)).catch((err) => {
        console.warn('plot theme failed', err);
      });
    }
    if (persist) saveUiMeta();
  }

  function applyRunKey(runKey, persist = true) {
    state.ui.runKey = runKey === 'enter' ? 'enter' : 'ctrl-enter';
    renderRunHint();
    if (!state.history.length) renderConsole();
    if (persist) saveUiMeta();
  }

  function renderDisplaySettings() {
    const setRadio = (name, value) => {
      const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
      if (input) input.checked = true;
    };
    setRadio('ui-theme', state.ui.theme);
    setRadio('sympy-output', state.ui.sympyOutput);
    setRadio('numpy-output', state.ui.numpyOutput);
    setRadio('dataframe-output', state.ui.dataframeOutput);
    const rows = $('display-dataframe-rows');
    if (rows) rows.value = String(state.ui.dataframeRows);
    const cols = $('display-dataframe-cols');
    if (cols) cols.value = String(state.ui.dataframeCols);
    const tabs = $('display-numpy-tabs');
    if (tabs) tabs.value = String(state.ui.numpyTabs);
    const npRows = $('display-numpy-rows');
    if (npRows) npRows.value = String(state.ui.numpyRows);
    const npCols = $('display-numpy-cols');
    if (npCols) npCols.value = String(state.ui.numpyCols);
    const floatDigits = $('display-float-digits');
    if (floatDigits) floatDigits.value = String(state.ui.floatDigits);
    const hide = $('display-hide-plot');
    if (hide) hide.checked = Boolean(state.ui.hidePlotResult);
  }

  function renderSympyControl() {
    const button = $('display-settings');
    if (!button) return;
    button.title = I18n.t('display.open');
    button.setAttribute('aria-label', button.title);
    renderDisplaySettings();
  }

  function openDisplaySettings() {
    renderDisplaySettings();
    const dialog = $('display-dialog');
    if (dialog) dialog.classList.remove('hidden');
  }

  function closeDisplaySettings() {
    const dialog = $('display-dialog');
    if (dialog) dialog.classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // AI Prompt Helper dialog
  // ---------------------------------------------------------------------

  function aiMarkdownFence(text, lang = '') {
    const body = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    let maxRun = 2;
    const matches = body.match(/`+/g);
    if (matches) {
      for (const m of matches) {
        if (m.length > maxRun) maxRun = m.length;
      }
    }
    const fence = '`'.repeat(maxRun + 1);
    return `${fence}${lang}\n${body}\n${fence}`;
  }

  function truncateAiText(text, maxChars) {
    const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars).trimEnd()}\n${I18n.t('ai.tpl.truncated')}`;
  }

  function formatAiHistoryOutput(entry) {
    if (!entry || entry.outputHidden) return '';
    const parts = [];
    const text = outputText(entry);
    if (text) parts.push(truncateAiText(text, 1200));
    const displayImages = Array.isArray(entry.displays)
      ? entry.displays.filter((item) => item && item.image).length : 0;
    const totalImages = (entry.images ? entry.images.length : 0) + displayImages;
    if (totalImages > 0) {
      parts.push(I18n.t('ai.tpl.imageNote', { count: totalImages }));
    }
    const hasDisplayPlotly = Array.isArray(entry.displays)
      && entry.displays.some((item) => item && item.resultPlotly);
    if (entry.resultPlotly || hasDisplayPlotly) {
      parts.push(I18n.t('ai.tpl.plotlyNote'));
    }
    return parts.join('\n');
  }

  function buildAiPrompt(overrides = {}) {
    const scope = overrides.historyScope !== undefined
      ? overrides.historyScope : state.ui.aiHistoryScope;
    const count = Math.max(
      1,
      Math.min(100, Number(overrides.historyCount !== undefined ? overrides.historyCount : state.ui.aiHistoryCount) || 5)
    );
    const includeOutputs = overrides.includeOutputs !== undefined
      ? Boolean(overrides.includeOutputs) : Boolean(state.ui.aiIncludeOutputs);
    const includeEditor = overrides.includeEditor !== undefined
      ? Boolean(overrides.includeEditor) : Boolean(state.ui.aiIncludeEditor);
    const includeContext = overrides.includeContext !== undefined
      ? Boolean(overrides.includeContext) : Boolean(state.ui.aiIncludeContext);
    const userPrompt = String(
      overrides.userPrompt !== undefined
        ? overrides.userPrompt
        : ($('ai-user-prompt') ? $('ai-user-prompt').value : '')
    ).replace(/\r\n?/g, '\n').trim();

    const sections = [];
    sections.push(I18n.t('ai.tpl.intro'));

    // Runtime & libraries section
    const envLines = [
      I18n.t('ai.tpl.envHeading'),
      I18n.t('ai.tpl.runtime', {
        python: CFG.pythonVersion || '3',
        pyodide: CFG.pyodideVersion || '',
      }),
      I18n.t('ai.tpl.math'),
    ];

    const selectedLibs = AVAILABLE_LIBS.filter((lib) => state.libraries.includes(lib.id));
    if (selectedLibs.length > 0) {
      const formatted = selectedLibs.map((lib) => `\`${lib.alias}\` (\`${lib.id}\`)`).join(', ');
      envLines.push(I18n.t('ai.tpl.autoImports', { libs: formatted }));
    } else {
      envLines.push(I18n.t('ai.tpl.noAutoImports'));
    }

    const availablePackages = new Set(AVAILABLE_LIBS.map((lib) => lib.package));
    const uncheckedNames = [];
    for (const lib of AVAILABLE_LIBS) {
      if (!state.libraries.includes(lib.id) && !uncheckedNames.includes(lib.id)) {
        uncheckedNames.push(lib.id);
      }
    }
    for (const pkg of (Array.isArray(CFG.libs) ? CFG.libs : [])) {
      if (!availablePackages.has(pkg) && !uncheckedNames.includes(pkg)) {
        uncheckedNames.push(pkg);
      }
    }
    if (uncheckedNames.length > 0) {
      envLines.push(I18n.t('ai.tpl.installedImports', {
        libs: uncheckedNames.map((name) => `\`${name}\``).join(', '),
      }));
    } else if (selectedLibs.length === 0) {
      envLines.push(I18n.t('ai.tpl.stdOnly'));
    }

    envLines.push(I18n.t('ai.tpl.outputRule'));

    const hasMatplotlib =
      (Array.isArray(CFG.libs) && CFG.libs.includes('matplotlib')) ||
      AVAILABLE_LIBS.some((lib) => lib.package === 'matplotlib' || lib.id.startsWith('matplotlib'));
    if (hasMatplotlib) {
      envLines.push(I18n.t('ai.tpl.matplotlibRule'));
    }
    const hasPlotly =
      Boolean(CFG.plotlyCharts) ||
      (Array.isArray(CFG.libs) && CFG.libs.includes('plotly')) ||
      AVAILABLE_LIBS.some((lib) => lib.package === 'plotly' || lib.id.startsWith('plotly'));
    if (hasPlotly) {
      envLines.push(I18n.t('ai.tpl.plotlyRule'));
    }
    sections.push(envLines.join('\n'));

    // Current session variables & functions
    if (includeContext && (state.variables.length > 0 || state.functions.length > 0)) {
      const ctxLines = [I18n.t('ai.tpl.contextHeading')];
      if (state.variables.length > 0) {
        ctxLines.push(I18n.t('ai.tpl.variablesLabel'));
        for (const item of state.variables) {
          const val = truncateAiText(item.value || '', 200).replace(/\n/g, ' ');
          ctxLines.push(`- \`${item.name}\` (${item.type}): ${val}`);
        }
      }
      if (state.functions.length > 0) {
        ctxLines.push(I18n.t('ai.tpl.functionsLabel'));
        for (const fn of state.functions) {
          ctxLines.push(`- \`${fn.name}${fn.params || '()'}\``);
        }
      }
      sections.push(ctxLines.join('\n'));
    }

    // Session history
    if (scope !== 'none' && state.history.length > 0) {
      const entries = scope === 'all' ? state.history : state.history.slice(-count);
      const histBlocks = [I18n.t('ai.tpl.historyHeading')];
      for (const entry of entries) {
        const parts = [
          I18n.t('ai.tpl.inputLabel', { n: entry.n }),
          aiMarkdownFence(entry.code || '', 'python'),
        ];
        if (includeOutputs) {
          const out = formatAiHistoryOutput(entry);
          if (out) {
            parts.push(I18n.t('ai.tpl.outputLabel', { n: entry.n }));
            parts.push(aiMarkdownFence(out, 'text'));
          }
        }
        histBlocks.push(parts.join('\n'));
      }
      sections.push(histBlocks.join('\n\n'));
    }

    // Current editor draft
    if (includeEditor && editor) {
      const currentCode = String(editor.getValue() || '').replace(/\r\n?/g, '\n').trim();
      if (currentCode) {
        sections.push(`${I18n.t('ai.tpl.editorHeading')}\n${aiMarkdownFence(currentCode, 'python')}`);
      }
    }

    // User request
    if (userPrompt) {
      sections.push(`${I18n.t('ai.tpl.requestHeading')}\n${userPrompt}`);
    }

    // Output format instructions
    sections.push(`${I18n.t('ai.tpl.formatHeading')}\n${I18n.t('ai.tpl.formatRule')}`);

    return sections.join('\n\n');
  }

  function extractCodeFromAiResponse(raw) {
    const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    if (!text.trim()) return '';

    const lines = text.split('\n');
    const pythonBlocks = [];
    const plainBlocks = [];
    const otherBlocks = [];

    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let fenceLang = '';
    let buf = [];

    const flushBlock = () => {
      const content = buf.join('\n').replace(/^\n+|\n+$/g, '');
      if (content.trim()) {
        if (['python', 'py', 'python3', 'ipython'].includes(fenceLang)) {
          pythonBlocks.push(content);
        } else if (!fenceLang) {
          plainBlocks.push(content);
        } else {
          otherBlocks.push(content);
        }
      }
      buf = [];
    };

    for (const line of lines) {
      if (!inFence) {
        const open = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`~]*)\s*$/);
        if (open) {
          inFence = true;
          fenceChar = open[1][0];
          fenceLen = open[1].length;
          fenceLang = (open[2] || '').toLowerCase();
          buf = [];
          continue;
        }
      } else {
        const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
          flushBlock();
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          fenceLang = '';
          continue;
        }
        buf.push(line);
      }
    }
    if (inFence) flushBlock();

    if (pythonBlocks.length > 0) return pythonBlocks.join('\n\n');
    if (plainBlocks.length > 0) return plainBlocks.join('\n\n');
    if (otherBlocks.length > 0) return otherBlocks.join('\n\n');
    return text.trim();
  }

  function renderAiOptions() {
    const scopeEl = $('ai-history-scope');
    if (scopeEl) scopeEl.value = state.ui.aiHistoryScope;
    const countEl = $('ai-history-count');
    if (countEl) countEl.value = String(state.ui.aiHistoryCount);
    const countWrap = $('ai-history-count-wrap');
    if (countWrap) countWrap.classList.toggle('hidden', state.ui.aiHistoryScope !== 'recent');

    const outputsEl = $('ai-include-outputs');
    const outputsWrap = $('ai-include-outputs-wrap');
    if (outputsEl) {
      outputsEl.checked = Boolean(state.ui.aiIncludeOutputs);
      outputsEl.disabled = state.ui.aiHistoryScope === 'none';
    }
    if (outputsWrap) {
      outputsWrap.classList.toggle('disabled', state.ui.aiHistoryScope === 'none');
    }

    const editorEl = $('ai-include-editor');
    if (editorEl) editorEl.checked = Boolean(state.ui.aiIncludeEditor);
    const contextEl = $('ai-include-context');
    if (contextEl) contextEl.checked = Boolean(state.ui.aiIncludeContext);
  }

  function syncAiOptionsFromUi() {
    const scopeEl = $('ai-history-scope');
    if (scopeEl && ['none', 'recent', 'all'].includes(scopeEl.value)) {
      state.ui.aiHistoryScope = scopeEl.value;
    }
    const countEl = $('ai-history-count');
    if (countEl) {
      state.ui.aiHistoryCount = Math.max(1, Math.min(100, Number(countEl.value) || 5));
    }
    const outputsEl = $('ai-include-outputs');
    if (outputsEl) state.ui.aiIncludeOutputs = Boolean(outputsEl.checked);
    const editorEl = $('ai-include-editor');
    if (editorEl) state.ui.aiIncludeEditor = Boolean(editorEl.checked);
    const contextEl = $('ai-include-context');
    if (contextEl) state.ui.aiIncludeContext = Boolean(contextEl.checked);
    renderAiOptions();
    saveUiMeta();
  }

  function openAiDialog() {
    renderAiOptions();
    const dialog = $('ai-dialog');
    if (!dialog) return;
    dialog.classList.remove('hidden');
    const promptInput = $('ai-user-prompt');
    if (promptInput) promptInput.focus();
  }

  function closeAiDialog() {
    const dialog = $('ai-dialog');
    if (dialog) dialog.classList.add('hidden');
  }

  function copyAiPrompt() {
    syncAiOptionsFromUi();
    const text = buildAiPrompt();
    return copyTextToClipboard(text)
      .then((ok) => {
        toast(ok ? 'ai.promptCopied' : 'console.clipboardFailed');
        return ok;
      })
      .catch(() => {
        toast('console.clipboardFailed');
        return false;
      });
  }

  function pasteIntoAiResponse() {
    const field = $('ai-response');
    if (!field) return Promise.resolve(false);
    return readTextFromClipboard()
      .then((raw) => {
        const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
        if (!text) {
          toast('editor.pasteEmpty');
          field.focus();
          return false;
        }
        field.value = text;
        field.focus();
        return true;
      })
      .catch(() => {
        toast('editor.pasteFailed');
        field.focus();
        return false;
      });
  }

  function applyExtractedAiCode() {
    const field = $('ai-response');
    if (!field || !editor) return false;
    const code = extractCodeFromAiResponse(field.value);
    if (!code) {
      toast('ai.extractEmpty');
      field.focus();
      return false;
    }
    setEditorText(code, true);
    state.historyNav.index = null;
    state.historyNav.draft = code;
    field.value = '';
    closeAiDialog();
    if (editor.focus) editor.focus();
    toast('ai.extracted');
    return true;
  }

  function applyDisplaySettings({ rowsOnly = false } = {}) {
    const checked = (name, fallback) => {
      const input = document.querySelector(`input[name="${name}"]:checked`);
      return input ? input.value : fallback;
    };
    state.ui.sympyOutput = checked('sympy-output', 'text');
    state.ui.numpyOutput = checked('numpy-output', 'default');
    state.ui.dataframeOutput = checked('dataframe-output', 'text');
    state.ui.dataframeRows = Math.max(
      1, Math.min(200, Number($('display-dataframe-rows')?.value) || 20)
    );
    state.ui.dataframeCols = Math.max(
      1, Math.min(50, Number($('display-dataframe-cols')?.value) || 10)
    );
    state.ui.numpyTabs = Math.max(
      1, Math.min(20, Number($('display-numpy-tabs')?.value) || 5)
    );
    state.ui.numpyRows = Math.max(
      1, Math.min(100, Number($('display-numpy-rows')?.value) || 20)
    );
    state.ui.numpyCols = Math.max(
      1, Math.min(50, Number($('display-numpy-cols')?.value) || 10)
    );
    const floatDigits = $('display-float-digits')?.value;
    state.ui.floatDigits = floatDigits === 'auto'
      ? 'auto'
      : [6, 8, 10, 12, 15].includes(Number(floatDigits)) ? Number(floatDigits) : 10;
    state.ui.hidePlotResult = Boolean($('display-hide-plot')?.checked);
    renderSympyControl();
    // Row count is deliberately captured into each new table; changing it
    // must not rewrite tables that are already in history.
    if (!rowsOnly && !state.busy) renderConsole();
    saveUiMeta();
  }

  function applySympyOutput(mode, persist = true) {
    state.ui.sympyOutput = mode === 'all' ? 'all' : mode === 'math' ? 'math' : 'text';
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
    positionRuntimeStatus();
    const button = $('session-bar-toggle');
    if (!button) return;
    button.innerHTML = hidden
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"></path></svg>';
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

  function applyPromptVisibility() {
    document.body.classList.toggle('hide-prompts', !state.ui.showPrompts);
    if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
  }

  function togglePrompts() {
    state.ui.showPrompts = !state.ui.showPrompts;
    applyPromptVisibility();
    saveUiMeta();
  }

  function applyLanguageToUi() {
    I18n.setLanguage(state.ui.language);
    $('language-select').value = state.ui.language;
    const aiBtn = $('ai-prompt');
    if (aiBtn) {
      aiBtn.title = I18n.t('ai.open');
      aiBtn.setAttribute('aria-label', aiBtn.title);
    }
    $('session-select').title = I18n.t('session.selectTitle');
    $('session-title').title = I18n.t('session.switchTitle');
    $('session-title').setAttribute('aria-label', I18n.t('session.switchTitle'));
    $('sidebar-toggle').title = I18n.t('sidebar.toggleTitle');
    const runKey = $('run-key');
    if (runKey) runKey.value = state.ui.runKey;
    renderRunHint();
    renderStatus();
    updateBusyUi();
    applySessionBar();
    renderLibraryBar();
    renderSnippets();
    renderSympyControl();
    updateHistoryButtons();
    applyPromptVisibility();
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
      getVariables: () => state.variables,
      getFunctions: () => state.functions,
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
      showPrompts: () => state.ui.showPrompts,
      togglePrompts: () => togglePrompts(),
      moveCursor: (direction) => editor.moveCursor && editor.moveCursor(direction),
      moveCursorWord: (direction) => editor.moveCursorWord && editor.moveCursorWord(direction),
      historyOrCursor: (direction) => {
        if (editor.moveHistoryOrCursor) editor.moveHistoryOrCursor(direction);
        if (editor.focus) editor.focus();
      },
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
    setupPromptMenu();
    $('run').addEventListener('click', runCode);
    $('session-select').addEventListener('change', (event) => switchSession(event.target.value));
    $('session-title').addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSessionMenu();
    });
    document.addEventListener('pointerdown', (event) => {
      const menu = $('session-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (menu.contains(event.target) || $('session-title').contains(event.target)) return;
      closeSessionMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeSessionMenu();
      closeDisplaySettings();
      closeAiDialog();
    });
    window.addEventListener('resize', closeSessionMenu);
    $('session-new').addEventListener('click', newSession);
    $('session-rename').addEventListener('click', renameSession);
    $('session-redraw').addEventListener('click', redrawSessionHistory);
    $('session-sweep').addEventListener('click', () => clearCurrentSession(true));
    $('session-delete').addEventListener('click', deleteSession);
    $('history-undo').addEventListener('click', undoHistory);
    $('history-redo').addEventListener('click', redoHistory);
    $('editor-paste').addEventListener('click', () => {
      pasteFromClipboard();
    });
    $('editor-clear').addEventListener('click', () => {
      setEditorText('', true);
      if (editor && editor.focus) editor.focus();
    });
    $('overlay-retry').addEventListener('click', () => location.reload());
    $('language-select').addEventListener('change', (event) => setLanguage(event.target.value));
    const runKey = $('run-key');
    if (runKey) runKey.addEventListener('change', (event) => applyRunKey(event.target.value));
    $('display-settings').addEventListener('click', openDisplaySettings);
    $('display-close').addEventListener('click', closeDisplaySettings);
    $('display-backdrop').addEventListener('click', closeDisplaySettings);
    $('display-dialog').addEventListener('change', (event) => {
      if (event.target && event.target.name === 'ui-theme') {
        applyTheme(event.target.value);
        return;
      }
      applyDisplaySettings({ rowsOnly: event.target.id === 'display-dataframe-rows' });
    });
    $('ai-prompt').addEventListener('click', openAiDialog);
    $('ai-close').addEventListener('click', closeAiDialog);
    $('ai-backdrop').addEventListener('click', closeAiDialog);
    $('ai-history-scope').addEventListener('change', syncAiOptionsFromUi);
    $('ai-history-count').addEventListener('change', syncAiOptionsFromUi);
    $('ai-include-outputs').addEventListener('change', syncAiOptionsFromUi);
    $('ai-include-editor').addEventListener('change', syncAiOptionsFromUi);
    $('ai-include-context').addEventListener('change', syncAiOptionsFromUi);
    $('ai-copy-prompt').addEventListener('click', copyAiPrompt);
    $('ai-paste-response').addEventListener('click', pasteIntoAiResponse);
    $('ai-extract-code').addEventListener('click', applyExtractedAiCode);
    $('ai-user-prompt').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        copyAiPrompt();
      }
    });
    $('ai-response').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        applyExtractedAiCode();
      }
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
        const aiDialog = $('ai-dialog');
        if (aiDialog && !aiDialog.classList.contains('hidden')) return;
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
        insertBlockAtCursor: (text, options) => cm.insertBlockAtCursor(text, options),
        insertTab: () => cm.insertTab(),
        insertNewline: () => cm.insertNewline(),
        undo: () => cm.undo(),
        deleteCharBefore: () => cm.deleteCharBefore(),
        moveCursor: (direction) => cm.moveCursor(direction),
        moveCursorWord: (direction) => cm.moveCursorWord(direction),
        moveHistoryOrCursor: (direction) => cm.moveHistoryOrCursor(direction),
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
      insertBlockAtCursor: (text) => {
        const value = String(text == null ? '' : text);
        if (!value) return;
        const doc = textarea.value;
        let start = textarea.selectionStart;
        let end = textarea.selectionEnd;

        if (start !== end) {
          const before = start > 0 ? doc.slice(start - 1, start) : '';
          const after = end < doc.length ? doc.slice(end, end + 1) : '';
          const prefix = start > 0 && before !== '\n' ? '\n' : '';
          const suffix = !value.endsWith('\n') && end < doc.length && after !== '\n' ? '\n' : '';
          const insert = prefix + value + suffix;
          textarea.setRangeText(insert, start, end, 'end');
          onInput();
          return;
        }

        const lineStart = doc.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = doc.indexOf('\n', start);
        const actualEnd = lineEnd === -1 ? doc.length : lineEnd;
        if (start > lineStart && start < actualEnd) {
          start = actualEnd;
        }
        const before = start > 0 ? doc.slice(start - 1, start) : '';
        const after = start < doc.length ? doc.slice(start, start + 1) : '';
        const prefix = start > 0 && before !== '\n' ? '\n' : '';
        const suffix = !value.endsWith('\n') && start < doc.length && after !== '\n' ? '\n' : '';
        const insert = prefix + value + suffix;
        textarea.setRangeText(insert, start, start, 'end');
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
    perf.mark('boot:start');
    bindUi();
    I18n.setLanguage(detectLanguage());
    setOverlay('overlay.startTitle', 'overlay.startDetail');
    perf.mark('boot:start'); 

    setOverlay('overlay.startTitle', 'overlay.db');
    try {
      state.storage = await openStorage();
    } catch (err) {
      console.warn('IndexedDB unavailable', err);
      state.storage = new MemoryStorage();
      banner('banner.idbUnavailable', { error: err.message || err }, 'bad', true);
    }
    perf.mark('boot:openStorage');
    state.ui = await loadUiMeta();
    perf.mark('boot:loadUiMeta');
    I18n.setLanguage(state.ui.language);
    await loadSnippetsMeta();
    document.documentElement.dataset.theme = state.ui.theme;
    $('language-select').value = state.ui.language;
    const runKey = $('run-key');
    if (runKey) runKey.value = state.ui.runKey;
    window.__pycalcRunKeyMode = state.ui.runKey;
    applySidebar();
    applySessionBar();
    perf.mark('boot:applyUiMeta');

    editor = createEditor();
    perf.mark('boot:createEditor');

    applyLanguageToUi();
    perf.mark('boot:applyLanguageToUi'); 

    state.sessions = (await state.storage.listSessions()) || [];
    perf.mark('boot:listSessions');
    await restoreActiveSession();
    perf.mark('boot:restoreActiveSession');

    // The editor, history and session shell are usable already.  Reveal them
    // before the (still main-thread) Python startup, and show progress in the
    // status slot instead of keeping a full-screen blocker.
    hideOverlay();
    setRuntimeStatus('runtime.loading');
    initMobileKeyboardUi();
    updateBusyUi();
    perf.mark('boot:uiReady');
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    try {
      await loadRuntime();
    } catch (err) {
      setRuntimeStatus(null);
      console.error(err);
      setOverlay(
        'overlay.runtimeTitle',
        'overlay.runtimeDetail',
        {},
        String((err && err.stack) || err)
      );
      perf.mark('boot:loadRuntime:failed');
      perf.summary(); 
      return;
    }
    perf.mark('boot:loadRuntime'); 

    try {
      const test = JSON.parse(await py.selfTest());
      setEngine(test.engine);
      if (test.engine === 'json') banner('banner.cloudpickleUnavailable', {}, 'warn', true);
    } catch (err) {
      console.warn('self test failed', err);
      setEngine('json');
    }
    perf.mark('boot:selfTest'); 

    window.__pycalcBootStage = 'boot:apply-namespace';
    await applyNamespaceForActiveSession();
    perf.mark('boot:applyNamespace');
    window.__pycalcBootStage = 'boot:ready';

    state.ready = true;
    await refreshInspector();
    window.__pycalcReady = true;
    updateBusyUi();
    hideOverlay();
    setStatus('status.ready');
    initMobileKeyboardUi();
    if (editor) editor.focus();
    if (!state.history.length) renderConsole();
    perf.mark('boot:ready');
    perf.summary();
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
      plotly: Boolean(entry.resultPlotly),
      displays: (entry.displays || []).length,
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
    setDisplaySettings: (settings) => {
      const next = settings || {};
      if (['text', 'math', 'all'].includes(next.sympyOutput)) {
        state.ui.sympyOutput = next.sympyOutput;
      }
      if (['default', 'pretty', 'table'].includes(next.numpyOutput)) {
        state.ui.numpyOutput = next.numpyOutput;
      }
      if (['text', 'table'].includes(next.dataframeOutput)) {
        state.ui.dataframeOutput = next.dataframeOutput;
      }
      if (next.dataframeRows !== undefined) {
        state.ui.dataframeRows = Math.max(1, Math.min(200, Number(next.dataframeRows) || 20));
      }
      if (next.dataframeCols !== undefined) {
        state.ui.dataframeCols = Math.max(1, Math.min(50, Number(next.dataframeCols) || 10));
      }
      if (next.numpyTabs !== undefined) {
        state.ui.numpyTabs = Math.max(1, Math.min(20, Number(next.numpyTabs) || 5));
      }
      if (next.numpyRows !== undefined) {
        state.ui.numpyRows = Math.max(1, Math.min(100, Number(next.numpyRows) || 20));
      }
      if (next.numpyCols !== undefined) {
        state.ui.numpyCols = Math.max(1, Math.min(50, Number(next.numpyCols) || 10));
      }
      if (next.floatDigits === 'auto') {
        state.ui.floatDigits = 'auto';
      } else if (next.floatDigits !== undefined && [6, 8, 10, 12, 15].includes(Number(next.floatDigits))) {
        state.ui.floatDigits = Number(next.floatDigits);
      }
      if (next.hidePlotResult !== undefined) {
        state.ui.hidePlotResult = Boolean(next.hidePlotResult);
      }
      renderSympyControl();
      renderConsole();
      saveUiMeta();
      return {
        sympyOutput: state.ui.sympyOutput,
        numpyOutput: state.ui.numpyOutput,
        dataframeOutput: state.ui.dataframeOutput,
        dataframeRows: state.ui.dataframeRows,
        dataframeCols: state.ui.dataframeCols,
        numpyTabs: state.ui.numpyTabs,
        numpyRows: state.ui.numpyRows,
        numpyCols: state.ui.numpyCols,
        floatDigits: state.ui.floatDigits,
        hidePlotResult: state.ui.hidePlotResult,
        showPrompts: state.ui.showPrompts,
      };
    },
    selectLibraries: async (ids) => {
      state.libraries = normalizeLibraryList(ids);
      renderLibraryBar();
      await applyLibraries(true);
      await refreshInspector();
      if (mobileKeyboard && mobileKeyboard.refresh) mobileKeyboard.refresh();
      await queueSave({ snapshot: false });
      return [...state.libraries];
    },
    isComplete: async (code) => {
      if (!py || !state.ready) return false;
      try { return Boolean(JSON.parse(await py.isComplete(code)).complete); } catch (_) { return false; }
    },
    getEditorValue: () => (editor ? editor.getValue() : ''),
    setEditorText: (text) => setEditorText(text, true),
    historyNav: (delta) => navigateHistory(delta),
    tryRunOnEnter: async () => {
      const complete = await tryRunOnEnter();
      if (complete) await runCode();
      return complete;
    },
    insertAtCursor: (text) => editor.insertAtCursor(text),
    variables: async () => (py && state.ready ? JSON.parse(await py.listVars()) : []),
    functions: async () => (py && state.ready ? JSON.parse(await py.listFuncs()) : []),
    completions: () => getCompletionOptions(),
    attributes: (expr) => getAttributeCompletions(expr),
    signature: (name) => signatureFor(name),
    buildAiPrompt: (overrides) => buildAiPrompt(overrides),
    extractAiCode: (text) => extractCodeFromAiResponse(text),
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
