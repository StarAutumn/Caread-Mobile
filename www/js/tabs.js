// ================================================================
// 多标签工作区：每个标签保存一份独立工作区数据
// 依赖 main.js 中的 buildSaveData / restoreWorkspace（运行时调用）
// ================================================================
const tabs = [];      // { id, title, data }
let activeTabId = null;
let tabSeq = 0;
const tabBar = document.getElementById('tab-bar');

// 新建空白工作区数据
function emptyWorkspace() {
    return {
        source: { html: '', text: '' },
        dualMode: false,
        highlights: [],
        openCards: [],
        selectedOptions: [],
        outline: [],
        notes: [],
        colors: null,
        penStrokes: [],
        scrollTop: 0
    };
}

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
}

function getTab(id) {
    return tabs.find(t => t.id === id) || null;
}

// 创建新标签并切换过去（filePath 用于避免重复打开同一文件）
function createTab(title, data, filePath) {
    let t = title || '未命名';
    // 同名「未命名」自动编号，便于区分
    if (t === '未命名') {
        let n = 1;
        while (tabs.some(x => x.title === t)) t = '未命名 ' + (++n);
    }
    const tab = { id: 'tab-' + (++tabSeq), title: t, data: data || emptyWorkspace(), dirty: false, filePath: filePath || null };
    tabs.push(tab);
    activeTabId = tab.id;
    restoreWorkspace(tab.data);
    renderTabBar();
    return tab;
}

// 标记当前标签为「未保存修改」（显示圆点）
function markTabDirty() {
    const tab = getActiveTab();
    if (tab && !tab.dirty) {
        tab.dirty = true;
        renderTabBar();
    }
}

// 清除当前标签的未保存标记（保存成功后调用）
function clearTabDirty() {
    const tab = getActiveTab();
    if (tab && tab.dirty) {
        tab.dirty = false;
        renderTabBar();
    }
}

// 右键重命名：在原标题位置出现输入框
function startRename(tab, el) {
    if (el.querySelector('.tab-input')) return;
    const input = document.createElement('input');
    input.className = 'tab-input';
    input.value = tab.title;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitRename(tab, input.value);
        else if (e.key === 'Escape') renderTabBar();
    });
    input.addEventListener('blur', () => commitRename(tab, input.value));
    const title = el.querySelector('.tab-title');
    if (title) title.replaceWith(input);
    input.focus();
    input.select();
}

function commitRename(tab, newTitle) {
    newTitle = (newTitle || '').trim();
    if (newTitle) tab.title = newTitle;
    renderTabBar();
}

// 切换标签：保存当前标签状态，恢复目标标签
function switchTab(id) {
    if (id === activeTabId) return;
    const cur = getActiveTab();
    if (cur) cur.data = buildSaveData();   // 保存当前标签
    const tab = getTab(id);
    if (!tab) return;
    activeTabId = id;
    restoreWorkspace(tab.data);
    renderTabBar();
}

// 关闭标签（有未保存修改时先弹应用内确认框）
function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.dirty) {
        showAppConfirm(`「${tab.title}」有未保存的修改，确定关闭吗？`).then(ok => {
            if (ok) closeTabNow(id);
        });
        return;
    }
    closeTabNow(id);
}

function closeTabNow(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const wasActive = id === activeTabId;
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
        // 全部关闭：回到开始页，不留「未命名」标签
        activeTabId = null;
        restoreWorkspace(emptyWorkspace());
    } else if (wasActive) {
        const next = tabs[Math.min(idx, tabs.length - 1)];
        activeTabId = next.id;
        restoreWorkspace(next.data);
    }
    renderTabBar();
}

// 渲染标签栏
function renderTabBar() {
    tabBar.innerHTML = '';
    tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.dirty ? ' dirty' : '');
        el.title = tab.title;

        const dot = document.createElement('span');
        dot.className = 'tab-dot';

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title;

        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = '关闭';
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });

        el.addEventListener('click', () => switchTab(tab.id));
        // 右键重命名
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            startRename(tab, el);
        });
        el.appendChild(dot);
        el.appendChild(title);
        el.appendChild(close);
        tabBar.appendChild(el);
    });

    // 新建标签按钮
    const add = document.createElement('div');
    add.className = 'tab-add';
    add.textContent = '+';
    add.title = '新建';
    add.addEventListener('click', () => createTab('未命名', emptyWorkspace()));
    tabBar.appendChild(add);
}
