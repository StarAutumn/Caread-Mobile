// ================================================================
// 批注：选中正文后右键「添加批注」，在被批注文字上方插入文本卡片
// - 零宽锚点（基线对齐）插入选中文字前：margin-top 把所在行基线压低，
//   该行整行内容随基线下移，与上一行之间撑出间隙——被批注行不换行
// - 正文词 span 是 vertical-align: top（释义卡依赖），压低基线时不会跟随，
//   因此撑开期间给该行的词临时加 note-line-shift（切到基线对齐 + inline-flex，
//   flex 基线锁定在词文字上，点词弹出释义卡时基线不会被卡片拽走）保证整行一致
//   （词的行归属在干净布局下一次性测量，避免前一行 margin 生效后测量失准）
// - 同一行可有多个批注：按视觉行分组，间隙只按组内最高卡片撑开一次，
//   各卡片横向并排、顶部对齐，全部落在同一行撑开的间隙里（不遮挡正文）
// - 编辑态：点击卡片以外任意位置或 Ctrl+Enter = 保存并退出编辑，
//   内容空白则不插入批注；展示态右键弹出「编辑 / 删除」菜单
// - 批注按选区起始字符偏移定位，双屏两个 pane 同步
// - 数据随工作区保存（notes: [{ offset, text, w, h, hu, lineTop, len, color }]，
//   h 仅在用户拖拽后记录（hu=true），len = 选中文字长度（字符边框框选范围）
//   color = 卡片左边色条/卡面/字符边框颜色（null = 默认主题蓝））
// ================================================================
// ---------- Quill 自定义格式白名单（须在创建编辑器前注册） ----------
// 默认 font 白名单只有 serif/monospace，自定义字体值全部被拒收（选了不生效）；
// 默认 size 只有 small/large/huge 三档；这里换成中文字体族 + px 细档字号
if (window.Quill) {
    const noteFontAttributor = Quill.import('attributors/class/font');
    noteFontAttributor.whitelist = ['yahei', 'simsun', 'heiti', 'kaiti', 'times'];
    Quill.register(noteFontAttributor, true);

    const noteSizeAttributor = Quill.import('attributors/style/size');
    if (noteSizeAttributor) {
        noteSizeAttributor.whitelist = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];
        Quill.register(noteSizeAttributor, true);
    }
}

let noteAnnotations = [];      // [{ offset, text, w, h, hu, lineTop, len, color }]
let pendingNoteOffset = -1;    // 右键时缓存的选区起始字符偏移
let pendingNoteWidth = null;   // 右键时缓存的选区渲染宽度（新批注卡初始宽度）
let pendingNoteLen = 0;        // 右键时缓存的选中文字长度（字符边框范围）
let pendingNotePane = null;    // 右键时缓存的选区所在 pane（编辑卡固定在该侧）
let noteEditingOffset = null;  // 当前处于编辑态的批注
let noteEditingQuill = null;   // 编辑态 Quill 实例（全局唯一，工具栏挂在顶部工具栏）
let noteEditingPane = null;    // 编辑卡所在的 pane（双屏时只在其中一侧进入编辑态）
let noteCtxPane = null;        // 右键菜单打开时所在 pane（编辑时据此选择编辑侧）

const ctxAddNote = document.getElementById('ctxAddNote');
const noteCtxMenu = document.getElementById('note-ctx-menu');

// 行分组容差与间距常量
const NOTE_LINE_TOL = 6;       // lineTop 判定同一视觉行的容差 px
const NOTE_BASE_PAD = 24;      // 撑开量在最高卡片之外的余量（覆盖文字上伸部分）
const NOTE_TOP_PAD = 4;        // 卡片顶部与上一行之间的间隙 px

// 选区终点全局偏移（与 outline.js 的 selectionStartOffset 同一套索引规则）
function selectionEndOffset(range, index) {
    if (range.endContainer.nodeType === Node.TEXT_NODE) {
        const item = index.list.find(i => i.node === range.endContainer);
        return item ? item.start + range.endOffset : -1;
    }
    const node = range.endContainer.childNodes[range.endOffset];
    if (node) {
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const t = w.nextNode();
        if (t) {
            const item = index.list.find(i => i.node === t);
            return item ? item.start : -1;
        }
    }
    // 元素容器 offset 指到末尾之后：取容器内最后一个文本节点的终点
    if (range.endContainer.nodeType === Node.ELEMENT_NODE) {
        const w = document.createTreeWalker(range.endContainer, NodeFilter.SHOW_TEXT);
        let last = null;
        while (w.nextNode()) last = w.currentNode;
        if (last) {
            const item = index.list.find(i => i.node === last);
            if (item) return item.start + last.length;
        }
    }
    return -1;
}

let noteColorPanels = [];       // 当前编辑会话的三个颜色面板（字色/背景色/卡片颜色）
const notePanelColorState = {}; // 各颜色面板上次使用的颜色状态（运行时记忆）

// 右键时缓存选区起点与长度（与大纲共用 contextmenu 时机，各自独立缓存）
document.addEventListener('contextmenu', () => {
    pendingNoteOffset = -1;
    pendingNoteWidth = null;
    pendingNoteLen = 0;
    pendingNotePane = null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const pane = selectionPane(range);
    if (!pane) return;
    const index = buildTextIndex(pane);
    const s = selectionStartOffset(pane, range, index);
    if (s >= 0) {
        pendingNoteOffset = s;
        pendingNotePane = pane;
        // 选区渲染宽度作为新批注卡的初始宽度（CSS min-width 兜底最小值）
        pendingNoteWidth = Math.round(range.getBoundingClientRect().width);
        // 选中文字长度：字符边框据此框住 offset..offset+len 覆盖的所有词
        const e = selectionEndOffset(range, index);
        pendingNoteLen = e > s ? e - s : 0;
    }
});

// 点击菜单项：在选中区域上方插入编辑卡片
ctxAddNote.addEventListener('pointerdown', (e) => e.preventDefault());
ctxAddNote.addEventListener('click', (e) => {
    e.stopPropagation();
    // 隐藏卡片模式下不新建批注：编辑卡会被隐藏样式吞掉，与点词行为一致给提示
    if (typeof cardsHiddenMode !== 'undefined' && cardsHiddenMode) {
        hideNoteCtxMenu();
        showToast('请切换为显示卡片模式', 'info');
        return;
    }
    if (pendingNoteOffset < 0) return;
    commitNoteEdit();             // 若已有编辑中的批注，先提交，避免丢字
    addNote(pendingNoteOffset, pendingNoteWidth, pendingNoteLen, pendingNotePane);
    pendingNoteOffset = -1;
    pendingNoteWidth = null;
    pendingNoteLen = 0;
    pendingNotePane = null;
});

// 编辑态：点击卡片以外的任意位置 = 保存并退出编辑（空白则不插入批注）。
// 卡片内/顶部工具栏点击已 stopPropagation，不会冒泡到这里；
// 颜色面板的收起由 color-picker.js 的 appColorPanels 统一处理
document.addEventListener('click', () => {
    if (noteEditingOffset != null) commitNoteEdit();
});

// 顶部富文本工具栏不算「卡片外」：点击不触发保存退出
const noteQuillToolbarHost = document.getElementById('note-quill-toolbar');
['click', 'mousedown'].forEach(type => {
    noteQuillToolbarHost.addEventListener(type, (e) => e.stopPropagation());
});

// 定位：offset 所在文本节点（优先词 span），其次文本节点本身。
// 条件必须是「节点终点 > offset」（包含关系）而不是「起点 ≥ offset」：
// 从词中间（第 2/3 个字符）起始的选区要锚到本词左缘——按「下一个节点」
// 会右移一词，选区起于行尾词时更是把卡片挤出正文框右缘
function noteAnchorFor(pane, offset) {
    const index = buildTextIndex(pane);
    let target = null;
    for (const item of index.list) {
        if (offset < item.start + item.node.length) { target = item.node; break; }
    }
    if (!target && index.list.length) target = index.list[index.list.length - 1].node;
    if (!target) return null;
    const wordSpan = target.parentElement ? target.parentElement.closest('.word') : null;
    return wordSpan || target;
}

// 锚点的行位置（干净布局下的视口 top，用于视觉行分组）
function anchorLineTop(anchor) {
    const nr = document.createRange();
    nr.selectNodeContents(anchor);
    return nr.getBoundingClientRect().top;
}

// 清除 pane 内所有批注 DOM、行位移标记与字符边框
function removeNotesIn(pane) {
    pane.querySelectorAll('.note-anchor').forEach(el => el.remove());
    pane.querySelectorAll('.note-card').forEach(el => el.remove());
    pane.querySelectorAll('.note-line-shift').forEach(el => el.classList.remove('note-line-shift'));
    // 虚线框 span 解包：子节点移回原位后删壳（不改文本内容，偏移体系不受影响）
    pane.querySelectorAll('.note-region').forEach(el => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
    });
}

// 构建单个批注的锚点+卡片（top/margin 由分组布局统一排布）
function buildNoteCard(note, editing, pane) {
    const spacer = document.createElement('span');
    spacer.className = 'note-anchor';
    spacer.dataset.offset = note.offset;
    // 卡片颜色（左色条/卡面）：CSS 变量挂在锚点上，卡片继承
    if (note.color) applyNoteColorVars(spacer, note.color);

    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.offset = note.offset;
    card.addEventListener('click', (e) => e.stopPropagation());

    let editor = null;
    if (editing) {
        editor = document.createElement('div');
        editor.className = 'note-editor';
        card.appendChild(editor);
    } else {
        const txt = document.createElement('div');
        txt.className = 'note-text ql-editor';
        txt.innerHTML = noteHtml(note.text);
        card.appendChild(txt);
        // 展示态：右键弹出「编辑 / 删除」菜单；双击直接进入编辑
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showNoteCtxMenu(e.clientX, e.clientY, note, pane);
        });
        card.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (noteEditingOffset === note.offset) return;
            commitNoteEdit();     // 若有其它编辑中的批注，先提交，避免丢字
            noteEditingOffset = note.offset;
            noteEditingPane = pane || container.querySelector('.article-pane');
            renderNotes();
        });
    }

    spacer.appendChild(card);
    return { spacer, card, editor };
}

// 提交编辑：点击卡片外或 Ctrl+Enter 触发——
// 内容空白则不插入批注（删除该条），否则保存文本并退出编辑态
function commitNoteEdit() {
    if (noteEditingOffset == null) return;
    const offset = noteEditingOffset;
    const q = noteEditingQuill;
    noteEditingOffset = null;
    noteEditingQuill = null;
    noteEditingPane = null;
    const note = noteAnnotations.find(n => n.offset === offset);
    if (!note) { renderNotes(); return; }
    // 富文本存 Delta JSON；空白（无可见字符）则不插入/删除该批注
    const val = q ? (q.getText().trim() ? JSON.stringify(q.getContents()) : '') : note.text.trim();
    if (!val) {
        removeNote(offset);   // 内部已 renderNotes + markTabDirty
    } else {
        note.text = val;
        noteAnnotations.forEach(n => { if (n.offset === offset) n.text = val; });
        renderNotes();
        markTabDirty();
    }
}

// ---------- Quill 富文本辅助 ----------
let noteRenderQuill = null;

// 旧批注为纯文本：非 Delta JSON 一律按纯文本处理
function noteTextToDelta(text) {
    if (text) {
        try {
            const d = JSON.parse(text);
            if (d && Array.isArray(d.ops)) return d;
        } catch (e) { /* 纯文本 */ }
    }
    return { ops: text ? [{ insert: text }] : [] };
}

function plainToHtml(t) {
    const div = document.createElement('div');
    div.textContent = t;
    return div.innerHTML.replace(/\n/g, '<br>');
}

// Delta → HTML：复用离屏 Quill 实例渲染，供展示卡 innerHTML 使用
function noteDeltaToHtml(delta) {
    if (!delta.ops.length) return '';
    if (!window.Quill) return plainToHtml(delta.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join(''));
    if (!noteRenderQuill) {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;';
        document.body.appendChild(holder);
        noteRenderQuill = new Quill(holder, { theme: 'snow', modules: { toolbar: false } });
    }
    noteRenderQuill.setContents(delta, 'silent');
    return noteRenderQuill.root.innerHTML;
}

function noteHtml(text) {
    if (!text) return '';
    try {
        const d = JSON.parse(text);
        if (d && Array.isArray(d.ops)) return noteDeltaToHtml(d);
    } catch (e) { /* 纯文本 */ }
    return plainToHtml(text);
}

// 顶部工具栏切换：编辑态显示 Quill 工具栏并隐藏原工具栏，退出即恢复
function showNoteQuillToolbar() {
    document.getElementById('top-toolbar').classList.add('note-editing');
}

function hideNoteQuillToolbar() {
    document.getElementById('top-toolbar').classList.remove('note-editing');
    noteQuillToolbarHost.innerHTML = '';   // 清掉上次的工具栏 UI，下次重建
}

// 颜色加深：各通道乘以系数（0~1），用于从所选颜色派生卡面底色/边框
function darkenHex(hex, f) {
    const { r, g, b } = hexToRgb(hex);
    return '#' + [r, g, b].map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
}

// 把所选颜色派生成一组卡片变量：--note-color（左色条/大括号原色）、
// --note-face（卡面底色，比所选颜色暗一些）、--note-face-border（深边框）、
// --note-face-text（深底浅字，保证可读）
function applyNoteColorVars(sp, color) {
    sp.style.setProperty('--note-color', color);
    sp.style.setProperty('--note-face', darkenHex(color, 0.62));
    sp.style.setProperty('--note-face-border', darkenHex(color, 0.42));
    sp.style.setProperty('--note-face-text', '#f8fafc');
}

// 批注卡片颜色：卡片左侧色条 + 下方大括号 + 卡面底色（CSS 变量挂在锚点上，
// 卡片与括号都从变量取色；清空则回退默认米黄卡片）
function applyNoteColor(note) {
    container.querySelectorAll(`.note-anchor[data-offset="${note.offset}"]`).forEach(sp => {
        if (note.color) applyNoteColorVars(sp, note.color);
        else ['--note-color', '--note-face', '--note-face-border', '--note-face-text']
            .forEach(v => sp.style.removeProperty(v));
    });
}

// 应用/清除卡片颜色：同步锚点变量（卡片左色条+大括号），并记改
function setNoteColor(note, color) {
    note.color = color || null;
    applyNoteColor(note);
    markTabDirty();
}

// 展开/收起某个颜色面板（同组互斥）；菜单在按钮定位壳内，天然对齐按钮下方，
// 靠近窗口右缘时改为右对齐，避免面板溢出窗口
function toggleNoteColorPanel(sel) {
    const btn = noteQuillToolbarHost.querySelector(sel);
    const panel = noteColorPanels.find(p => p.group === btn);
    if (!panel) return;
    const show = !panel.menu.classList.contains('show');
    noteColorPanels.forEach(p => p.close());
    if (show) {
        panel.menu.classList.add('show');
        const r = btn.getBoundingClientRect();
        const w = panel.menu.offsetWidth || 272;
        if (r.right + w > window.innerWidth - 8) {
            panel.menu.style.left = 'auto';
            panel.menu.style.right = '0px';
        } else {
            panel.menu.style.left = '0px';
            panel.menu.style.right = 'auto';
        }
    }
}

// 在卡片内创建 Quill 编辑器；生成的工具栏移入顶部工具栏挂载点
function createNoteQuill(el, note) {
    const q = new Quill(el, {
        theme: 'snow',
        placeholder: '输入批注内容…（点击卡片外或 Ctrl+Enter 保存）',
        modules: {
            toolbar: {
                container: [
                    [{ font: [false, 'yahei', 'simsun', 'heiti', 'kaiti', 'times'] },
                     { size: [false, '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'] }],
                    ['bold', 'italic', 'underline'],
                    ['color', 'background'],
                    [{ script: 'sub' }, { script: 'super' }],
                    ['notecolor']
                ],
                // 字色/背景色/卡片颜色三处都换成本应用同款选色面板（createAppColorPanel），
                // Quill 内置下拉是纯色板网格且无透明度，故只留按钮、由 handler 开关面板
                handlers: {
                    color() { toggleNoteColorPanel('button.ql-color'); },
                    background() { toggleNoteColorPanel('button.ql-background'); },
                    notecolor() { toggleNoteColorPanel('button.ql-notecolor'); }
                }
            },
            keyboard: {
                bindings: {
                    noteCommit: {
                        key: 'Enter', shortKey: true,
                        handler: () => { commitNoteEdit(); return false; }
                    }
                }
            }
        }
    });
    const tb = el.previousElementSibling;
    if (tb && tb.classList.contains('ql-toolbar')) noteQuillToolbarHost.appendChild(tb);
    // 三个颜色按钮统一填充为同款选色面板（复用荧光笔/画笔面板交互与样式）
    // notePanelColorState 记住上次颜色，notecolor 以批注已存颜色初始化
    [['color', '选择字色'], ['background', '选择背景色'], ['notecolor', '选择卡片颜色']].forEach(([key, title]) => {
        const btn = noteQuillToolbarHost.querySelector(`button.ql-${key}`);
        if (!btn) return;
        const isNote = key === 'notecolor';
        const last = notePanelColorState[key];
        const panel = createAppColorPanel({
            btn,
            title,
            showAlpha: false,   // 富文本工具栏的面板不带透明度滑条
            defaultHsv: last ? last.hsv
                : (isNote ? { h: 210, s: 0.85, v: 0.95 }
                    : (key === 'color' ? { h: 215, s: 0.85, v: 0.45 } : { h: 51, s: 0.96, v: 1 })),
            defaultAlpha: 1,
            initHex: isNote ? note.color : (last ? last.hex : null),
            onChange: (color, hexStr) => {
                notePanelColorState[key] = { hsv: { ...panel.st.hsv }, hex: hexStr };
                if (isNote) setNoteColor(note, hexStr);
                else q.format(key, color);
            }
        });
        noteColorPanels.push(panel);
    });
    q.setContents(noteTextToDelta(note.text), 'silent');
    // 双屏另一侧的展示卡实时跟随编辑内容
    q.on('text-change', () => {
        const html = noteDeltaToHtml(q.getContents());
        container.querySelectorAll(`.note-card[data-offset="${note.offset}"] .note-text`)
            .forEach(t => { t.innerHTML = html; });
    });
    return q;
}

function removeNote(offset) {
    noteAnnotations = noteAnnotations.filter(n => n.offset !== offset);
    if (noteEditingOffset === offset) noteEditingOffset = null;
    renderNotes();
    markTabDirty();
}

function addNote(offset, width = null, len = 0, pane = null) {
    let note = noteAnnotations.find(n => n.offset === offset);
    if (!note) {
        // 新批注初始宽度 = 选中文字的渲染宽度（CSS min-width 兜底最小值）；
        // len = 选中文字长度，字符边框据此框住覆盖的所有词
        note = { offset, text: '', w: width, h: null, hu: false, lineTop: null,
                 len: len || 0 };
        noteAnnotations.push(note);
        noteAnnotations.sort((a, b) => a.offset - b.offset);
    } else {
        if (note.w == null && width != null) note.w = width;
        // 老批注缺长度数据时用本次选区补齐
        if (!note.len && len) note.len = len;
    }
    noteEditingOffset = note.offset;
    noteEditingPane = pane || container.querySelector('.article-pane');
    renderNotes();
    markTabDirty();
}

// 全量渲染：按视觉行分组排布所有批注（单屏/双屏每个 pane 各一套）
// 渲染后统一同步顶部工具栏：编辑态 = Quill 工具栏，否则恢复原工具栏
function renderNotes() {
    renderNotesInner();
    if (noteEditingQuill) showNoteQuillToolbar();
    else hideNoteQuillToolbar();
}

function renderNotesInner() {
    const panes = [...container.querySelectorAll('.article-pane')];
    panes.forEach(pane => {
        removeNotesIn(pane);
        if (!noteAnnotations.length) return;
        const paneContentEl = pane.querySelector('.pane-content') || pane;   // 内容层（正文框）

        // 0) Word 式连续虚线边框：把批注选区覆盖到的词（含词间空格）包进一个
        //    inline 虚线框 span——跨行时 border 按行分片连续绘制，贴合字符零偏移
        const idx = buildTextIndex(pane);
        noteAnnotations.forEach(note => {
            if (!note.len) return;                 // 老数据无长度，画不了框
            const end = note.offset + note.len;
            // 收集选区覆盖到的词（按文档顺序去重）
            const words = [];
            idx.list.forEach(({ node, start }) => {
                const stop = start + node.length;
                if (stop <= note.offset || start >= end) return;
                const w = node.parentElement ? node.parentElement.closest('.word') : null;
                if (w && !words.includes(w)) words.push(w);
            });
            if (!words.length) return;
            // 包裹：首词到末词之间的全部节点（词+空格文本）移入虚线框 span，
            // 只移动元素不改文本内容，字符偏移体系不受影响
            const wrap = document.createElement('span');
            wrap.className = 'note-region';
            if (note.color) wrap.style.borderColor = note.color;
            const parent = words[0].parentNode;
            parent.insertBefore(wrap, words[0]);
            let n = words[0];
            while (n) {
                const next = n.nextSibling;
                wrap.appendChild(n);
                if (n === words[words.length - 1]) break;
                n = next;
            }
        });

        // 1) 干净布局下测量各批注锚点的行位置
        const items = [];
        noteAnnotations.forEach(note => {
            const anchor = noteAnchorFor(pane, note.offset);
            if (!anchor) return;
            items.push({
                note, anchor,
                lineTop: anchorLineTop(anchor),
                editing: noteEditingOffset === note.offset && pane === noteEditingPane
            });
        });
        if (!items.length) return;

        // 2) 按行分组（lineTop 相近视为同一视觉行），组内按偏移排序
        const groups = [];
        items.forEach(it => {
            const g = groups.find(g => Math.abs(g.lineTop - it.lineTop) <= NOTE_LINE_TOL);
            if (g) g.items.push(it);
            else groups.push({ lineTop: it.lineTop, items: [it] });
        });

        // 3) 干净布局下一次性记录每个词的行归属（后续 margin 会推移下方各行，
        //    到时再测 rect.top 就对不上组了）
        const wordTops = [...pane.querySelectorAll('.word')].map(w => ({
            w, top: w.getBoundingClientRect().top
        }));

        // 4) 逐组渲染：锚点压低该行基线（整行下移），卡片在行上方间隙内堆叠
        groups.forEach(g => {
            g.items.sort((a, b) => a.note.offset - b.note.offset);
            // 该行所有词切到基线对齐：跟随基线压低整行下移（词默认 top 对齐不响应）
            wordTops.forEach(({ w, top }) => {
                if (Math.abs(top - g.lineTop) <= NOTE_LINE_TOL) {
                    w.classList.add('note-line-shift');
                }
            });
            let maxH = 0;
            const spacers = [];
            g.items.forEach(it => {
                const { spacer, card, editor } = buildNoteCard(it.note, it.editing, pane);
                // 高度只回放用户拖拽设定值（hu）：编辑态/默认高度不回写，
                // 展示卡随内容 + CSS min-height（≈原默认的 2/3），不再被编辑态高度撑出留白
                if (!it.editing && it.note.hu && it.note.h != null) card.style.height = it.note.h + 'px';
                it.anchor.parentNode.insertBefore(spacer, it.anchor);
                // 行首锚点修正：选区起于某视觉行第一个字符时，前插的零宽
                // spacer 会被上一行行尾「收留」（宽 0 在哪都放得下），间隙与
                // 卡片都会错到上一行右端。实测与锚词不同行 → 移到锚词之后
                // （必定仍在本行），卡片 left 反向偏移到词左缘，视觉仍正对选区
                const z = (typeof currentZoom === 'number' && currentZoom > 0) ? currentZoom : 1;
                let sr = spacer.getBoundingClientRect();
                const wr = it.anchor.getBoundingClientRect();
                let baseLeft = 0;
                if (Math.abs(sr.top - wr.top) > NOTE_LINE_TOL) {
                    it.anchor.parentNode.insertBefore(spacer, it.anchor.nextSibling);
                    sr = spacer.getBoundingClientRect();
                    baseLeft = (wr.left - sr.left) / z;   // ≈ 负的锚词宽（内容坐标）
                }
                // 卡片不超出正文框右缘：可用宽度 = 内容层右缘 − 卡片左缘
                // （gBCR 差值÷currentZoom 换算内容坐标），多行选区的初始宽度
                // （跨行横向跨度）在此收窄；最小不低于 min-width。
                // 行尾附近放不下时整体左移，右缘收进正文框，左移不越过框左缘
                if (it.note.w != null) {
                    const pr = paneContentEl.getBoundingClientRect();
                    const cardLeft = Math.max((sr.left - pr.left) / z + baseLeft, 0);
                    const avail = (pr.right - pr.left) / z - 6 - cardLeft;
                    const w = Math.min(it.note.w, Math.max(avail, 160));
                    card.style.width = w + 'px';
                    let left = baseLeft;
                    if (w > avail) left -= Math.min(w - avail, cardLeft);
                    card.style.left = left + 'px';
                } else {
                    card.style.left = baseLeft + 'px';
                }
                // 初始化 Quill（需已在 DOM），生成的工具栏移到顶部工具栏挂载点
                if (it.editing && editor && window.Quill) {
                    noteEditingQuill = createNoteQuill(editor, it.note);
                    noteEditingQuill.focus();
                    noteEditingQuill.setSelection(noteEditingQuill.getLength());
                }
                const h = card.offsetHeight;
                card._expH = h;   // 期望高度：RO 回调里区分「程序设定」与「用户拖拽」
                spacers.push({ spacer, card, h });
                maxH = Math.max(maxH, h);
                it.note.lineTop = g.lineTop;
                // 拖拽/输入导致尺寸变化：仅重排本行，撑开的间隙跟随卡片高度
                // （展示态也生效：拖拽调高后与上一行的间距同步变化，并记录新尺寸）
                if (window.ResizeObserver) {
                    const ro = new ResizeObserver(() => layoutNoteRow(pane, g.lineTop));
                    ro.observe(card);
                }
            });
            // 组内所有锚点统一 margin：把该行基线压低，行上方撑出一行高的间隙
            // （间隙高度只按组内最高的卡片算，各卡片横向并排，不逐张叠加）
            const total = maxH + NOTE_BASE_PAD;
            spacers.forEach(({ spacer }) => {
                spacer.style.marginTop = total + 'px';
            });
            // margin 生效后再排卡片：底部对齐（矮卡片贴着文字行，不悬空），
            // 高卡片向上生长撑开间隙，各自待在自己的锚点 x 上；
            // 虚线框的位置在插入 spacer 时已按选区定格，不随卡片布局变化
            spacers.forEach(({ card, h }) => {
                card.style.top = (NOTE_TOP_PAD - total) + (maxH - h) + 'px';
            });
        });
    });
}

// 行内批注尺寸变化后的轻量重排：只更新本行各卡片 top 与锚点 margin（不重建 DOM）
function layoutNoteRow(pane, lineTop) {
    const entries = [];
    pane.querySelectorAll('.note-anchor').forEach(sp => {
        const n = noteAnnotations.find(x => x.offset === Number(sp.dataset.offset));
        if (n && n.lineTop != null && Math.abs(n.lineTop - lineTop) <= NOTE_LINE_TOL) {
            entries.push({ sp, n, card: sp.querySelector('.note-card') });
        }
    });
    if (!entries.length) return;
    entries.sort((a, b) => a.n.offset - b.n.offset);
    let maxH = 0;
    entries.forEach(({ n, card }) => {
        if (!card) return;
        n.w = card.offsetWidth;
        const h = card.offsetHeight;
        // 高度只在用户拖拽（实测 ≠ 程序设定值 _expH）时记录：避免把编辑态/默认高度
        // 回写成固定值，导致展示卡永远带着旧高度出现大片留白
        if (card._expH === undefined || Math.abs(h - card._expH) > 0.5) {
            n.h = h;
            n.hu = true;
        }
        card._expH = h;
        maxH = Math.max(maxH, h);
    });
    // 与 renderNotes 一致：margin 撑出一行高的间隙，卡片底部对齐（矮卡贴文字行不悬空）
    const total = maxH + NOTE_BASE_PAD;
    entries.forEach(({ sp }) => {
        sp.style.marginTop = total + 'px';
    });
    entries.forEach(({ card }) => {
        if (!card) return;
        const h = card.offsetHeight;
        card.style.top = (NOTE_TOP_PAD - total) + (maxH - h) + 'px';
    });
}

// 渲染后恢复入口（renderContent / restoreWorkspace 调用）
function restoreNoteCards() {
    renderNotes();
}

// 工作区数据 → 批注状态
function setNoteAnnotations(list) {
    noteAnnotations = (list || []).slice();
    noteEditingOffset = null;
    noteEditingQuill = null;
    noteEditingPane = null;
}

// ---------- 批注卡右键菜单（编辑 / 删除） ----------
function showNoteCtxMenu(x, y, note, pane) {
    noteCtxPane = pane || null;
    noteCtxMenu.dataset.offset = note.offset;
    const left = Math.min(x, window.innerWidth - 130);
    const top = Math.min(y, window.innerHeight - 90);
    noteCtxMenu.style.left = left + 'px';
    noteCtxMenu.style.top = top + 'px';
    noteCtxMenu.classList.remove('hidden');
}

function hideNoteCtxMenu() {
    noteCtxMenu.classList.add('hidden');
}

noteCtxMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.note-ctx-item');
    if (!item) return;
    e.stopPropagation();
    hideNoteCtxMenu();
    const offset = parseInt(noteCtxMenu.dataset.offset, 10);
    const note = noteAnnotations.find(n => n.offset === offset);
    if (!note) return;
    if (item.dataset.action === 'edit') {
        commitNoteEdit();         // 若已有编辑中的批注，先提交，避免丢字
        noteEditingOffset = note.offset;
        noteEditingPane = noteCtxPane || container.querySelector('.article-pane');
        renderNotes();
    } else if (item.dataset.action === 'delete') {
        commitNoteEdit();         // 同上：先提交其它编辑中的批注
        removeNote(offset);
    }
});

// 点击其它位置 / 右键其它位置 / Esc 关闭菜单
document.addEventListener('click', (e) => {
    if (!noteCtxMenu.contains(e.target)) hideNoteCtxMenu();
});
document.addEventListener('contextmenu', () => hideNoteCtxMenu());
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideNoteCtxMenu();
});
