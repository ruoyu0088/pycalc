# PyCalc

PyCalc 是一个**单文件离线 Python 计算器生成器**。构建脚本把 Pyodide 运行时和选定的科学计算库全部内联进一个 HTML；这个 HTML 可以双击、通过 `file://` 打开，不访问网络，具备 Jupyter/IPython 风格的输入输出、多个命名会话，以及跨刷新恢复的历史和变量。

```
pycalc-app/
├─ start.bat        ← 双击启动 Tkinter 构建器
├─ gui.py           ← 构建器 GUI
├─ build.py         ← 命令行入口
├─ pycalc_build/    ← 构建管线
├─ frontend/        ← CodeMirror 源码（产物已提交，构建 HTML 不需要 Node）
├─ tests/           ← 单元测试与浏览器验收
├─ cache/           ← 运行时/wheel 缓存（gitignore）
└─ dist/            ← 输出 HTML（gitignore）
```

参考资料（`console.html`、`inline_wasm_b64.py`、`test_indexeddb.html`）放在仓库外的 `../reference/`，不纳入 git。

---

## 快速开始

1. 双击 `start.bat`，打开构建器。
2. 勾选需要的内联库（默认 numpy / sympy / matplotlib），选择输出路径，点「构建」或「构建并打开」。
3. 生成完成后双击 HTML（或点「打开输出文件」）。

首次构建需要联网下载 Pyodide 运行时和 wheel；之后会复用 `cache/`，可以勾选「仅使用缓存（离线）」。

### 命令行

```bat
:: 默认：Pyodide 314.0.7，全部内联
python build.py --libs numpy sympy matplotlib --output dist\pycalc.html

:: 指定旧 LTS 运行时
python build.py --libs numpy sympy --pyodide-version 0.27.8 --output dist\pycalc-0278.html

:: 仅标准库（体积最小）
python build.py --libs --output dist\pycalc-min.html

:: 只准备缓存，不生成 HTML
python build.py --libs numpy sympy matplotlib --fetch-only

:: 查看某个版本 lock 中所有可安装包
python build.py --list-libs --pyodide-version 314.0.7
```

构建完成会打印最终 HTML 的**精确字节数**、Python 版本、依赖闭包和耗时。加 `--json` 可得到机器可读结果（日志走 stderr）。

---

## 版本与体积

| Pyodide | 运行时结构 | Python | 说明 |
|---|---|---|---|
| **314.0.7**（默认） | `pyodide.asm.mjs`（ESM） | 3.14.2 | 当前最新；numpy 2.4.6 / sympy 1.14.0 / matplotlib 3.10.8 |
| **0.27.8** | `pyodide.asm.js`（classic） | 3.12.7 | LTS 兼容版；numpy 2.0.2 / sympy 1.13.3 / matplotlib 3.8.4 |

构建器会探测版本属于哪种结构并选择适配器；其他 0.27.x / 0.29.x / 314.x 版本通常也能构建，但只有上表经过完整浏览器验收。未知结构会明确报错，不会生成坏文件。

体积参考（gzip wasm；具体以构建输出为准）：

| 内容 | HTML 约 |
|---|---|
| 仅标准库 | 9.5 MB |
| + numpy + sympy | 19.2 MB |
| + numpy + sympy + matplotlib | **31–32.3 MB**（314.0.7 约 32.3 MB；0.27.8 约 31.0 MB） |

体积主要来自 wheel（numpy/sympy/matplotlib 及其依赖）和 wasm。`file://` 下浏览器不会发送 `Accept-Encoding`，所以首次打开要解析整个文件；现代桌面 Chrome/Edge 通常 3–6 秒完成启动。

---

## 会话与持久化

- 页面顶部可以**新建 / 重命名 / 删除 / 切换**会话；每个会话有独立的名称、输入历史、执行计数、编辑器草稿和变量/函数快照。
- 数据库固定为 `pycalc-app-v1`，并带有固定的 `appId` 校验：
  - 把 HTML **复制/移动到任何目录**、或者重新构建一个新 HTML，只要还是**同一个浏览器 profile**，都会读写同一份会话。
  - 不会把数据写进 `TestDB_LocalFile` 之类的通用名称；若同名数据库的 `appId` 不匹配，会拒绝读写而不是混用。
- 命名空间使用 **cloudpickle**。每次执行后异步保存；切换会话或页面隐藏时也会保存。
- 历史输出（stdout/stderr、结果、异常、matplotlib PNG）随会话保存；图片以 Blob 存入 IndexedDB。
- 每个会话切换时会清空 `__main__` 的用户命名空间、回放历史中的顶层 `import`，再恢复目标快照，避免两个会话的变量互相污染。
- cloudpickle 自检失败时降级为 JSON 基础类型，并明确提示函数/类不会恢复。

### 必须知道的边界

- **IndexedDB 与浏览器绑定**：换浏览器、换 Chrome profile、换电脑、清理站点数据，都不会带走会话。可自行备份浏览器数据；跨机器迁移需要额外做导出/导入（当前未实现）。
- **`file://` 同源**：Chrome/Edge 把本地文件视为同一个 origin；其他本地 HTML 理论上也能打开同名数据库。唯一库名 + appId 只防误混，不是安全隔离。不要把敏感数据放在不受信任的本地 HTML 同一浏览器 profile 里。
- **升级 Pyodide/Python**：历史、会话名、结构一定保留；变量/函数快照跨 Python 大版本只能**尽力恢复**（pickle 字节码兼容性限制）。失败时会显示提示并保留旧快照，不会清空历史。
- **多个窗口**：同一会话同时打开多个 PyCalc 窗口时是最后写入者胜出，没有合并。建议一次只开一个。
- **Matplotlib**：图表会以 PNG 快照保存，figure 对象本身不参与会话序列化；恢复后看到的是图片，不是可继续操作的 figure。
- **单线程**：Pyodide 在页面主线程运行，长时间计算会冻结界面，且目前没有中断按钮；刷新页面即可终止。
- **顶层 await**：用户单元格按同步 exec/eval 执行，不支持顶层 `await`。
- **文件句柄、网络连接、生成器**等不可 pickle 的对象不会恢复；会列在“未能恢复”的提示里。

---

## 工作原理

1. **构建层**：读取选定版本的 `pyodide-lock.json`，递归解析 `depends`，下载运行时与 wheel 到 `cache/`，校验 wheel SHA256。
2. **内联**：wasm 用 gzip 压缩后 Base64；wheel 本身已是 ZIP/deflate，直接 Base64；`pyodide.asm.js/mjs` 与 `pyodide.js` 以文本内联。
3. **启动**：安装 fetch 拦截器，按文件名从内存返回 wasm/stdlib/lock/wheel；调用 `loadPyodide({packages})`，由 Pyodide 原生加载器解析依赖并安装。
   - 314.x：把 `pyodide.asm.mjs` 以 Blob URL 动态 import，把 default 作为 `createPyodideModule` 传入。
   - 0.27/0.29.x：内联 `pyodide.asm.js`，它定义全局 `_createPyodideModule`，加载器自动跳过二次加载。
4. **会话层**：IndexedDB 存 `meta / sessionIndex / sessionData`；Python 侧 glue 提供 `run / snapshot / restore / reset / replay imports / figure capture`。
5. **前端**：CodeMirror 6（Python 高亮、行号、Ctrl/Cmd+Enter）、IPython 风格单元格、流式 stdout/stderr、会话栏。

构建时不需要 Node；`pycalc_build/assets/editor.bundle.js` 已提交。只有修改编辑器源码时才需要：

```bat
cd frontend
npm install
npm run build
```

---

## 开发与测试

```bat
:: 纯 Python 单元测试（依赖闭包、编码、稳定 ID 等）
python -m unittest discover -s tests -p "test_*.py" -v

:: 浏览器验收（需要本机 Chrome/Edge；可用 PYCALC_BROWSER 指定）
python tests\acceptance.py
```

浏览器测试使用 CDP 直连 Chrome/Edge，不依赖 Playwright/Selenium；Python 侧只用到 `websocket-client`。测试会构建最小/完整 HTML，验证：

- `file://` 下启动、执行、零外部网络请求；
- numpy / sympy / matplotlib 与图片输出；
- 多个会话的新建、切换、变量隔离、刷新恢复；
- 复制 HTML 到其他目录后仍能读到会话；
- 314.0.7 与 0.27.8 两种运行时结构。

---

## 缓存与离线

```
cache/
├─ pyodide/<version>/     pyodide.js, pyodide.asm.*, wasm, stdlib, lock
└─ wheels/<version>/      lock 中的 wheel
```

- 默认优先缓存；`--refresh` 强制重新下载。
- `--offline` 只使用缓存，缺文件会列出缺失路径并报错。
- wheel 按 lock 的 SHA256 校验；校验失败会删除并重试一次。

---

## License / 参考

Pyodide 及其预编译 wheel 遵循各自上游许可证（主要是 MPL-2.0 / BSD / MIT）。本程序只是构建与 UI 包装；分发内联了 Pyodide 的 HTML 时请保留上游许可信息。
