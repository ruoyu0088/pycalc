/*
 * PyCalc Python runtime worker.
 *
 * The main page keeps CodeMirror, history and storage responsive while this
 * worker loads Pyodide, runs Python and captures figures.  The worker is
 * created from a Blob that already contains pyodide.js (and, for classic
 * runtimes, pyodide.asm.js); assets, glue and the ESM asm module arrive in the
 * init message.
 */

const MIME = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.whl': 'application/octet-stream',
  '.zip': 'application/zip',
  '.data': 'application/octet-stream',
  '.so': 'application/octet-stream',
  '.py': 'text/x-python',
};

let config = null;
let assets = null;
let pyodide = null;
let py = null;
const decoded = new Map();
const streamDecoders = {
  stdout: new TextDecoder('utf-8'),
  stderr: new TextDecoder('utf-8'),
};

function post(message, transfer) {
  if (transfer && transfer.length) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function postStream(kind, text) {
  if (text) post({ type: 'stream', kind, text });
}

function b64ToBytes(data) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data);
  const raw = atob(data);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function decodeAsset(name) {
  if (decoded.has(name)) return decoded.get(name);
  const asset = assets[name];
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

function normalizeUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  try { return String(input); } catch (_) { return ''; }
}

function baseName(url) {
  const withoutQuery = url.split('#')[0].split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  return slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
}

function installFetchShim() {
  self.fetch = async (input) => {
    const url = normalizeUrl(input);
    const name = baseName(url);
    if (Object.prototype.hasOwnProperty.call(assets, name)) {
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
    throw new Error(`external request blocked: ${url}`);
  };
}

function installGlue(glueSource) {
  pyodide.globals.set('_pycalc_glue_source', glueSource);
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
del _pycalc_types, _pycalc_main, _pycalc_mod, _pycalc_name, _pycalc_glue_source
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

async function init(message) {
  config = message.config || {};
  assets = JSON.parse(message.assetsText || '{}');
  installFetchShim();
  post({ type: 'status', key: 'runtime.loading' });

  let createPyodideModule = null;
  if (message.runtimeMode === 'esm') {
    const blob = new Blob([message.asmSource], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(url);
      createPyodideModule = mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  post({ type: 'status', key: 'runtime.packages' });
  const options = {
    indexURL: 'https://pycalc.local/',
    packages: config.packages || [],
    stdout: (text) => postStream('stdout', text),
    stderr: (text) => postStream('stderr', text),
  };
  if (createPyodideModule) options.createPyodideModule = createPyodideModule;
  if (typeof globalThis.loadPyodide !== 'function') {
    throw new Error('Pyodide loader was not installed in the worker');
  }
  pyodide = await globalThis.loadPyodide(options);
  pyodide.setStdout({
    write: (buffer) => {
      postStream('stdout', streamDecoders.stdout.decode(buffer, { stream: true }));
      return buffer.byteLength;
    },
  });
  pyodide.setStderr({
    write: (buffer) => {
      postStream('stderr', streamDecoders.stderr.decode(buffer, { stream: true }));
      return buffer.byteLength;
    },
  });

  post({ type: 'status', key: 'runtime.init' });
  installGlue(message.glue || '');
  post({ type: 'ready' });
}

function flushStreams() {
  for (const kind of ['stdout', 'stderr']) {
    const rest = streamDecoders[kind].decode();
    if (rest) postStream(kind, rest);
  }
}

async function handleCall(message) {
  const id = message.id;
  try {
    let value;
    if (message.method === 'snapshot') {
      const path = '/tmp/pycalc-snapshot.bin';
      const info = JSON.parse(py.snapshot(path));
      if (info.ok) {
        const bytes = pyodide.FS.readFile(path);
        const copy = bytes.slice();
        post({ type: 'result', id, ok: true, value: { info, bytes: copy.buffer } }, [copy.buffer]);
        return;
      }
      value = { info };
    } else if (message.method === 'restore') {
      const bytes = message.args[0];
      const path = '/tmp/pycalc-restore.bin';
      pyodide.FS.writeFile(path, new Uint8Array(bytes));
      value = py.restore(path);
    } else {
      const fn = py[message.method];
      if (typeof fn !== 'function') throw new Error(`unknown runtime method: ${message.method}`);
      value = fn(...(message.args || []));
    }
    if (message.method === 'run' || message.method === 'figures') flushStreams();
    post({ type: 'result', id, ok: true, value });
  } catch (error) {
    post({
      type: 'result',
      id,
      ok: false,
      error: String((error && error.stack) || error),
    });
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    init(message).catch((error) => {
      post({ type: 'error', error: String((error && error.stack) || error) });
    });
  } else if (message.type === 'call') {
    handleCall(message);
  }
};

self.addEventListener('error', (event) => {
  post({ type: 'error', error: String((event && event.message) || event) });
});

self.addEventListener('unhandledrejection', (event) => {
  post({ type: 'error', error: String((event && event.reason) || event) });
});
