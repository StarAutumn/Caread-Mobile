// ================================================================
// 大纲功能：
// - 右侧可折叠大纲栏，显示多级编号大纲（1 / 1.1 / 1.1.1）
// - 选中正文后右键 →「添加到大纲」→ 选择级别
// - 点击大纲项定位并闪烁；hover 可删除
// - 依赖 main.js 的 buildSaveData / restoreWorkspace（运行时调用）
// ================================================================
let currentOutline = [];   // [{ id, text, level, offset }] 按文档顺序
let outlineExpanded = false;
let outlineSeq = 0;

const outlineBar = document.getElementById('outline-bar');
const outlineToggle = document.getElementById('outlineToggle');
const outlineList = document.getElementById('outlineList');
const outlineSearchInput = document.getElementById('outlineSearchInput');
const contextMenu = document.getElementById('context-menu');
const ctxAddOutline = document.getElementById('ctxAddOutline');

// 多级编号：一级 1、二级 1.1、三级 1.1.1（进入下级自动递增，上级重置子级计数）
function computeOutlineNumbers(list) {
    const c = { 1: 0, 2: 0, 3: 0 };
    list.forEach(item => {
        if (item.level === 1) {
            c[1]++; c[2] = 0; c[3] = 0;
            item.num = String(c[1]);
        } else if (item.level === 2) {
            c[2] = c[2] === 0 ? 1 : c[2] + 1; c[3] = 0;
            item.num = `${c[1] || 1}.${c[2]}`;
        } else {
            c[3] = c[3] === 0 ? 1 : c[3] + 1;
            item.num = `${c[1] || 1}.${c[2] || 1}.${c[3]}`;
        }
    });
}

// 渲染大纲列表（有搜索词时按「编号+文字」过滤）
function renderOutlineBar() {
    computeOutlineNumbers(currentOutline);
    const q = (outlineSearchInput.value || '').trim().toLowerCase();
    const list = q
        ? currentOutline.filter(i => (i.num + ' ' + i.text).toLowerCase().includes(q))
        : currentOutline;
    outlineList.innerHTML = '';
    if (!currentOutline.length) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = '选中正文后右键「添加到大纲」';
        outlineList.appendChild(empty);
        return;
    }
    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = '无匹配的大纲项';
        outlineList.appendChild(empty);
        return;
    }
    list.forEach(item => {
        const el = document.createElement('div');
        el.className = 'outline-item lv' + item.level;
        el.title = item.num + ' ' + item.text;

        const num = document.createElement('span');
        num.className = 'outline-num';
        num.textContent = item.num;

        const txt = document.createElement('span');
        txt.className = 'outline-text';
        txt.textContent = item.text;

        const del = document.createElement('span');
        del.className = 'outline-del';
        del.textContent = '×';
        del.title = '删除';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            currentOutline = currentOutline.filter(x => x.id !== item.id);
            markTabDirty();
            renderOutlineBar();
        });

        // 点击定位到正文位置并闪烁
        el.addEventListener('click', () => {
            locateAndFlash(item.offset, item.offset + Math.max(1, item.text.length));
        });

        el.appendChild(num);
        el.appendChild(txt);
        el.appendChild(del);
        outlineList.appendChild(el);
    });
}

// 切换/恢复标签时设置大纲（清空搜索词，避免上个标签的过滤残留）
function setOutline(list) {
    currentOutline = (list || []).slice();
    if (outlineSearchInput) outlineSearchInput.value = '';
    renderOutlineBar();
}

// 搜索框输入即过滤
outlineSearchInput.addEventListener('input', renderOutlineBar);

// 展开 / 折叠大纲栏
outlineToggle.addEventListener('click', () => {
    outlineExpanded = !outlineExpanded;
    outlineBar.classList.toggle('expanded', outlineExpanded);
    outlineToggle.textContent = outlineExpanded ? '▶' : '◀';
});

// ---------- 正文右键菜单 ----------
// 右键时缓存的选区信息（点击菜单项时选区可能已被清除，需用缓存）
let pendingOutline = null;

container.addEventListener('contextmenu', (e) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    // 未选中内容时使用浏览器默认右键菜单
    if (!text.trim()) {
        pendingOutline = null;
        return;
    }
    e.preventDefault();

    // 立即缓存选区数据（文本 + 起始偏移），后续点击菜单项时不再依赖选区
    pendingOutline = null;
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const pane = selectionPane(range);
        if (pane) {
            const index = buildTextIndex(pane);
            const s = selectionStartOffset(pane, range, index);
            if (s >= 0) {
                pendingOutline = {
                    s,
                    text: text.replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名大纲'
                };
            }
        }
    }

    // 防止超出窗口
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 130);
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
});

// 点击级别项：把缓存的选区添加为对应级别的大纲
contextMenu.querySelectorAll('.ctx-item[data-level]').forEach(item => {
    // 阻止 mousedown 默认行为，避免点击菜单时清除正文选区
    item.addEventListener('pointerdown', (e) => e.preventDefault());
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        addOutlineFromSelection(parseInt(item.dataset.level, 10));
        contextMenu.classList.add('hidden');
    });
});

// 点击其它位置 / Esc 关闭右键菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) {
        contextMenu.classList.add('hidden');
    }
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') contextMenu.classList.add('hidden');
});

// 选区起点对应的全局字符偏移
function selectionStartOffset(pane, range, index) {
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const item = index.list.find(i => i.node === range.startContainer);
        return item ? item.start + range.startOffset : -1;
    }
    // 元素容器：取 offset 指向的子节点中第一个文本节点
    const node = range.startContainer.childNodes[range.startOffset];
    if (node) {
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const t = w.nextNode();
        if (t) {
            const item = index.list.find(i => i.node === t);
            return item ? item.start : -1;
        }
    }
    return -1;
}

// 把缓存的选区添加为指定级别的大纲项
function addOutlineFromSelection(level) {
    if (!pendingOutline) return;

    currentOutline.push({
        id: 'ol-' + (++outlineSeq),
        text: pendingOutline.text,
        level,
        offset: pendingOutline.s
    });
    pendingOutline = null;
    // 保持文档顺序（编号按顺序计算）
    currentOutline.sort((a, b) => a.offset - b.offset);
    markTabDirty();
    // 大纲栏处于折叠状态时自动展开，让用户看到新添加的大纲
    if (!outlineExpanded) {
        outlineExpanded = true;
        outlineBar.classList.add('expanded');
        outlineToggle.textContent = '▶';
    }
    renderOutlineBar();
}
