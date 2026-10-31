(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function fmtDateTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return '';
    }
  }

  function humanBytes(n) {
    if (!Number.isFinite(n)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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

  let toastTimer = null;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.add('hidden'), 4200);
  }

  let bannerTimer = null;
  function banner(message, kind = 'warn', sticky = false) {
    const node = $('banner');
    node.textContent = message;
    node.className = `banner ${kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : ''}`;
    node.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    if (!sticky) {
      bannerTimer = setTimeout(() => node.classList.add('hidden'), 9000);
    }
  }

  function setOverlay(title, detail, error) {
    $('overlay').classList.remove('hidden');
    $('overlay-title').textContent = title || '正在启动 PyCalc';
    $('overlay-detail').textContent = detail || '';
    const err = $('overlay-error');
    if (error) {
      err.textContent = error;
      err.classList.remove('hidden');
      $('overlay-retry').classList.remove('hidden');
    } else {
      err.classList.add('hidden');
      $('overlay-retry').classList.add('hidden');
    }
  }

  function hideOverlay() {
    $('overlay').classList.add('hidden');
  }

  function setStage(detail) {
    $('overlay-detail').textContent = detail;
  }

  // ---------------------------------------------------------------------
  // Build-time configuration and inlined assets
  // ---------------------------------------------------------------------

  const CFG = JSON.parse($('pycalc-config').textContent);
  const ASSETS = JSON.parse($('pycalc-assets').textContent);
  const PY_GLUE_SOURCE = $('pycalc-glue').textContent;
  window.__pycalcVersion = {
    app: CFG.appVersion,
    pyodide: CFG.pyodideVersion,
    python: CFG.pythonVersion,
    runtime: CFG.runtimeMode,
  };

  const decoded = new Map();

  function b64ToBytes(data) {
    if (typeof Uint8Array.fromBase64 === 'function') {
      return Uint8Array.fromBase64(data);
    }
    const raw = atob(data);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function decodeAsset(name) {
    if (decoded.has(name)) return decoded.get(name);
    const asset = ASSETS[name];
    if (!asset) throw new Error(`缺少内联资源：${name}`);
    let bytes = b64ToBytes(asset.data);
    if (asset.enc === 'gzip') {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('当前浏览器不支持 DecompressionStream，无法解压内联的 wasm。');
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
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
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
      // The whole point of the single-file build is that nothing external is
      // requested.  Make a miss loud instead of silently going online.
      console.warn('[PyCalc] blocked external request:', url);
      throw new Error(`PyCalc 单文件模式下不允许外部请求：${url}`);
    };
    // Expose for debugging without changing behaviour.
    window.__pycalcRealFetch = realFetch;
  }

  // ---------------------------------------------------------------------
  // Runtime boot
  // ---------------------------------------------------------------------

  let pyodide = null;
  let py = null; // bound glue functions
  let activeOutput = null;
  const streamDecoders = {
    stdout: new TextDecoder('utf-8'),
    stderr: new TextDecoder('utf-8'),
  };

  function dispatchStream(kind, text) {
    if (!text) return;
    if (activeOutput && typeof activeOutput[kind] === 'function') {
      activeOutput[kind](text);
    } else {
      // Initialisation messages are useful in devtools but not in the UI.
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
    setStage('加载 Pyodide 运行时（首次约 2 秒）…');
    await new Promise((resolve) => requestAnimationFrame(resolve));

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

    const options = {
      indexURL: 'https://pycalc.local/',
      packages: CFG.packages,
      stdout: (text) => dispatchStream('stdout', text),
      stderr: (text) => dispatchStream('stderr', text),
    };
    if (createPyodideModule) options.createPyodideModule = createPyodideModule;

    pyodide = await loadPyodide(options);
    // `write` preserves the exact bytes (including newlines).  `batched`
    // strips line endings, which would turn print(1); print(2) into "12".
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

    setStage('初始化 Python 会话…');
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
    };
  }

  // ---------------------------------------------------------------------
  // Storage: IndexedDB, with an in-memory fallback
  // ---------------------------------------------------------------------

  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_INDEX = 'sessionIndex';
  const STORE_DATA = 'sessionData';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('浏览器不支持 IndexedDB'));
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
      request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
      request.onblocked = () => reject(new Error('IndexedDB 被另一个页面阻塞，请关闭其他 PyCalc 页面'));
    });
  }

  function txPromise(db, storeNames, mode, action) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(storeNames, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务被中止'));
      try {
        result = action(tx);
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
    const rows = await reqValue(tx.objectStore(STORE_INDEX).getAll());
    return rows || [];
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
        throw new Error(
          `数据库 ${CFG.dbName} 中已有其他程序的数据（缺少 PyCalc 标识），为避免混用已停止。`
        );
      }
      await putMeta(db, {
        key: 'app',
        appId: CFG.appId,
        schemaVersion: CFG.schemaVersion,
        createdAt: Date.now(),
      });
    } else if (appMeta.appId !== CFG.appId) {
      throw new Error(
        `数据库 ${CFG.dbName} 属于其他程序（appId 不匹配），为避免混用已停止。`
      );
    }
    return new IdbStorage(db);
  }

  // ---------------------------------------------------------------------
  // Application state
  // ---------------------------------------------------------------------

  const state = {
    storage: null,
    sessions: [],
    activeId: null,
    activeName: '',
    history: [],
    executionCount: 0,
    draft: '',
    namespace: null,
    namespaceMeta: null,
    engine: 'unknown',
    busy: false,
    ready: false,
    saveChain: Promise.resolve(),
    saveTimer: null,
    draftTimer: null,
    objectUrls: [],
    activeOutput: null,
  };

  let editor = null;

  // ---------------------------------------------------------------------
  // History UI
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
    img.alt = '图表输出';
    img.loading = 'lazy';
    img.addEventListener('load', () => scrollToBottom());
    if (mime) img.dataset.mime = mime;
    return img;
  }

  function makeCell(entry) {
    const cell = el('div', 'cell');
    const head = el('div', 'cell-head');
    head.appendChild(el('span', 'cell-status ' + (entry.status === 'error' ? 'fail' : 'ok'),
      entry.status === 'error' ? '异常' : '成功'));
    head.appendChild(el('span', '', `In [${entry.n}]`));
    head.appendChild(el('span', 'time', fmtTime(entry.ts)));
    cell.appendChild(head);

    const body = el('div', 'cell-body');
    const inputRow = el('div', 'io-row');
    inputRow.appendChild(el('span', 'prompt', `In [${entry.n}]:`));
    inputRow.appendChild(el('pre', 'code', entry.code));
    body.appendChild(inputRow);

    if (entry.stdout) {
      const row = el('div', 'io-row io-block');
      row.appendChild(el('span', 'prompt', ''));
      row.appendChild(el('pre', 'stream', entry.stdout));
      body.appendChild(row);
    }
    if (entry.stderr) {
      const row = el('div', 'io-row io-block');
      row.appendChild(el('span', 'prompt', ''));
      row.appendChild(el('pre', 'stream stderr', entry.stderr));
      body.appendChild(row);
    }
    if (entry.result !== null && entry.result !== undefined) {
      const row = el('div', 'io-row io-block');
      row.appendChild(el('span', 'prompt out', `Out[${entry.n}]:`));
      row.appendChild(el('pre', 'result', entry.result));
      body.appendChild(row);
    }
    if (entry.error) {
      body.appendChild(el('pre', 'error', entry.error));
    }
    if (entry.images && entry.images.length) {
      const images = el('div', 'images');
      for (const image of entry.images) {
        if (image && image.blob) images.appendChild(makeImage(image.blob, image.mime));
      }
      if (images.childNodes.length) body.appendChild(images);
    }
    cell.appendChild(body);
    return cell;
  }

  function emptyState() {
    const node = el('div', 'empty-state');
    const p1 = el('p');
    p1.appendChild(el('strong', '', '开始计算'));
    node.appendChild(p1);
    const p2 = el('p', '', '在下方输入 Python 代码，按 Ctrl+Enter（macOS 用 Cmd+Enter）运行。');
    node.appendChild(p2);
    const p3 = el('p', '', 'numpy / sympy / matplotlib 已离线打包；每个会话拥有独立的历史与变量。');
    node.appendChild(p3);
    return node;
  }

  function setHistory(history) {
    revokeObjectUrls();
    const host = $('history');
    host.innerHTML = '';
    if (!history.length) {
      host.appendChild(emptyState());
      return;
    }
    for (const entry of history) host.appendChild(makeCell(entry));
    requestAnimationFrame(() => scrollToBottom());
  }

  function ensureHistoryHost() {
    const host = $('history');
    const empty = host.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function scrollToBottom() {
    const host = $('history');
    host.scrollTop = host.scrollHeight;
  }

  function maybeScroll() {
    const host = $('history');
    if (host.scrollHeight - host.scrollTop - host.clientHeight < 220) {
      host.scrollTop = host.scrollHeight;
    }
  }

  function createLiveCell(entry) {
    ensureHistoryHost();
    const cell = el('div', 'cell running');
    const head = el('div', 'cell-head');
    head.appendChild(el('span', 'cell-status', '运行中…'));
    head.appendChild(el('span', '', `In [${entry.n}]`));
    head.appendChild(el('span', 'time', fmtTime(entry.ts)));
    cell.appendChild(head);

    const body = el('div', 'cell-body');
    const inputRow = el('div', 'io-row');
    inputRow.appendChild(el('span', 'prompt', `In [${entry.n}]:`));
    inputRow.appendChild(el('pre', 'code', entry.code));
    body.appendChild(inputRow);

    const stdoutRow = el('div', 'io-row io-block hidden');
    stdoutRow.appendChild(el('span', 'prompt', ''));
    const stdoutEl = el('pre', 'stream');
    stdoutRow.appendChild(stdoutEl);
    body.appendChild(stdoutRow);

    const stderrRow = el('div', 'io-row io-block hidden');
    stderrRow.appendChild(el('span', 'prompt', ''));
    const stderrEl = el('pre', 'stream stderr');
    stderrRow.appendChild(stderrEl);
    body.appendChild(stderrRow);

    cell.appendChild(body);
    $('history').appendChild(cell);
    maybeScroll();

    const append = (row, node, text) => {
      row.classList.remove('hidden');
      node.textContent += text;
      maybeScroll();
    };

    return {
      cell,
      stdout(text) { append(stdoutRow, stdoutEl, text); },
      stderr(text) { append(stderrRow, stderrEl, text); },
      finish(finalEntry) {
        const stored = makeCell(finalEntry);
        cell.replaceWith(stored);
        requestAnimationFrame(() => scrollToBottom());
      },
    };
  }

  function setActiveOutput(handler) {
    activeOutput = handler;
    state.activeOutput = handler;
  }

  // ---------------------------------------------------------------------
  // Editor abstraction (textarea now, CodeMirror when bundled)
  // ---------------------------------------------------------------------

  function createEditor() {
    const textarea = $('editor');
    if (window.PyCalcEditor && typeof window.PyCalcEditor.create === 'function') {
      const host = el('div', 'cm-host');
      const initial = textarea.value;
      textarea.replaceWith(host);
      const cm = window.PyCalcEditor.create(host, {
        value: initial,
        onChange: (value) => {
          state.draft = value;
          scheduleSave({ snapshot: false, delay: 900 });
        },
      });
      return {
        getValue: () => cm.getValue(),
        setValue: (value) => cm.setValue(value || ''),
        focus: () => cm.focus(),
        isCodeMirror: true,
      };
    }

    const onInput = () => {
      state.draft = textarea.value;
      scheduleSave({ snapshot: false, delay: 900 });
    };
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.setRangeText('    ', start, end, 'end');
        onInput();
      }
    });
    return {
      getValue: () => textarea.value,
      setValue: (value) => { textarea.value = value || ''; state.draft = textarea.value; },
      focus: () => textarea.focus(),
      isCodeMirror: false,
    };
  }

  // ---------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------

  function activeSession() {
    return state.sessions.find((s) => s.id === state.activeId) || null;
  }

  function uniqueName(base) {
    const names = new Set(state.sessions.map((s) => s.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} (${n})`)) n += 1;
    return `${base} (${n})`;
  }

  function buildIndex(overrides = {}) {
    const current = activeSession();
    return {
      id: state.activeId,
      name: state.activeName,
      createdAt: current ? current.createdAt : Date.now(),
      updatedAt: Date.now(),
      executionCount: state.executionCount,
      ...overrides,
    };
  }

  function buildData() {
    return {
      id: state.activeId,
      history: state.history,
      draft: state.draft,
      namespace: state.namespace,
      namespaceMeta: state.namespaceMeta,
    };
  }

  async function doSave({ snapshot }) {
    if (!state.storage || !state.activeId) return;
    const index = buildIndex();
    const data = buildData();

    if (snapshot && py) {
      try {
        setSaveStatus('保存中…');
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
          // Keep the previous snapshot rather than replacing it with nothing.
          data.namespace = state.namespace;
          data.namespaceMeta = state.namespaceMeta;
          if (info.reason === 'too-large') {
            banner('当前命名空间超过 32 MB，变量快照未保存；历史仍会保存。');
          } else if (info.reason) {
            banner(`变量快照保存失败：${info.reason}`);
          }
        }
      } catch (err) {
        console.warn('snapshot failed', err);
        data.namespace = state.namespace;
        data.namespaceMeta = state.namespaceMeta;
        banner(`变量快照保存失败：${err.message || err}`);
      }
    }

    try {
      await state.storage.putSession(index, data);
      const existing = state.sessions.find((s) => s.id === index.id);
      if (existing) {
        existing.name = index.name;
        existing.updatedAt = index.updatedAt;
        existing.executionCount = index.executionCount;
      }
      setSaveStatus(`已保存 ${fmtTime(Date.now())}`);
    } catch (err) {
      console.warn('save failed', err);
      setSaveStatus('保存失败');
      banner(`会话保存失败：${err.message || err}`, 'bad');
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
    const opts = { snapshot: true, delay: 450, ...(options || {}) };
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

  function setSaveStatus(text) {
    $('save-status').textContent = text || '';
  }

  function setEngineBadge(engine) {
    state.engine = engine;
    const node = $('engine-badge');
    if (engine === 'cloudpickle') {
      node.textContent = 'cloudpickle';
      node.className = 'badge good';
      node.title = '变量、函数与类可以跨刷新恢复';
    } else if (engine === 'json') {
      node.textContent = '仅基础类型';
      node.className = 'badge warn';
      node.title = 'cloudpickle 不可用，只保存 int/str/list/dict 等基础类型';
    } else {
      node.textContent = '初始化中';
      node.className = 'badge';
    }
  }

  function renderSessionSelect() {
    const select = $('session-select');
    select.innerHTML = '';
    const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const session of sorted) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.name;
      option.title = `更新于 ${fmtDateTime(session.updatedAt)}`;
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
      name: uniqueName(name || '新会话'),
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
    };
    const data = { id, history: [], draft: '', namespace: null, namespaceMeta: null };
    await state.storage.putSession(index, data);
    state.sessions.push(index);
    return index;
  }

  async function ensureAtLeastOneSession() {
    if (state.sessions.length > 0) return;
    const created = await createSessionRecord('默认会话');
    state.activeId = created.id;
    state.activeName = created.name;
    state.history = [];
    state.executionCount = 0;
    state.draft = '';
    state.namespace = null;
    state.namespaceMeta = null;
    const active = await state.storage.getMeta('active');
    if (!active) await state.storage.putMeta({ key: 'active', value: created.id });
  }

  async function loadSessionIntoState(id) {
    const index = state.sessions.find((s) => s.id === id);
    if (!index) throw new Error('会话不存在');
    const data = (await state.storage.getSession(id)) || {
      id,
      history: [],
      draft: '',
      namespace: null,
      namespaceMeta: null,
    };
    state.activeId = id;
    state.activeName = index.name;
    state.history = Array.isArray(data.history) ? data.history : [];
    state.executionCount = Number(index.executionCount || 0);
    state.draft = data.draft || '';
    state.namespace = data.namespace || null;
    state.namespaceMeta = data.namespaceMeta || null;
    setHistory(state.history);
    if (editor) editor.setValue(state.draft);
    updateHeader();
  }

  async function applyNamespaceForActiveSession() {
    if (!py) return;
    setStage('恢复会话变量…');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      py.reset();
      const codes = state.history.map((entry) => entry.code).filter(Boolean);
      const replay = JSON.parse(py.replayImports(JSON.stringify(codes)));
      if (replay.failed && replay.failed.length) {
        banner(`部分 import 未能回放：${replay.failed.slice(0, 3).join('；')}`);
      }
      if (state.namespace) {
        const bytes = new Uint8Array(state.namespace);
        pyodide.FS.writeFile('/tmp/pycalc-restore.bin', bytes);
        const info = JSON.parse(py.restore('/tmp/pycalc-restore.bin'));
        if (!info.ok) {
          banner(`变量快照未能恢复：${info.error || '未知错误'}`, 'warn', true);
        } else if (info.failed && info.failed.length) {
          banner(
            `部分对象未能恢复（${info.failed.length} 个）：` +
            info.failed.slice(0, 4).map((f) => f.name).join('、'),
            'warn', true
          );
        }
      }
    } catch (err) {
      console.warn('restore failed', err);
      banner(`恢复会话变量失败：${err.message || err}`, 'bad', true);
    }
  }

  async function switchSession(id, options = {}) {
    if (state.busy) return;
    if (!id || id === state.activeId) return;
    state.busy = true;
    updateBusyUi();
    try {
      await saveNow();
      await loadSessionIntoState(id);
      await state.storage.putMeta({ key: 'active', value: id });
      await applyNamespaceForActiveSession();
      if (!options.silent) toast(`已切换到「${state.activeName}」`);
    } catch (err) {
      console.warn(err);
      banner(`切换会话失败：${err.message || err}`, 'bad', true);
    } finally {
      state.busy = false;
      updateBusyUi();
      if (editor) editor.focus();
    }
  }

  async function createSessionByName(name) {
    if (state.busy) return null;
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast('会话名称不能为空');
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
      toast(`已创建「${state.activeName}」`);
      return created.id;
    } catch (err) {
      console.warn(err);
      banner(`新建会话失败：${err.message || err}`, 'bad', true);
      return null;
    } finally {
      state.busy = false;
      updateBusyUi();
      if (editor) editor.focus();
    }
  }

  async function newSession() {
    if (state.busy) return;
    const raw = window.prompt('新会话名称', `会话 ${state.sessions.length + 1}`);
    if (raw === null) return;
    await createSessionByName(raw);
  }

  async function renameSession() {
    if (state.busy || !state.activeId) return;
    const raw = window.prompt('重命名会话', state.activeName);
    if (raw === null) return;
    const name = raw.trim();
    if (!name) {
      toast('会话名称不能为空');
      return;
    }
    if (state.sessions.some((s) => s.name === name && s.id !== state.activeId)) {
      toast('已存在同名会话');
      return;
    }
    try {
      state.activeName = name;
      const index = buildIndex({ name });
      const current = state.sessions.find((s) => s.id === state.activeId);
      if (current) current.name = name;
      await state.storage.putSession(index, buildData());
      updateHeader();
      toast('已重命名');
    } catch (err) {
      banner(`重命名失败：${err.message || err}`, 'bad');
    }
  }

  async function deleteSession() {
    if (state.busy || !state.activeId) return;
    if (!window.confirm(`删除会话「${state.activeName}」？历史与变量将永久删除。`)) return;
    state.busy = true;
    updateBusyUi();
    try {
      const doomed = state.activeId;
      await state.storage.deleteSession(doomed);
      state.sessions = state.sessions.filter((s) => s.id !== doomed);
      if (state.sessions.length === 0) {
        const created = await createSessionRecord('默认会话');
        await loadSessionIntoState(created.id);
        await state.storage.putMeta({ key: 'active', value: created.id });
        await applyNamespaceForActiveSession();
      } else {
        const next = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        await loadSessionIntoState(next.id);
        await state.storage.putMeta({ key: 'active', value: next.id });
        await applyNamespaceForActiveSession();
      }
      toast('会话已删除');
    } catch (err) {
      console.warn(err);
      banner(`删除会话失败：${err.message || err}`, 'bad', true);
    } finally {
      state.busy = false;
      updateBusyUi();
    }
  }

  async function deleteSessionById(id) {
    if (state.busy || !id) return false;
    const target = state.sessions.find((s) => s.id === id);
    if (!target) return false;
    const wasActive = id === state.activeId;
    state.busy = true;
    updateBusyUi();
    try {
      await state.storage.deleteSession(id);
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (wasActive) {
        if (state.sessions.length === 0) {
          const created = await createSessionRecord('默认会话');
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
      return true;
    } catch (err) {
      console.warn(err);
      banner(`删除会话失败：${err.message || err}`, 'bad', true);
      return false;
    } finally {
      state.busy = false;
      updateBusyUi();
    }
  }

  function updateBusyUi() {
    $('run').disabled = state.busy || !state.ready;
    $('session-select').disabled = state.busy;
    $('session-new').disabled = state.busy;
    $('session-rename').disabled = state.busy;
    $('session-delete').disabled = state.busy;
    $('run').textContent = state.busy ? '运行中…' : '运行';
  }

  // ---------------------------------------------------------------------
  // Running code
  // ---------------------------------------------------------------------

  async function runCode() {
    if (!state.ready || state.busy) return;
    const code = editor.getValue();
    if (!code.trim()) return;

    state.busy = true;
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
      error: null,
      images: [],
    };
    state.history.push(entry);
    const live = createLiveCell(entry);
    setActiveOutput({
      stdout: (text) => { entry.stdout += text; live.stdout(text); },
      stderr: (text) => { entry.stderr += text; live.stderr(text); },
    });
    // Give the browser one frame to paint the running state before Pyodide
    // blocks the main thread.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const result = JSON.parse(py.run(code));
      entry.status = result.ok ? 'ok' : 'error';
      entry.result = result.ok ? result.result : null;
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
      setActiveOutput(null);
      live.finish(entry);
      state.busy = false;
      updateBusyUi();
      scheduleSave({ snapshot: true, delay: 250 });
      if (editor) editor.focus();
    }
    return entry;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  async function restoreActiveSession() {
    await ensureAtLeastOneSession();
    const activeMeta = await state.storage.getMeta('active');
    let id = activeMeta ? activeMeta.value : null;
    if (!id || !state.sessions.some((s) => s.id === id)) {
      const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      id = sorted[0] ? sorted[0].id : state.activeId;
    }
    await loadSessionIntoState(id);
    await state.storage.putMeta({ key: 'active', value: id });
  }

  function bindUi() {
    $('run').addEventListener('click', runCode);
    $('session-select').addEventListener('change', (event) => {
      switchSession(event.target.value);
    });
    $('session-new').addEventListener('click', newSession);
    $('session-rename').addEventListener('click', renameSession);
    $('session-delete').addEventListener('click', deleteSession);
    $('overlay-retry').addEventListener('click', () => location.reload());

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        runCode();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.ready) {
        saveNow().catch(() => {});
      }
    });

    window.addEventListener('error', (event) => {
      console.error(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
    });
  }

  async function boot() {
    bindUi();
    editor = createEditor();
    setEngineBadge('unknown');

    installFetchShim();

    setStage('打开会话数据库…');
    try {
      state.storage = await openStorage();
    } catch (err) {
      console.warn('IndexedDB unavailable', err);
      state.storage = new MemoryStorage();
      banner(
        `IndexedDB 不可用，本次会话不会写入磁盘（${err.message || err}）。`,
        'bad', true
      );
    }

    const rows = await state.storage.listSessions();
    state.sessions = rows || [];
    await restoreActiveSession();
    renderSessionSelect();

    setStage(`加载 Pyodide ${CFG.pyodideVersion}（Python ${CFG.pythonVersion}）…`);
    try {
      await loadRuntime();
    } catch (err) {
      console.error(err);
      setOverlay(
        '无法启动 Python 运行时',
        '请检查生成文件是否完整，或重新构建。',
        String((err && err.stack) || err)
      );
      return;
    }

    try {
      const test = JSON.parse(py.selfTest());
      setEngineBadge(test.engine);
      if (test.engine === 'json') {
        banner('cloudpickle 不可用：只会保存基础类型，函数/类/复杂对象不会跨刷新恢复。', 'warn', true);
      }
    } catch (err) {
      console.warn('self test failed', err);
      setEngineBadge('json');
    }

    await applyNamespaceForActiveSession();

    state.ready = true;
    window.__pycalcReady = true;
    updateBusyUi();
    hideOverlay();
    if (editor) editor.focus();
    setSaveStatus('');
    if (!state.history.length) setHistory([]);
  }

  // Used by the CodeMirror Mod-Enter keymap.
  window.__pycalcRun = runCode;

  // Small programmatic surface used by the browser smoke tests.  It is also
  // handy in devtools; it does not expose anything that the UI cannot do.
  window.__pycalc = {
    get ready() { return state.ready; },
    engine: () => state.engine,
    sessions: () => state.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      executionCount: s.executionCount,
    })),
    active: () => ({ id: state.activeId, name: state.activeName, count: state.executionCount }),
    history: () => state.history.map((e) => ({
      n: e.n, code: e.code, status: e.status, result: e.result,
      error: e.error, stdout: e.stdout, stderr: e.stderr,
      images: (e.images || []).length,
    })),
    runCell: async (code) => {
      if (!state.ready) throw new Error('PyCalc 尚未就绪');
      editor.setValue(code);
      return runCode();
    },
    createSession: createSessionByName,
    switchSession: async (id) => {
      await switchSession(id);
      return state.activeId;
    },
    deleteSession: deleteSessionById,
    saveNow,
    lastEntry: () => state.history[state.history.length - 1] || null,
  };

  boot().catch((err) => {
    console.error(err);
    window.__pycalcBootError = String((err && err.stack) || err);
    setOverlay('启动失败', '发生未预期的错误。', window.__pycalcBootError);
  });
})();
