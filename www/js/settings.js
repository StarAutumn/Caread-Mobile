// ================================================================
// 标题栏设置面板（⚙ 按钮，最小化左侧）
// - 深浅模式：下拉选项，调 theme.js 的 setTheme（localStorage 'theme' 持久化）
// - 汉译卡片字号：下拉选项，localStorage 'defCardFont' 持久化，
//   经 CSS 变量 --def-card-font 作用于 .def-card（内部元素继承字号）
// - 面板定位在设置按钮下方、右缘对齐；点面板外或 Escape 关闭
// ================================================================
const settingsBtn = document.getElementById('settingsBtn');
let settingsPop = null;

function closeSettings() {
    if (settingsPop) {
        settingsPop.remove();
        settingsPop = null;
    }
}

// 汉译卡片字号：写 CSS 变量（其余设置项变更也走这里保持单一入口）
function applyDefCardFont(px) {
    document.documentElement.style.setProperty('--def-card-font', px + 'px');
}

function openSettings() {
    closeSettings();

    settingsPop = document.createElement('div');
    settingsPop.className = 'settings-pop';
    settingsPop.innerHTML = `
        <div class="settings-row">
            <span class="settings-label">深浅模式</span>
            <select id="themeSelect" title="切换深色/浅色模式">
                <option value="light">☀️ 浅色</option>
                <option value="dark">🌙 深色</option>
            </select>
        </div>
        <div class="settings-row">
            <span class="settings-label">汉译卡片字号</span>
            <select id="defFontSelect" title="调整单词释义卡片字号">
                <option value="11">小（11px）</option>
                <option value="12">偏小（12px）</option>
                <option value="13">标准（13px）</option>
                <option value="14">偏大（14px）</option>
                <option value="16">大（16px）</option>
                <option value="18">特大（18px）</option>
            </select>
        </div>
        <div class="settings-row">
            <span class="settings-label">启动时窗口</span>
            <select id="launchStateSelect" title="应用启动时的窗口状态">
                <option value="normal">窗口化</option>
                <option value="maximized">最大化</option>
            </select>
        </div>
    `;
    document.body.appendChild(settingsPop);

    // 深浅模式：初值取当前主题（theme.js 启动时已从 localStorage 恢复）
    const themeSel = settingsPop.querySelector('#themeSelect');
    themeSel.value = getTheme();
    themeSel.addEventListener('change', () => setTheme(themeSel.value));

    // 汉译卡片字号
    const fontSel = settingsPop.querySelector('#defFontSelect');
    fontSel.value = localStorage.getItem('defCardFont') || '13';
    fontSel.addEventListener('change', () => {
        applyDefCardFont(fontSel.value);
        localStorage.setItem('defCardFont', fontSel.value);
    });

    // 启动窗口状态：初值与持久化都在主进程（userData/settings.json），下次启动生效
    const launchSel = settingsPop.querySelector('#launchStateSelect');
    window.electronAPI.getLaunchState().then(state => { launchSel.value = state; });
    launchSel.addEventListener('change', () => {
        window.electronAPI.setLaunchState(launchSel.value);
    });

    // 定位：设置按钮正下方，右缘与按钮右缘对齐（靠窗口右缘不外溢）
    const r = settingsBtn.getBoundingClientRect();
    settingsPop.style.top = r.bottom + 'px';
    settingsPop.style.right = (window.innerWidth - r.right) + 'px';
}

settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (settingsPop) closeSettings();
    else openSettings();
});

// 点击面板外关闭（面板内点击不关闭，避免操作下拉时面板消失）
document.addEventListener('click', (e) => {
    if (settingsPop
        && !e.target.closest('.settings-pop')
        && !e.target.closest('#settingsBtn')) {
        closeSettings();
    }
});

// Escape 关闭设置面板（titlebar.js 的 Escape 只管菜单下拉）
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPop) closeSettings();
});

// 启动恢复上次的卡片字号（未设置过 = 标准 13px，与原值一致）
applyDefCardFont(localStorage.getItem('defCardFont') || '13');
