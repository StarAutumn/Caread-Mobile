// ================================================================
// 底部状态栏：缩放滑动条控制中间阅读区（#article-container）放大缩小
// 缩放用 CSS zoom 应用在正文容器 #article-container 上（见 renderer.js）：
// - zoom 参与布局，背景框与内容一起缩放，单/双屏随缩放自适应铺满
// - 画笔坐标采用运行时自校准（pen.js wrapCalib），与缩放语义解耦
// - 缩放值 localStorage 记忆（机制同深浅色模式 / 工具偏好）
// ================================================================
const zoomRange = document.getElementById('zoomRange');
const zoomVal = document.getElementById('zoomVal');
const articleContainer = document.getElementById('article-container');

const ZOOM_KEY = 'appZoom';
const ZOOM_DEFAULT = 100;

// 应用缩放（percent: 50 ~ 200）——实时更新 currentZoom 并触发界面重绘
function applyZoom(percent) {
    currentZoom = percent / 100;
    zoomVal.textContent = percent + '%';
    if (typeof refreshZoom === 'function') refreshZoom();
}

function setZoom(percent, save) {
    const min = parseInt(zoomRange.min, 10);
    const max = parseInt(zoomRange.max, 10);
    percent = Math.max(min, Math.min(max, percent));
    zoomRange.value = percent;
    applyZoom(percent);

    if (save) {
        try { localStorage.setItem(ZOOM_KEY, String(percent)); } catch (e) { /* 忽略 */ }
    }
}

// 滑动条拖动
zoomRange.addEventListener('input', () => {
    setZoom(parseInt(zoomRange.value, 10), true);
});

// 双击滑条恢复 100%
zoomRange.addEventListener('dblclick', () => {
    setZoom(ZOOM_DEFAULT, true);
});

// 启动时恢复上次的缩放值
(function initZoom() {
    let saved = ZOOM_DEFAULT;
    try {
        const v = parseInt(localStorage.getItem(ZOOM_KEY), 10);
        if (!isNaN(v)) saved = v;
    } catch (e) { /* 忽略 */ }
    setZoom(saved, false);
})();
