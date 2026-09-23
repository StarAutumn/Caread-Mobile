// ---------- 颜色选择（荧光笔） ----------
// 荧光笔当前颜色（highlightSelection / recolorSelectedRuns 使用）
let highlighterColor = 'rgba(255, 214, 10, 1)';

// 20 种常用颜色
const hlPresetColors = [
    '#ff0000', '#ff7f00', '#ffd60a', '#b5e135', '#00c853',
    '#00bcd4', '#2196f3', '#3f51b5', '#9c27b0', '#ff69b4',
    '#ff007f', '#8d6e63', '#212121', '#616161', '#9e9e9e',
    '#ffffff', '#fff59d', '#81d4fa', '#a5d6a7', '#f48fb1',
];

// ---------- 颜色转换 ----------
function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function rgbToHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 360;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ---------- 颜色面板（每个面板独立状态） ----------
const colorPanels = [];

// 收集某个面板全部元素并初始化独立状态
function initColorPanel(prefix, defaultHsv, defaultAlpha) {
    const el = id => document.getElementById(prefix + id);
    const panel = {
        prefix,
        group: el('ColorGroup'),
        btn: el('ColorBtn'),
        swatch: el('ColorSwatch'),
        menu: el('ColorMenu'),
        presets: el('Presets'),
        sv: el('Sv'),
        svMarker: el('SvMarker'),
        hue: el('Hue'),
        hueMarker: el('HueMarker'),
        hex: el('Hex'),
        alphaRange: el('AlphaRange'),
        alphaVal: el('AlphaVal'),
        state: {
            hsv: { ...defaultHsv },
            alpha: defaultAlpha
        }
    };
    colorPanels.push(panel);
    return panel;
}

// 恢复颜色状态期间抑制 markTabDirty（切换/创建标签时的程序性更新不算修改）
let restoringColors = false;

// 应用某个面板的颜色状态到该面板 UI，并更新对应工具的全局颜色
function applyColorState(panel) {
    const st = panel.state;
    const rgb = hsvToRgb(st.hsv.h, st.hsv.s, st.hsv.v);
    const hex = rgbToHex(rgb);
    const color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${st.alpha})`;

    if (panel.prefix === 'hl') {
        highlighterColor = color;
    } else if (panel.prefix === 'pen') {
        penColor = color;
    }

    const hexText = st.alpha >= 1
        ? hex.toUpperCase()
        : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(st.alpha * 100) / 100})`;

    // 色块按钮：棋盘格底 + 当前色（透明时透过棋盘格显示）
    panel.swatch.style.backgroundColor = color;
    panel.hex.textContent = hexText;
    // 透明度滑条背景：随当前颜色，从全透明渐变到不透明
    panel.alphaRange.style.background =
        `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1))`;
    panel.alphaVal.textContent = Math.round(st.alpha * 100) + '%';
    // 滑条位置同步（恢复保存的状态时滑块也要跟着动，否则停在 HTML 初始值 100）
    panel.alphaRange.value = Math.round(st.alpha * 100);
    // SV 区域背景随当前色相变化
    panel.sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${Math.round(st.hsv.h)}, 100%, 50%))`;
    panel.svMarker.style.left = (st.hsv.s * 100) + '%';
    panel.svMarker.style.top = ((1 - st.hsv.v) * 100) + '%';
    panel.hueMarker.style.left = (st.hsv.h / 360 * 100) + '%';
    panel.presets.querySelectorAll('.hl-preset').forEach(o => {
        o.classList.toggle('active',
            o.dataset.color.toLowerCase() === hex.toLowerCase());
    });

    // 荧光笔面板改色时，若当前有选区触及荧光笔迹则实时改色（画笔面板不影响）
    if (panel.prefix === 'hl') {
        recolorSelectedRuns();
    }
    // 颜色变化属于工作区修改（恢复颜色状态期间除外），并同步全局偏好
    if (!restoringColors) {
        markTabDirty();
        saveColorPrefs();
    }
}

// 对「选中区域里已有的荧光笔迹」应用荧光笔当前颜色
function recolorSelectedRuns() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const pane = selectionPane(range);
    if (!pane) return;

    // 先收集与选区相交的荧光笔容器（无则提前返回，避免全量文本索引开销）
    const touchedRuns = [];
    pane.querySelectorAll('.hl-run').forEach(run => {
        if (range.intersectsNode(run)) touchedRuns.push(run);
    });
    if (!touchedRuns.length) return;

    // 有需要改色的笔迹时才做全量文本索引，并同步改色
    const index = buildTextIndex(pane);
    const touchedRanges = [];
    touchedRuns.forEach(run => {
        run.style.background = highlighterColor;
        const inner = [];
        const w = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) inner.push(w.currentNode);
        if (!inner.length) return;
        const s = indexStart(inner[0], index);
        const e = indexStart(inner[inner.length - 1], index) + inner[inner.length - 1].length;
        if (s >= 0 && e >= 0) touchedRanges.push({ s, e });
    });

    // 双屏同步：按字符偏移在另一个 pane 找到对应荧光笔改色
    if (dualMode) {
        const other = otherPaneOf(pane);
        if (other) {
            const oIndex = buildTextIndex(other);
            touchedRanges.forEach(({ s, e }) => {
                const oRun = findRunByOffsets(other, oIndex, s, e);
                if (oRun) oRun.style.background = highlighterColor;
            });
        }
    }
}

// 初始化单个面板的交互（操作该面板自己的状态）
function setupColorPanel(panel) {
    const st = panel.state;

    // SV 区域：横轴饱和度、纵轴亮度
    function svFromEvent(e) {
        const rect = panel.sv.getBoundingClientRect();
        st.hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        st.hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
        applyColorState(panel);
    }

    // Hue 条：色相
    function hueFromEvent(e) {
        const rect = panel.hue.getBoundingClientRect();
        st.hsv.h = Math.max(0, Math.min(360, (e.clientX - rect.left) / rect.width * 360));
        applyColorState(panel);
    }

    panel.sv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        panel.sv.setPointerCapture(e.pointerId);
        svFromEvent(e);
    });
    panel.sv.addEventListener('pointermove', (e) => {
        if (e.buttons & 1) svFromEvent(e);
    });
    panel.hue.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        panel.hue.setPointerCapture(e.pointerId);
        hueFromEvent(e);
    });
    panel.hue.addEventListener('pointermove', (e) => {
        if (e.buttons & 1) hueFromEvent(e);
    });

    // 透明度滑动条
    panel.alphaRange.addEventListener('input', () => {
        st.alpha = parseInt(panel.alphaRange.value, 10) / 100;
        applyColorState(panel);
    });

    // 生成 20 个常用色板
    hlPresetColors.forEach(hex => {
        const p = document.createElement('div');
        p.className = 'hl-preset';
        p.style.background = hex;
        p.dataset.color = hex;
        p.title = hex;
        // pointerdown 阻止默认行为，避免清除正文选区
        p.addEventListener('pointerdown', (e) => e.preventDefault());
        p.addEventListener('click', (e) => {
            e.stopPropagation();
            st.hsv = rgbToHsv(hexToRgb(hex));
            applyColorState(panel);
            panel.menu.classList.remove('show');
        });
        panel.presets.appendChild(p);
    });

    // 点击箭头按钮展开/收起颜色菜单（同时关闭另一个菜单）
    panel.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        colorPanels.forEach(p => {
            if (p !== panel) p.menu.classList.remove('show');
        });
        panel.menu.classList.toggle('show');
    });
}

// 初始化荧光笔颜色面板
initColorPanel('hl', { h: 51, s: 0.96, v: 1 }, 1);
// 初始化画笔颜色面板
initColorPanel('pen', { h: 210, s: 0.85, v: 0.95 }, 1);
// 先绑定交互事件
colorPanels.forEach(setupColorPanel);

// ---------- 工具偏好全局记忆（localStorage，机制同深浅色模式） ----------
const TOOL_PREFS_KEY = 'toolPrefs';

// 读取 localStorage 中的工具偏好（无 / 损坏时返回空对象）
function readToolPrefs() {
    try {
        return JSON.parse(localStorage.getItem(TOOL_PREFS_KEY) || '{}') || {};
    } catch (e) {
        return {};
    }
}

// 把颜色面板的当前状态合并写入 localStorage
function saveColorPrefs() {
    try {
        const prefs = readToolPrefs();
        colorPanels.forEach(panel => {
            prefs[panel.prefix] = {
                hsv: { ...panel.state.hsv },
                alpha: panel.state.alpha
            };
        });
        localStorage.setItem(TOOL_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
}

// 启动时应用默认色并从 localStorage 恢复上次偏好（程序性更新，不标记修改）
(function initColorPrefs() {
    restoringColors = true;
    try {
        const prefs = readToolPrefs();
        colorPanels.forEach(panel => {
            const st = prefs[panel.prefix];
            if (st && st.hsv) {
                panel.state.hsv = { ...st.hsv };
                if (typeof st.alpha === 'number') panel.state.alpha = st.alpha;
            }
        });
        colorPanels.forEach(applyColorState);
    } finally {
        restoringColors = false;
    }
})();

// 点击页面其他位置关闭所有颜色菜单
document.addEventListener('click', (e) => {
    const inAnyPanel = colorPanels.some(panel => panel.group.contains(e.target));
    if (!inAnyPanel) {
        colorPanels.forEach(panel => panel.menu.classList.remove('show'));
    }
    // 批注富文本工具栏的颜色面板：点击工具栏以外区域时收起
    appColorPanels.forEach(p => {
        if (!p.group.contains(e.target)) p.menu.classList.remove('show');
    });
});

// ---------- 通用颜色面板工厂（批注富文本工具栏：与荧光笔/画笔面板同款交互） ----------
// 复用 .hl-* 样式与 hlPresetColors；onChange(color, hexStr) 在颜色变化时实时回调
// （初始化时静默，不上报）。btn 为工具栏已有的 Quill 按钮，面板菜单作为其兄弟
// 节点插入同一分组，展开时由调用方把菜单左缘对齐按钮
const appColorPanels = [];

function createAppColorPanel({ btn, title, defaultHsv, defaultAlpha, initHex, onChange, showAlpha = true }) {
    // 定位壳：菜单严格锚定按钮正下方，不依赖任何祖先元素的定位方式
    const shell = document.createElement('span');
    shell.className = 'note-color-shell';
    btn.parentNode.insertBefore(shell, btn);
    shell.appendChild(btn);

    btn.classList.add('hl-color-btn');
    btn.title = title;
    btn.innerHTML = '';
    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▼';
    btn.appendChild(swatch);
    btn.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'hl-color-menu';
    const t1 = document.createElement('div');
    t1.className = 'hl-menu-title';
    t1.textContent = '常用颜色';
    const presets = document.createElement('div');
    presets.className = 'hl-presets';
    const t2 = document.createElement('div');
    t2.className = 'hl-menu-title';
    t2.textContent = '色盘';
    const sv = document.createElement('div');
    sv.className = 'hl-sv';
    const svMarker = document.createElement('div');
    svMarker.className = 'hl-marker';
    sv.appendChild(svMarker);
    const hue = document.createElement('div');
    hue.className = 'hl-hue';
    const hueMarker = document.createElement('div');
    hueMarker.className = 'hl-marker';
    hue.appendChild(hueMarker);
    const hexEl = document.createElement('div');
    hexEl.className = 'hl-hex';
    let alphaRow = null;
    let alphaRange = null;
    let alphaVal = null;
    if (showAlpha) {
        alphaRow = document.createElement('div');
        alphaRow.className = 'hl-alpha-row';
        const alphaLabel = document.createElement('span');
        alphaLabel.className = 'hl-alpha-label';
        alphaLabel.textContent = '透明';
        alphaRange = document.createElement('input');
        alphaRange.type = 'range';
        alphaRange.className = 'hl-alpha-range';
        alphaRange.min = 0;
        alphaRange.max = 100;
        alphaRange.value = 100;
        alphaVal = document.createElement('span');
        alphaVal.className = 'hl-alpha-val';
        alphaVal.textContent = '100%';
        alphaRow.appendChild(alphaLabel);
        alphaRow.appendChild(alphaRange);
        alphaRow.appendChild(alphaVal);
    }
    menu.appendChild(t1);
    menu.appendChild(presets);
    menu.appendChild(t2);
    menu.appendChild(sv);
    menu.appendChild(hue);
    menu.appendChild(hexEl);
    if (alphaRow) menu.appendChild(alphaRow);
    shell.appendChild(menu);

    const st = {
        hsv: initHex ? rgbToHsv(hexToRgb(initHex)) : { ...defaultHsv },
        alpha: showAlpha ? defaultAlpha : 1
    };

    function apply(fire = true) {
        const rgb = hsvToRgb(st.hsv.h, st.hsv.s, st.hsv.v);
        const hexStr = rgbToHex(rgb);
        const color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${st.alpha})`;
        swatch.style.backgroundColor = color;
        hexEl.textContent = hexStr.toUpperCase();
        if (alphaRow) {
            alphaRange.style.background =
                `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1))`;
            alphaVal.textContent = Math.round(st.alpha * 100) + '%';
            alphaRange.value = Math.round(st.alpha * 100);
        }
        sv.style.background =
            `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${Math.round(st.hsv.h)}, 100%, 50%))`;
        svMarker.style.left = (st.hsv.s * 100) + '%';
        svMarker.style.top = ((1 - st.hsv.v) * 100) + '%';
        hueMarker.style.left = (st.hsv.h / 360 * 100) + '%';
        presets.querySelectorAll('.hl-preset').forEach(o => {
            o.classList.toggle('active', o.dataset.color.toLowerCase() === hexStr.toLowerCase());
        });
        if (fire) onChange(color, hexStr);
    }

    function svFromEvent(e) {
        const rect = sv.getBoundingClientRect();
        st.hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        st.hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
        apply();
    }
    function hueFromEvent(e) {
        const rect = hue.getBoundingClientRect();
        st.hsv.h = Math.max(0, Math.min(360, (e.clientX - rect.left) / rect.width * 360));
        apply();
    }
    sv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sv.setPointerCapture(e.pointerId);
        svFromEvent(e);
    });
    sv.addEventListener('pointermove', (e) => { if (e.buttons & 1) svFromEvent(e); });
    hue.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hue.setPointerCapture(e.pointerId);
        hueFromEvent(e);
    });
    hue.addEventListener('pointermove', (e) => { if (e.buttons & 1) hueFromEvent(e); });
    if (alphaRange) alphaRange.addEventListener('input', () => {
        st.alpha = parseInt(alphaRange.value, 10) / 100;
        apply();
    });

    hlPresetColors.forEach(p => {
        const o = document.createElement('div');
        o.className = 'hl-preset';
        o.style.background = p;
        o.dataset.color = p;
        o.title = p;
        o.addEventListener('pointerdown', (e) => e.preventDefault());
        o.addEventListener('click', (e) => {
            e.stopPropagation();
            st.hsv = rgbToHsv(hexToRgb(p));
            apply();
            menu.classList.remove('show');
        });
        presets.appendChild(o);
    });

    const panel = { group: btn, menu, st, close: () => menu.classList.remove('show') };
    appColorPanels.push(panel);
    apply(false);   // 初始化静默：只渲染 UI，不上报（避免打开编辑即记改）
    return panel;
}

const highlighterBtn = document.getElementById('highlighterBtn');
highlighterBtn.addEventListener('click', highlightSelection);

// 按前缀查找颜色面板
function findPanelByPrefix(prefix) {
    return colorPanels.find(p => p.prefix === prefix) || null;
}

// 从保存的工作区数据恢复颜色状态（程序性更新，不标记 dirty）
function restoreColorState(colorsData) {
    if (!colorsData) return;
    restoringColors = true;
    try {
        colorPanels.forEach(panel => {
            const st = colorsData[panel.prefix];
            if (st && st.hsv) {
                panel.state.hsv = { ...st.hsv };
                if (typeof st.alpha === 'number') panel.state.alpha = st.alpha;
            }
        });
        colorPanels.forEach(applyColorState);
    } finally {
        restoringColors = false;
    }
}

// 重置为默认颜色（新建文件用，同样不标记 dirty）
function resetColorState() {
    const defaults = {
        hl: { hsv: { h: 51, s: 0.96, v: 1 }, alpha: 1 }
    };
    restoringColors = true;
    try {
        colorPanels.forEach(panel => {
            const d = defaults[panel.prefix];
            if (d) {
                panel.state.hsv = { ...d.hsv };
                panel.state.alpha = d.alpha;
            }
        });
        colorPanels.forEach(applyColorState);
    } finally {
        restoringColors = false;
    }
}
