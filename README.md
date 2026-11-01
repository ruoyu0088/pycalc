# PyCalc

**[中文](README.md)** | [English](README.en.md) | [日本語](README.ja.md)

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

## PWA / 手机安装

构建时会在 HTML 旁边生成 4 个 PWA 附属文件：

```text
dist/
├─ pycalc.html
├─ manifest.json
├─ sw.js
├─ icon-192.png
└─ icon-512.png
```

`pycalc.html` 本身仍然是一个完全自包含的单文件；PWA 文件只是额外的兄弟文件，用于安装和离线缓存。Service Worker 只缓存入口 HTML、manifest 和图标——Pyodide/NumPy/Matplotlib 等运行时以及内联 Worker 都在 HTML 内部，不需要额外缓存。

`manifest.json` 使用亮色启动背景 `#f6f7f9` 和深色 `theme_color: #20252e`：manifest 是静态的，不能跟随系统主题；亮色背景匹配默认亮色界面，深色主题色匹配顶栏/状态栏。若要深色启动画面，可把两者都改为 `#0d1117`。

### 桌面验证

1. 在 `dist/` 下运行 `python -m http.server 8000`，打开 `http://localhost:8000/pycalc.html`。
2. Chrome/Edge DevTools → **Application → Service Workers**，确认 `sw.js` 为 **activated**。
3. **Application → Cache Storage**，应出现 `pycalc-<html-hash>`，包含入口页、`manifest.json` 和两个图标。
4. 在 **Network** 面板勾选 **Offline** 后刷新，页面应完整加载，并能运行 `1+1`。

`http://localhost` / `127.0.0.1` 被浏览器视为安全上下文，所以本地也允许 Service Worker；其他普通 `http://` 页面、`file://` 页面不会注册。

### Android Chrome

用 HTTPS 打开站点，例如：

```text
https://ruoyu0088.github.io/pycalc/
```

菜单 → **添加到主屏幕**，从主屏幕图标打开时应为 standalone（无地址栏）。首次联网后 Service Worker 会缓存入口；断网后仍可打开和执行。

### iOS Safari

- `file://` 不支持 IndexedDB，会话无法保存。
- 通过 `https://` 打开后可以“添加到主屏幕”，也支持 Service Worker 离线缓存。
- iOS 的 ITP 可能在长期不访问后清理站点存储，IndexedDB/缓存可能丢失；这是系统限制，无法通过前端绕过。

### 更新与边界

- `sw.js` 的缓存版本号来自最终 HTML 的 SHA256 前 8 位；**HTML 内容变化**时缓存名变化，用户下次打开会拉新版本。
- 同内容重复构建不会改变 `sw.js`；这是为了避免每次部署都让用户重新下载整个 HTML。
- 更新通常需要刷新两次：第一次拿到新 Service Worker，第二次页面由新缓存提供。
- `skipWaiting()` + `clients.claim()` 已启用，但没有额外的“更新提示”UI。
- `file://` 下 manifest 会被浏览器忽略，SW 注册被协议判断跳过；HTML 核心功能不受影响，只是不能安装/离线。
- `manifest.json` 的 `start_url` 固定为 `"./"`（Pages 上就是 `index.html`）。本地用 `pycalc.html` 做 HTTP 验收时，SW 会单独缓存 `pycalc.html`，离线刷新正常；但本地“安装”的启动页会指向目录，因此正式安装/主屏幕测试请使用 Pages 上的 `https://.../pycalc/` URL。
- Service Worker 缓存和 IndexedDB 都可能被浏览器在存储压力下清理。注册成功后会静默请求 `navigator.storage.persist()`，提高保留概率，但不能保证 iOS/存储清理场景下永久保留。
- 当前 Pages 构建包含 pandas/polars，HTML 约 **64 MB**；首次安装/离线缓存会比基础版本更重。
- 本地 `file://` 与 Pages 的 `https://` 是不同 origin，两边会话不共享。

---

## 界面功能

- **三语界面**：中文 / English / 日本語。HTML 在顶栏切换；Tk 构建器在右上角切换。语言偏好会记住，首次默认跟随浏览器/系统语言。
- **一个连续输出块**：不再为每条输入输出生成独立卡片，也没有“成功 / 时间”标题栏。输入和输出依次排在一个可滚动面板里。
- **编号即插入**：输入和输出前只显示 `[1]`、`[2]` 这样的编号；点击编号会把对应代码或输出文本插入到当前编辑器光标处，不会清空输入框。只有图片、没有文本的输出会提示没有可插入文本。
- **`ans` 保存上一次有效结果**：每次运行后，如果最后一个表达式的结果不是 `None`，就把该对象保存到 `ans`。`print(...)`、纯赋值、显式 `None` 和异常都不会覆盖上一次的 `ans`；`ans` 会进入变量表并随会话快照保存/恢复。
- **运行后清空输入框**；`↑` / `↓` 在历史输入之间切换，并在回到最新一条时恢复未提交的草稿。
- **侧栏宽度可调**：拖动侧栏和主区之间的分隔条即可调整，宽度会记住。窄屏时侧栏变为抽屉，分隔条自动隐藏。
- **IPython 风格属性补全**：输入 `x.`、`np.`、`np.linalg.` 会列出该对象的成员/方法/模块函数，函数项带签名；输入 `arr.re` 这类前缀会继续过滤。补全优先使用当前会话中**已执行对象**的真实类型；如果变量还没运行，也会从编辑器里的赋值/类型注解做静态推断，例如 `arr = np.linspace(1, 2)` 后输入 `arr.` 也能识别为 `numpy.ndarray`，底部显示 `arr : numpy.ndarray`。私有成员默认隐藏，输入 `_` 后展开。顶层变量/函数名仍然可以补全；不再补全 `if` / `for` 等关键字。
- **显示设置**：顶栏齿轮按钮打开对话框，可设置 SymPy 表达式（纯文本 / 数式 / 全数式）、NumPy 输出（默认 / 美观）、浮点精度（自动或 6/8/10/12/15 位有效数字）、DataFrame 输出（文本 / 表格）以及“有图表时隐藏最后一句表达式”。表格行数只影响之后生成的表格；其余设置会立即重绘已有历史。浮点结果保存数值树，历史可来回切换精度；DataFrame 表格的数字单元格也按该精度显示。旧历史缺少数值/表格/容器数式数据时回退为文本。
- **历史撤回/恢复**：库栏右侧提供 Undo / Redo，只移除或恢复最后一次输入的历史记录，不改变当前 Python 变量、`ans` 或函数。适合把输错的条目从历史里清掉；编号会复用。
- **函数调用 Hint**：在 `f(`、`np.linspace(`、`arr.reshape(` 内，光标附近显示签名；`Ctrl+Space` 可手动触发补全。
- **括号/引号自动配对**：输入 `(`、`[`、`{`、`'`、`"` 自动补全右侧；选中文字后输入括号/引号会包裹选区。
- **选中文字高对比**：编辑器选区在亮色/暗色主题下都有明显背景色，不再与普通文本混在一起。
- 属性补全优先使用实时命名空间；尚未运行的赋值会对常见 numpy/sympy/matplotlib 构造器和类型注解做静态推断，其他复杂表达式仍建议先运行再补全。
- **运行键可选**：`Ctrl/Cmd+Enter` 或 `Enter`。选择 `Enter` 时，只有 Python 认为代码“完整”才运行（`def`/`if`/括号未闭合、语法错误等都保持换行）；`Shift+Enter` 始终换行；输入法组合输入时不会误触发。
- **触摸设备精简**：`pointer: coarse` 且虚拟键盘成功创建后，隐藏运行键选择、运行按钮和底部提示栏；运行入口移到键盘的 `=` 键。桌面模式完全不变。
- **启动顺序**：编辑器和历史先显示，右上角固定浮层显示 `加载 Python… / 安装扩展库… / 初始化… / 恢复会话…`，不占用顶栏布局；runtime 就绪前运行、会话切换和扩展库勾选禁用。Python 在 Web Worker 中启动和运行，加载期间主线程仍可输入、滚动历史；Matplotlib 只在勾选 `plt` 或代码真正 `import` 时加载，普通计算不会再触发 `matplotlib.pyplot`。
- **明暗主题**：CSS、CodeMirror 语法高亮、Matplotlib 默认样式一起切换。首次跟随系统 `prefers-color-scheme`，之后记住选择。Matplotlib 只影响切换主题之后生成的图，历史 PNG 不重绘。
- **扩展库 checkbox**：输入框上方列出**构建时库定义**里的每个别名，例如 `numpy (np)`、`matplotlib.pyplot (plt)`、`sympy (sp)`、`pandas (pd)`。勾选后自动导入，无需写 `import`。新会话默认只加载 Math，扩展库需要勾选；选择状态保存在会话里，切换会话时恢复。
- **Math 始终加载**：`sin, cos, tan, sqrt, exp, log, log10, factorial, pi, e, inf, nan` 等名字可直接使用，像普通计算器一样；Math 不出现在扩展库列表中，也不会写入变量表。`range` 已移到函数抽屉。
- **函数抽屉**：`keyboard_layout.py` 的 `drawers.functions.items` 可手工维护内置函数（当前为 `print, range, enumerate, len, int, float, str, list, dict, set, tuple, sum, min, max, sorted, zip, map, filter`）；这些固定项排在前面，会话中用户定义的函数会自动追加在后面。
- **变量抽屉**：`drawers.variables.items` 默认手工放入 `x, y, z, a, b, c, i, j, k`，排在用户变量前面；同名用户变量不会重复显示。
- **左侧栏两张表**：当前会话的用户变量（名称 / 类型 / 值）和用户函数（名称 / 参数）。pandas / polars 的 `DataFrame` 值只显示 `shape` 和前 8 个列名，不显示完整表格。每次运行、切换会话、修改扩展库后刷新；自动导入的名字和函数不会出现在表里。

---

## 手机虚拟键盘

`pointer: coarse` 设备会在 `#app` 底部创建屏幕键盘，作为 flex 布局的一部分（不是 fixed 覆盖层）。桌面浏览器不创建键盘 DOM，`inputmode` 也不被修改。

### 两个输入 tab + 清空按钮

- **计算**：左侧 5 个纵向按钮（变量 / 函数 / 数学 / 库 / Python），右侧 6×5 数字/符号键盘；数值键、`π`、括号、空格、换行和运行键都在这里。
- **英文**：字母态 5 行，`⇧` 只让下一个字母大写；`123` 切到数字态，`ABC` 切回。数字态包含符号和 `空格 / ← / → / 回车`。
- **紧凑 tab 行**：计算 / 英文 / 补全 / 清空 / 收起按钮使用更小的间距和 padding。
- **光标箭头**：tab 行里的 `↑` / `↓` 在普通位置上下移动光标；位于首行/末行时分别切换上一条/下一条历史输入，与物理 ArrowUp/ArrowDown 一致。
- **清空**：位于英文 tab 后面，只清空编辑器内容，不改变当前 tab、历史或变量。
- **收起/展开**：tab 行最右侧的 `⌄` / `⌃` 控制是否显示键盘面板；收起时只保留 tab 行，历史区自动增高。再次点它或点计算/英文 tab 会滑出键盘。
- **回车自动缩进**：`⏎` 使用 CodeMirror 的 `insertNewlineAndIndent`，`for i in range(10):` 后回车会进入下一行并缩进 4 个空格。
- **收起 Session 条**：手机顶栏新增 `⌃` / `⌄` 按钮，可隐藏/显示会话条；隐藏后历史区同样变高，偏好会保存。

点击左上 4 个按钮会从**屏幕顶部**滑下抽屉；变量/函数/库在打开瞬间实时读取，运行后新增的 `f` 或变量立即可见。函数项自动补 `(`。

### 库快捷输入 tab

库抽屉只显示**当前已勾选**的扩展库 tab，标签使用别名（`np`、`plt`、`pd`、`pl`、`sp`、`la`），顺序按勾选顺序；没有勾选时显示“先勾选扩展库”。每个 tab 的按钮来自 `keyboard_layout.py` 的 `library_quick`，按钮**只显示英文名、不带 `(`**，点击时才插入括号。

```text
?arange(    库成员
?.sum(      库或对象都有的成员
.tolist(    只属于对象的成员
.shape      对象属性（无括号）
np          直接插入
```

- `?arange(`：`np|` → `np.arange(`；`np.|` → `np.arange(`；行首/运算符后 → `np.arange(`；其他位置直接插入 `np.arange(`。
- `?.sum(`：`np|` / `np.|` → `np.sum(`；`x|` / `x.|` / `x.y|` / `)` / `]` → `x.sum(`；行首/运算符后 → `np.sum(`。
- `.tolist(` / `.group_by(`：只在对象上下文插入；在 `np|`、`pl|`、行首、运算符后会提示“先输入对象”，不会生成 `np.tolist` 或 `pl.group_by`。
- `.dtype`、`.shape`、`.T` 只作为对象属性；`loc` / `iloc` 使用 `.loc[` / `.iloc[`，显示时不带 `[`。
- 没有快捷按钮的已选库显示“此库暂无快捷按钮”，不会隐藏 tab。

### 布局唯一真源

按键、tab、视图和抽屉全部定义在：

```text
pycalc_build/keyboard_layout.py -> LAYOUT
```

构建时通过 `page_config["keyboard"]` 内联为 `CFG.keyboard`；`keyboard.js` 不含任何硬编码的数学函数、关键字或按键列表。修改 `LAYOUT` 后重新构建即可。`keyboard.css` / `keyboard.js` 也内联进单文件 HTML。

### 系统键盘

- 编辑器 `contentDOM` 设置 `inputmode="none"`、`autocorrect=off`、`autocapitalize=none`、`spellcheck=false`、`virtualkeyboardpolicy=manual`；键盘按钮的 `pointerdown` 全部 `preventDefault`，因此不会把焦点交给按钮。
- **Android Chrome**：`inputmode=none` 下保持 CodeMirror 焦点和光标，系统键盘不弹出；如果某个 IME 仍弹出，`visualViewport` 高度骤降时才主动 `blur` 关闭。
- **iOS Safari**：不依赖 `inputmode=none`（iOS 对 contenteditable 不可靠）。键盘初始化时把 CodeMirror 切为 `EditorView.editable(false)` / `contenteditable=false`，但给 contentDOM 加 `tabindex=0` 并保持 focus，这样 CodeMirror 光标层仍能按时重绘；点击编辑器用 `posAtCoords` 设置选择位置，所有输入来自自定义键盘，系统键盘没有可编辑目标。
- iOS 的 `.cm-cursor` 通过 `mobile-keyboard-ios` CSS 显示并按 CodeMirror 位置闪烁；这不是额外叠加的假光标，而是 CodeMirror 自己重绘的光标层。
- 还没有真机自动化能力：DevTools 能验证 `contenteditable=false`、焦点、光标位置和输入，系统键盘是否真正不弹出还需要在 iPhone/Android 真机上确认。

### 屏幕适配

- `viewport-fit=cover` + `100dvh` + `env(safe-area-inset-*)`；键盘底部与顶部抽屉都避让刘海/Home Indicator。
- 键盘高度约 250–280 px；切换数字/符号态时高度会小幅变化。
- 键盘不依赖 Service Worker / manifest，`file://` 下同样可用。

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
| + 上述 + pandas + polars（当前 Pages） | 约 **64 MB / 61 MiB** |

体积主要来自 wheel（numpy/sympy/matplotlib 及其依赖）和 wasm。`file://` 下浏览器不会发送 `Accept-Encoding`，所以首次打开要解析整个文件；现代桌面 Chrome/Edge 通常 3–6 秒完成启动。

---

## 会话与持久化

- 顶栏左侧显示**当前会话名**，点击弹出会话切换菜单；默认会话名使用较短的 `Default` / `默认会话` / `デフォルト`，保证 390px 手机上一行显示。
- 页面顶部可以**新建 / 重命名 / 重绘历史 / 清空 / 删除 / 切换**会话；每个会话有独立的名称、输入历史、执行计数、编辑器草稿、变量/函数快照，以及**扩展库勾选状态**。
- **重绘历史（↻）**只重建当前会话的 DOM，并为 matplotlib PNG 重新创建 Blob URL；用于 iOS Safari 切换会话后图片变成问号的临时恢复。
- **清空当前会话（🧹）**会删除历史、变量、函数、`ans` 和编辑器内容，但保留会话名称、会话 ID 和扩展库勾选；操作前会确认。
- 顶栏不再显示 `cloudpickle` / `仅基础类型` 徽标；高级快照不可用时仍会通过提示条告知降级。
- 数据库固定为 `pycalc-app-v1`，并带有固定的 `appId` 校验：
  - 把 HTML **复制/移动到任何目录**、或者重新构建一个新 HTML，只要还是**同一个浏览器 profile**，都会读写同一份会话。
  - 不会把数据写进 `TestDB_LocalFile` 之类的通用名称；若同名数据库的 `appId` 不匹配，会拒绝读写而不是混用。
- 语言、主题、运行键是**全局界面偏好**，存在 IndexedDB `meta`；扩展库勾选是**按会话**保存。
- 数据结构为 schema v2；打开 v1 旧会话时会自动迁移（保留历史与变量，扩展库默认为空）。会话切换时先清空 `__main__`、应用 Math 和当前扩展库、回放历史中的顶层 `import`，再恢复目标快照。
- 命名空间使用 **cloudpickle**。每次执行后异步保存；切换会话或页面隐藏时也会保存。构建库定义自动导入的别名、Math 名字不进入快照。
- 历史输出（stdout/stderr、结果、异常、matplotlib PNG）随会话保存；图片以 Blob 存入 IndexedDB。
- cloudpickle 自检失败时降级为 JSON 基础类型，并明确提示函数/类不会恢复。

### 必须知道的边界

- **IndexedDB 与浏览器绑定**：换浏览器、换 Chrome profile、换电脑、清理站点数据，都不会带走会话。可自行备份浏览器数据；跨机器迁移需要额外做导出/导入（当前未实现）。
- **`file://` 同源**：Chrome/Edge 把本地文件视为同一个 origin；其他本地 HTML 理论上也能打开同名数据库。唯一库名 + appId 只防误混，不是安全隔离。不要把敏感数据放在不受信任的本地 HTML 同一浏览器 profile 里。
- **升级 Pyodide/Python**：历史、会话名、结构一定保留；变量/函数快照跨 Python 大版本只能**尽力恢复**（pickle 字节码兼容性限制）。失败时会显示提示并保留旧快照，不会清空历史。
- **多个窗口**：同一会话同时打开多个 PyCalc 窗口时是最后写入者胜出，没有合并。建议一次只开一个。
- **Matplotlib**：图表会以 PNG 快照保存，figure 对象本身不参与会话序列化；恢复后看到的是图片，不是可继续操作的 figure。主题只影响之后创建的图。Matplotlib 自带字体不含中日文字形，图表里的中文/日文标题可能显示方框（界面文本不受影响）。
- **Enter 运行键**：完整性判断使用 Python `codeop`；未闭合块或语法错误按“不完整”处理，Enter 只换行。要强制运行不完整代码请用 Ctrl/Cmd+Enter。
- **Web Worker**：Pyodide 在独立 Worker 中启动和执行，加载 Python 不阻塞编辑器和历史滚动；长时间计算会占满该 Worker，但主界面仍可滚动/输入，目前没有中断按钮，刷新页面即可终止。Worker 源码、Pyodide 和 wheel 仍全部内联在单文件 HTML 中。
- **顶层 await**：用户单元格按同步 exec/eval 执行，不支持顶层 `await`。
- **文件句柄、网络连接、生成器**等不可 pickle 的对象不会恢复；会列在“未能恢复”的提示里。

---

## 工作原理

1. **构建层**：读取选定版本的 `pyodide-lock.json`，递归解析 `depends`，下载运行时与 wheel 到 `cache/`，校验 wheel SHA256。
2. **内联**：wasm 用 gzip 压缩后 Base64；wheel 本身已是 ZIP/deflate，直接 Base64；`pyodide.asm.js/mjs` 与 `pyodide.js` 以文本内联。
3. **启动**：主线程只负责编辑器/历史/存储，读取内联资源后创建 Blob Worker；Worker 安装 fetch 拦截器，按文件名从内存返回 wasm/stdlib/lock/wheel，再调用 `loadPyodide({packages})`。
   - HTTP/PWA：314.x 使用 module worker；`file://` 下 module worker 受限，改用 classic worker 并隐藏 `importScripts` 探测。
   - 314.x 的 `pyodide.asm.mjs` 以 Blob URL 动态 import，把 default 作为 `createPyodideModule`。
   - 0.27/0.29.x 使用 classic worker，`pyodide.asm.js` 定义全局 `_createPyodideModule`。
   - Service Worker 明确跳过 `blob:`/`data:` 请求，避免拦截内联 Worker。
4. **会话层**：IndexedDB 存 `meta / sessionIndex / sessionData`；Python 侧 glue 提供 `run / snapshot / restore / reset / replay imports / figure capture`。
5. **前端**：CodeMirror 6（Python 高亮、行号、明暗主题、Enter/Ctrl+Enter 模式、历史上下键）、一个连续输出块、可点击的编号插入、扩展库 checkbox、变量/函数侧栏、流式 stdout/stderr。
6. **手机键盘**：`keyboard_layout.py` 生成 `CFG.keyboard`；`keyboard.js` 只做渲染/动作分发；`app.js` 提供编辑器回调；全部内联进 HTML。

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

- `file://` 下 Web Worker 启动、执行、零外部网络请求；运行后清空输入框；
- 启动进度是固定定位浮层，不属于顶栏，也不改变顶栏高度；
- HTTP/PWA 下 module worker 与 `file://` 下 classic worker 两条路径；
- Math 默认可用（`sin(pi/2)`），无需 import；
- numpy / sympy / matplotlib 与图片输出；
- 三语切换、扩展库自动导入与按会话恢复、变量/函数表；变量/函数抽屉手工项在用户项之前并去重、`range` 从 Math 移入 Func；
- 一个连续输出块、`[n]` 编号插入到当前光标且不清空已有内容；
- pandas / polars `DataFrame` 变量只显示 shape 和列名；
- 手机系统键盘不接管：Android `inputmode=none`、iPhone `contenteditable=false` + focus 光标、虚拟键盘 DOM、calc/en 两 tab + 清空 + 收起按钮、`(1+2)*3` → 9、`⇧` / `123` / `ABC`、语言切换即时更新；
- 手机顶栏隐藏/显示 Session 条、键盘收起/展开后工作区高度变化与持久化；
- 库快捷 tab：只显示勾选库、别名标签、无 `?`/`.`/`(` 的按钮文字、`?` / `?.` / `.` 插入规则、对象专属成员提示；
- 属性补全（`x.` / `np.`）、类型推断（`ndarray`）、函数签名 Hint、括号/引号自动配对、选区高对比；
- 显示设置对话框、SymPy 文本/数式/全数式、MathML 渲染、NumPy 美观格式、浮点精度（含历史与 DataFrame 表格）、DataFrame 表格、图表结果隐藏、跨刷新偏好恢复；
- 历史 Undo / Redo、编号复用、变量不被撤回；清空当前会话；
- `ans` 保存非 None 结果、None/错误不覆盖、跨刷新恢复；
- 库定义文本解析、别名/模块去重、包→模块 provider 推断、GUI 配置持久化与旧配置迁移；
- 侧栏拖动宽度并跨刷新记住；
- Enter / Ctrl+Enter 两种运行键，真实键盘事件下完整性与 `↑` 历史导航；
- 明暗主题与 Matplotlib 只影响后续图；
- 多个会话的新建/重命名/删除/切换、变量隔离、刷新恢复；重绘历史与扫帚清空按钮；顶栏会话名一行显示与切换菜单；
- 复制 HTML、重建 HTML 后仍能读到会话；
- 314.0.7 与 0.27.8 两种运行时结构、跨版本历史保留；
- PWA 五文件生成、manifest/SW 版本、本地 HTTP 下 SW activated/缓存、断网刷新、`file://` 不注册 SW；SW 不拦截内联 Worker 的 `blob:` 请求。

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
