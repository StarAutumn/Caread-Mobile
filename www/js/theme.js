// ================================================================
// 主题切换（入口在标题栏设置面板的「深浅模式」下拉，见 settings.js）
// ================================================================
const html = document.documentElement;

function getTheme() {
    return html.getAttribute('data-theme') || 'light';
}

function setTheme(theme) {
    // 切换期间禁用所有过渡动画（大量 .word 同时做颜色/阴影过渡会卡顿），
    // 两帧渲染完成后恢复，避免影响日常 hover 等过渡效果
    html.classList.add('theme-switching');
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // 同步给主进程：下次启动的窗口背景色与之匹配，避免主题色白闪
    if (window.electronAPI && window.electronAPI.setThemeSync) {
        window.electronAPI.setThemeSync(theme);
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(() => html.classList.remove('theme-switching'));
    });
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    setTheme(saved || 'light');
}
initTheme();
