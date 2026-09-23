// ================================================================
// 自定义标题栏（VSCode 风格）：
// - 左侧菜单（文件/编辑/视图/窗口），点击展开下拉
// - 中间加粗标题、右侧窗口控制按钮（最小化/最大化/关闭）
// - 依赖 main.js 中的 newWorkspace / openWorkspace / saveWorkspace /
//   exportWorkspace（运行时调用）
// ================================================================
const menusDef = [
    {
        label: '文件',
        items: [
            { label: '新建', accel: 'Ctrl+N', action: () => newWorkspace() },
            { label: '打开…', accel: 'Ctrl+O', action: () => openWorkspace() },
            { label: '保存…', accel: 'Ctrl+S', action: () => saveWorkspace() },
            { label: '导出 PDF…', accel: 'Ctrl+P', action: () => exportWorkspace() },
            { sep: true },
            { label: '退出', action: () => window.electronAPI.quitApp() }
        ]
    },
    {
        label: '编辑',
        items: [
            { label: '撤销', accel: 'Ctrl+Z', cmd: 'undo' },
            { label: '重做', accel: 'Ctrl+Y', cmd: 'redo' },
            { sep: true },
            { label: '剪切', accel: 'Ctrl+X', cmd: 'cut' },
            { label: '复制', accel: 'Ctrl+C', cmd: 'copy' },
            { label: '粘贴', accel: 'Ctrl+V', cmd: 'paste' },
            { label: '全选', accel: 'Ctrl+A', cmd: 'selectAll' }
        ]
    },
    {
        label: '视图',
        items: [
            { label: '重新加载', accel: 'Ctrl+R', action: () => location.reload() },
            { label: '切换开发者工具', accel: 'Ctrl+Shift+I', action: () => window.electronAPI.toggleDevTools() }
        ]
    },
    {
        label: '窗口',
        items: [
            { label: '最小化', action: () => window.electronAPI.winControl('minimize') },
            { label: '最大化 / 还原', action: () => window.electronAPI.winControl('maximize') },
            { label: '关闭', action: () => window.electronAPI.winControl('close') }
        ]
    }
];

const titleMenus = document.getElementById('titleMenus');
let openMenuBtn = null;

function closeDropdown() {
    const dd = document.querySelector('.dropdown');
    if (dd) dd.remove();
    if (openMenuBtn) {
        openMenuBtn.classList.remove('active');
        openMenuBtn = null;
    }
}

function openDropdownFor(btn, def) {
    closeDropdown();
    openMenuBtn = btn;
    btn.classList.add('active');

    const dd = document.createElement('div');
    dd.className = 'dropdown';
    def.items.forEach(item => {
        if (item.sep) {
            const s = document.createElement('div');
            s.className = 'dropdown-sep';
            dd.appendChild(s);
            return;
        }
        const it = document.createElement('div');
        it.className = 'dropdown-item';
        const label = document.createElement('span');
        label.className = 'item-label';
        label.textContent = item.label;
        it.appendChild(label);
        if (item.accel) {
            const acc = document.createElement('span');
            acc.className = 'item-accel';
            acc.textContent = item.accel;
            it.appendChild(acc);
        }
        it.addEventListener('click', () => {
            closeDropdown();
            if (item.action) item.action();
            else if (item.cmd) window.electronAPI.editCommand(item.cmd);
        });
        dd.appendChild(it);
    });

    document.body.appendChild(dd);
    const r = btn.getBoundingClientRect();
    dd.style.left = r.left + 'px';
    dd.style.top = r.bottom + 'px';
}

// 渲染菜单按钮
menusDef.forEach(def => {
    const btn = document.createElement('div');
    btn.className = 'title-menu-btn';
    btn.textContent = def.label;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openMenuBtn === btn) {
            closeDropdown();
            return;
        }
        openDropdownFor(btn, def);
    });
    // 已有菜单展开时，滑过其它菜单直接切换（VSCode 行为）
    btn.addEventListener('mouseenter', () => {
        if (openMenuBtn && openMenuBtn !== btn) openDropdownFor(btn, def);
    });
    titleMenus.appendChild(btn);
});

// 点击标题栏外的位置关闭下拉菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') && !e.target.closest('.title-menu-btn')) {
        closeDropdown();
    }
});

// ---------- 窗口控制按钮 ----------
document.getElementById('winMinBtn').addEventListener('click', () => {
    window.electronAPI.winControl('minimize');
});
document.getElementById('winMaxBtn').addEventListener('click', () => {
    window.electronAPI.winControl('maximize');
});
document.getElementById('winCloseBtn').addEventListener('click', () => {
    window.electronAPI.winControl('close');
});

// 最大化/还原状态变化时更新图标
window.electronAPI.onWindowState(state => {
    const ico = document.getElementById('winMaxIco');
    if (ico) ico.textContent = state === 'maximized' ? '❐' : '▢';
});

// ---------- 应用级快捷键 ----------
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openMenuBtn) {
        closeDropdown();
        return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'n') { e.preventDefault(); newWorkspace(); }
        else if (k === 'o') { e.preventDefault(); openWorkspace(); }
        else if (k === 's') { e.preventDefault(); saveWorkspace(); }
        else if (k === 'p') { e.preventDefault(); exportWorkspace(); }
        else if (k === 'r') { e.preventDefault(); location.reload(); }
    } else if (e.ctrlKey && e.shiftKey && !e.altKey) {
        if (e.key.toLowerCase() === 'i') {
            e.preventDefault();
            window.electronAPI.toggleDevTools();
        }
    }
});
