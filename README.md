# PyCalc

PyCalc 是一个**单文件离线 Python 计算器生成器**。构建脚本把 Pyodide 运行时和选定的科学计算库全部内联进一个 HTML；这个 HTML 可以双击、通过 `file://` 打开，不访问网络，具备 Jupyter/IPython 风格的输入输出、多个命名会话，以及跨刷新恢复的历史和变量。

```
pycalc-app/
├─ start.bat        ← 双击启动 Tkinter 构建器
├─ gui.py           ← 构建器 GUI
├─ build.py         ← 命令行入口
├─ .github/workflows/deploy.yml ← GitHub Pages 自动构建/部署
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
2. 在「Libraries」文本编辑器里定义要内联的包和别名（默认 numpy / matplotlib / sympy），选择输出路径，点「构建」或「构建并打开」。
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

:: 构建日志语言（zh / en / ja）
python build.py --libs numpy --lang ja --output dist\pycalc-ja.html

:: 自定义自动导入别名（可重复；也可用 np:numpy 写法）
python build.py --libs numpy sympy --alias np=numpy --alias sp=sympy --output dist\pycalc.html

:: 只内联包，不自动导入/不生成库勾选项
python build.py --libs numpy --no-default-aliases --output dist\plain.html
```

构建完成会打印最终 HTML 的**精确字节数**、Python 版本、依赖闭包和耗时。加 `--json` 可得到机器可读结果（日志走 stderr）。

---

## 库定义与别名

Tk 构建器里的 **Libraries** 文本编辑器直接决定 HTML 内嵌哪些包，以及 HTML 顶部出现哪些自动导入勾选项。默认内容：

```text
# Packages embedded into the HTML (comma or whitespace separated).
numpy, matplotlib, sympy

# alias = import module (a colon also works)
np = numpy
plt = matplotlib.pyplot
sp = sympy
```

规则：

- 不含 `=` / `:` 的行是**包列表**，可用逗号或空格分隔；可以写多行。
- 含 `=` 或 `:` 的行是**别名定义**：`alias = 导入模块`。例如 `pd = pandas`、`np:numpy`。
- 空行、`#` / `;` 注释会被忽略；也支持可选的 `[packages]` / `[aliases]` 分节，便于阅读。
- 别名必须是合法 Python 标识符；同一个别名或同一个模块不能重复定义。
- 包对应哪个模块由 Pyodide lock 的 `imports` 元数据推断，因此 `plt = matplotlib.pyplot`、`sk = sklearn`（包为 scikit-learn）这类子模块/不同名模块都能解析。
- 如果别名指向的模块不被已选包提供，构建会明确报错，提示补上提供该模块的包。
- **一个别名对应一个 HTML 勾选项**。只写包、不写别名时，该包仍会内联，但不会产生自动导入勾选项。
- 勾选项行为：勾选 `np = numpy` 后，HTML 自动执行 `import numpy as np`；勾选 `plt = matplotlib.pyplot` 后自动 `import matplotlib.pyplot as plt`；`pd = pandas` 同理。

用户示例（包含 pandas）：

```text
numpy, matplotlib, sympy, pandas

np = numpy
plt = matplotlib.pyplot
sp = sympy
pd = pandas
```

GUI 的所有设置（包括这段库定义）保存在 `gui_settings.json`；下次启动自动恢复。旧版本只保存 `libs` 列表的配置会自动迁移成新文本格式。

---

## GitHub Pages 自动部署

仓库已包含 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。**仓库根目录应该是包含 `build.py` 的 `pycalc-app/`**（不要把父目录的 `reference/`、`agent.md` 一起作为仓库根）。把项目推到 GitHub 后即可自动构建并发布：

1. 推送到默认分支 `main` 或 `master`（也可以在 Actions 页面手动运行 `Build and deploy PyCalc`）。
2. 一次性打开仓库 **Settings → Pages → Build and deployment**，把 **Source** 设为 **GitHub Actions**。GitHub 的 API 允许用 PAT 自动开启 Pages，但默认 `GITHUB_TOKEN` 不能完成“首次启用”，所以这里需要手动点一次；之后每次 push 都会全自动发布。若希望首次也零点击，可创建一个有 Pages 写权限的 PAT，保存为 `PAGES_TOKEN`，再在 `configure-pages` 步骤加 `token: ${{ secrets.PAGES_TOKEN }}` 和 `enablement: true`。
3. workflow 会：
   - 运行单元测试（无显示环境会自动跳过 Tk 测试）；
   - 下载/复用缓存的 Pyodide 运行时和 wheel；
   - 构建全量 HTML；
   - 输出 `_site/index.html`；
   - 通过 `actions/deploy-pages` 发布。
4. 发布完成后，Actions 的 `deploy` 任务会给出 URL，格式为：

   `https://<用户名>.github.io/<仓库名>/`

默认构建配置在 workflow 顶部的 `env` 中：

```yaml
env:
  PYCALC_VERSION: "314.0.7"
  PYCALC_LIBS: "numpy sympy matplotlib"
```

想改变内联库或 Pyodide 版本时改这里即可。默认会使用 CLI 的常规别名（`np` / `plt` / `sp` / `pd`）；如果 Pages 构建也需要自定义别名，请在工作流的 `python build.py` 命令中追加 `--alias` 参数（Tk 的 `gui_settings.json` 只在本机使用，不会自动同步到 Actions）。首次运行需要从 CDN 下载运行时和 wheel，之后会复用 `cache/`；HTML 约 34 MB，在 GitHub Pages 的容量限制内。

注意：Pages 站点是独立的 `https://` origin，它的 IndexedDB 会话与本地 `file://` 打开的 HTML **不会共享**；这是浏览器同源策略决定的。

---

## 界面功能

- **三语界面**：中文 / English / 日本語。HTML 在顶栏切换；Tk 构建器在右上角切换。语言偏好会记住，首次默认跟随浏览器/系统语言。
- **一个连续输出块**：不再为每条输入输出生成独立卡片，也没有“成功 / In[n] / 时间”标题栏。所有 `In` / `Out` 依次排在一个可滚动面板里。
- **点击 `In` / `Out` 插入**：把历史输入代码或输出文本插入到编辑器当前光标位置（不是替换）。只有图片、没有文本的输出会提示无可插入文本。
- **`ans` 保存上一次有效结果**：每次运行后，如果最后一个表达式的结果不是 `None`，就把该对象保存到 `ans`。`print(...)`、纯赋值、显式 `None` 和异常都不会覆盖上一次的 `ans`；`ans` 会进入变量表并随会话快照保存/恢复。
- **运行后清空输入框**；`↑` / `↓` 在历史输入之间切换，并在回到最新一条时恢复未提交的草稿。
- **侧栏宽度可调**：拖动侧栏和主区之间的分隔条即可调整，宽度会记住。窄屏时侧栏变为抽屉，分隔条自动隐藏。
- **IPython 风格属性补全**：输入 `x.`、`np.`、`np.linalg.` 会列出该对象的成员/方法/模块函数，函数项带签名；输入 `arr.re` 这类前缀会继续过滤。补全优先使用当前会话中**已执行对象**的真实类型；如果变量还没运行，也会从编辑器里的赋值/类型注解做静态推断，例如 `arr = np.linspace(1, 2)` 后输入 `arr.` 也能识别为 `numpy.ndarray`，底部显示 `arr : numpy.ndarray`。私有成员默认隐藏，输入 `_` 后展开。顶层变量/函数名仍然可以补全；不再补全 `if` / `for` 等关键字。
- **SymPy 输出格式**：库栏右侧提供“SymPy 输出”选项，可在**文本**与**数学表达式**之间切换。数学模式使用浏览器原生 MathML 渲染 SymPy 结果（分式、幂、方程、矩阵等），切换会立即重绘已有输出；该偏好全局保存。普通 Python 结果始终按文本显示，`print()` 输出也不变。
- **函数调用 Hint**：在 `f(`、`np.linspace(`、`arr.reshape(` 内，光标附近显示签名；`Ctrl+Space` 可手动触发补全。
- **括号/引号自动配对**：输入 `(`、`[`、`{`、`'`、`"` 自动补全右侧；选中文字后输入括号/引号会包裹选区。
- **选中文字高对比**：编辑器选区在亮色/暗色主题下都有明显背景色，不再与普通文本混在一起。
- 属性补全优先使用实时命名空间；尚未运行的赋值会对常见 numpy/sympy/matplotlib 构造器和类型注解做静态推断，其他复杂表达式仍建议先运行再补全。
- **运行键可选**：`Ctrl/Cmd+Enter` 或 `Enter`。选择 `Enter` 时，只有 Python 认为代码“完整”才运行（`def`/`if`/括号未闭合、语法错误等都保持换行）；`Shift+Enter` 始终换行；输入法组合输入时不会误触发。
- **明暗主题**：CSS、CodeMirror 语法高亮、Matplotlib 默认样式一起切换。首次跟随系统 `prefers-color-scheme`，之后记住选择。Matplotlib 只影响切换主题之后生成的图，历史 PNG 不重绘。
- **扩展库 checkbox**：输入框上方列出**构建时库定义**里的每个别名，例如 `numpy (np)`、`matplotlib.pyplot (plt)`、`sympy (sp)`、`pandas (pd)`。勾选后自动导入，无需写 `import`。新会话默认只加载 Math，扩展库需要勾选；选择状态保存在会话里，切换会话时恢复。
- **Math 始终加载**：`sin, cos, tan, sqrt, exp, log, log10, factorial, pi, e, inf, nan` 等名字可直接使用，像普通计算器一样；Math 不出现在扩展库列表中，也不会写入变量表。
- **左侧栏两张表**：当前会话的用户变量（名称 / 类型 / 值）和用户函数（名称 / 参数）。每次运行、切换会话、修改扩展库后刷新；自动导入的名字和函数不会出现在表里。

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
| 仅标准库 | 10.1 MB（9.6 MiB） |
| + numpy + sympy | 约 20.3 MB |
| + numpy + sympy + matplotlib | **34.0 MB / 32.4 MiB**（314.0.7）；**32.7 MB / 31.1 MiB**（0.27.8） |

体积主要来自 wheel（numpy/sympy/matplotlib 及其依赖）和 wasm。`file://` 下浏览器不会发送 `Accept-Encoding`，所以首次打开要解析整个文件；现代桌面 Chrome/Edge 通常 3–6 秒完成启动。

---

## 会话与持久化

- 页面顶部可以**新建 / 重命名 / 删除 / 切换**会话；每个会话有独立的名称、输入历史、执行计数、编辑器草稿、变量/函数快照，以及**扩展库勾选状态**。
- 数据库固定为 `pycalc-app-v1`，并带有固定的 `appId` 校验：
  - 把 HTML **复制/移动到任何目录**、或者重新构建一个新 HTML，只要还是**同一个浏览器 profile**，都会读写同一份会话。
  - 不会把数据写进 `TestDB_LocalFile` 之类的通用名称；若同名数据库的 `appId` 不匹配，会拒绝读写而不是混用。
- 语言、主题、运行键是**全局界面偏好**，存在 IndexedDB `meta`；扩展库勾选是**按会话**保存。
- 数据结构为 schema v2；打开 v1 旧会话时会自动迁移（保留历史与变量，扩展库默认为空）。会话切换时先清空 `__main__`、应用 Math 和当前扩展库、回放历史中的顶层 `import`，再恢复目标快照。
- 命名空间使用 **cloudpickle**。每次执行后异步保存；切换会话或页面隐藏时也会保存。自动导入的 `np/plt/sp`、Math 名字不进入快照。
- 历史输出（stdout/stderr、结果、异常、matplotlib PNG）随会话保存；图片以 Blob 存入 IndexedDB。
- cloudpickle 自检失败时降级为 JSON 基础类型，并明确提示函数/类不会恢复。

### 必须知道的边界

- **IndexedDB 与浏览器绑定**：换浏览器、换 Chrome profile、换电脑、清理站点数据，都不会带走会话。可自行备份浏览器数据；跨机器迁移需要额外做导出/导入（当前未实现）。
- **`file://` 同源**：Chrome/Edge 把本地文件视为同一个 origin；其他本地 HTML 理论上也能打开同名数据库。唯一库名 + appId 只防误混，不是安全隔离。不要把敏感数据放在不受信任的本地 HTML 同一浏览器 profile 里。
- **升级 Pyodide/Python**：历史、会话名、结构一定保留；变量/函数快照跨 Python 大版本只能**尽力恢复**（pickle 字节码兼容性限制）。失败时会显示提示并保留旧快照，不会清空历史。
- **多个窗口**：同一会话同时打开多个 PyCalc 窗口时是最后写入者胜出，没有合并。建议一次只开一个。
- **Matplotlib**：图表会以 PNG 快照保存，figure 对象本身不参与会话序列化；恢复后看到的是图片，不是可继续操作的 figure。主题只影响之后创建的图。Matplotlib 自带字体不含中日文字形，图表里的中文/日文标题可能显示方框（界面文本不受影响）。
- **Enter 运行键**：完整性判断使用 Python `codeop`；未闭合块或语法错误按“不完整”处理，Enter 只换行。要强制运行不完整代码请用 Ctrl/Cmd+Enter。
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
5. **前端**：CodeMirror 6（Python 高亮、行号、明暗主题、Enter/Ctrl+Enter 模式、历史上下键）、一个连续输出块、可点击的 In/Out 插入、扩展库 checkbox、变量/函数侧栏、流式 stdout/stderr。

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

- `file://` 下启动、执行、零外部网络请求；运行后清空输入框；
- Math 默认可用（`sin(pi/2)`），无需 import；
- numpy / sympy / matplotlib 与图片输出；
- 三语切换、扩展库自动导入与按会话恢复、变量/函数表；
- 一个连续输出块、点击 In/Out 在光标处插入；
- 属性补全（`x.` / `np.`）、类型推断（`ndarray`）、函数签名 Hint、括号/引号自动配对、选区高对比；
- SymPy 文本/数学输出切换、MathML 渲染、跨刷新偏好恢复；
- `ans` 保存非 None 结果、None/错误不覆盖、跨刷新恢复；
- 库定义文本解析、别名/模块去重、包→模块 provider 推断、GUI 配置持久化与旧配置迁移；
- 侧栏拖动宽度并跨刷新记住；
- Enter / Ctrl+Enter 两种运行键，真实键盘事件下完整性与 `↑` 历史导航；
- 明暗主题与 Matplotlib 只影响后续图；
- 多个会话的新建/重命名/删除/切换、变量隔离、刷新恢复；
- 复制 HTML、重建 HTML 后仍能读到会话；
- 314.0.7 与 0.27.8 两种运行时结构、跨版本历史保留。

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
