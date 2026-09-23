// ================================================================
// 画笔：canvas overlay 盖在正文框上方（.pane-content 内、absolute 定位、
// 随内容一起滚动与缩放），笔迹以「内容坐标」存储（相对 .pane-content 边框盒左上角）。
//
// 本应用 Electron 27 = Chromium 118（早于 128 的 CSS zoom 标准化），实测语义：
// - zoom 子树内元素的 getBoundingClientRect() 返回「视觉坐标 ÷ z」（z = 缩放系数），
//   既不是布局像素也不是视觉像素（探针实测：gBCR.top × z = 恒定的真实视觉位置）；
// - clientX / clientY 是真实视觉像素；
// - 因此换算关系固定为：视觉 = gBCR × z；内容坐标 = client ÷ z − gBCR 原点。
// - canvas 的 style 宽高写在 zoom 子树内（style 像素 = 内容像素，视觉 = ×z），
//   缓冲区按 z×dpr 取整 → 1 内容像素 = 1 缓冲像素，笔迹清晰且与光标严格重合；
// - 摆放采用「闭环停靠」：先粗定位，再实测 canvas 矩形与目标矩形的差值一次修正，
//   只依赖同一子树内测量自洽，与几何 API 语义解耦，可吸收取整误差；
// - canvas 只覆盖一屏（且不超过正文框底边），滚动时仅更新位置并重绘，内存与正文长度无关。
// ================================================================
let penStrokes = [];     // [{ color, size, points: [{x,y},...] }]，坐标为内容坐标
let penActive = false;   // 画笔绘制模式是否激活
let penColor = 'rgba(33, 150, 243, 1)';
let penSize = 4;

// 当前正在绘制的笔迹（全局只允许一支笔同时活动）
let _drawing = false;
let _currentStroke = null;
let _strokeCanvas = null;
let _redrawQueued = false;
const _panels = new WeakMap();   // pane → canvas

// 尺寸观察：滚动条出现/消失、缩放后布局晚一帧稳定等都会改变 .pane-content 尺寸，
// ResizeObserver 在布局后、绘制前回调，比定时器及时且不依赖时序猜测
//（canvas 为 absolute 定位，不会反过来改变 wrap 尺寸，无反馈环）
const _wrapRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedulePenRedraw()) : null;

const penBtn = document.getElementById('penBtn');

// ---------- 模式开关（与橡皮擦互斥） ----------
function penSetActive(v) {
    penActive = v;
    penBtn.classList.toggle('active', penActive);
    container.classList.toggle('pen-drawing', penActive);
    // 画笔激活时关闭橡皮擦
    if (penActive && typeof eraserSetActive === 'function') eraserSetActive(false);
}

penBtn.addEventListener('click', () => penSetActive(!penActive));

// ---------- 坐标标定 ----------
function paneContentWrap(pane) {
    return pane.querySelector('.pane-content');
}

// 标定数据：r = 内容层的 gBCR（本 Chromium 语义 = 视觉 ÷ z，须与 z 配套使用）；
// z = 当前缩放系数（缩放滑条设置的精确值）。
// 每次落笔/重绘现测，不跨缩放/滚动缓存
function wrapCalib(pane) {
    const wrap = paneContentWrap(pane);
    if (!wrap) return null;
    return { r: wrap.getBoundingClientRect(), z: currentZoom };
}

// client（屏幕视觉像素）→ 内容坐标：内容 = client ÷ z − gBCR 原点
function calibPoint(calib, cx, cy) {
    return { x: cx / calib.z - calib.r.left, y: cy / calib.z - calib.r.top };
}

// 绘制单条笔迹（单点画实心圆点，多点画连线），坐标为内容坐标
function drawStroke(ctx, s) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.points.length === 1) {
        ctx.beginPath();
        ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
    }
    ctx.restore();
}

// 重绘单个 canvas：所有测量都在「内容空间」（gBCR 值）里进行，视觉 = gBCR × z。
// 可画区域 = 正文框(.pane-content)与滚动视口(.article-pane)的交集：
//   横向 = 正文框全宽；纵向 = 从视口顶端到正文框底边（滚到底时不画出框外）。
// 摆放 = 粗定位 + 闭环停靠（实测差值一次修正，与几何 API 语义无关），并实测验证；
// 布局在测量间隙变化过（如缩放后滚动条晚一帧稳定）则整步重试；
// 不超出正文框由 CSS 的 .pen-canvas { max-width/height: 100% } 硬性保证。
function redrawPanel(canvas) {
    const pane = canvas._pane;
    let ok = false, z, S, W, H, bufScale, bw, bh;
    for (let pass = 0; pass < 3 && !ok; pass++) {
        const calib = wrapCalib(pane);
        if (!calib) return;
        const paneR = pane.getBoundingClientRect();     // 内容空间（视觉 ÷ z）
        const wrapR = calib.r;
        z = calib.z;
        S = Math.max(0, paneR.top - wrapR.top);         // canvas 顶端对应的内容 y
        W = wrapR.width;                                // 正文框宽度（内容像素）
        H = Math.min(paneR.bottom, wrapR.bottom) - paneR.top; // 可画高度（内容像素）
        if (!(W > 0 && H > 0)) return;
        bufScale = (window.devicePixelRatio || 1) * z;
        bw = Math.max(1, Math.round(W * bufScale));
        bh = Math.max(1, Math.round(H * bufScale));

        // 粗定位（先归零，避免上一帧的修正量叠加）
        canvas.style.left = '0px';
        canvas.style.top = S + 'px';
        if (canvas.style.width !== W + 'px') canvas.style.width = W + 'px';
        if (canvas.style.height !== H + 'px') canvas.style.height = H + 'px';
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;

        // 闭环停靠：实测「style 像素 → gBCR 像素」响应比 resp（同子树内测量自洽），
        // 再按实测差值把 canvas 左边停靠到正文框左边、顶边停靠到视口顶边。
        // 注意 top 的差值基准必须取移动后的测量值（cr2），否则会把探针位移双扣。
        const cr0 = canvas.getBoundingClientRect();
        canvas.style.top = (S + 100) + 'px';
        const resp = ((canvas.getBoundingClientRect().top - cr0.top) / 100) || 1;
        const cr2 = canvas.getBoundingClientRect();
        canvas.style.left = ((wrapR.left - cr0.left) / resp) + 'px';
        canvas.style.top = ((S + 100) + (paneR.top - cr2.top) / resp) + 'px';

        // 验证停靠结果，不吻合（布局刚变过）则下一轮重试
        const cr = canvas.getBoundingClientRect();
        ok = Math.abs(cr.left - wrapR.left) < 0.6 && Math.abs(cr.top - paneR.top) < 0.6 &&
             Math.abs(cr.width - W) < 0.6 && Math.abs(cr.height - H) < 0.6;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    if (!penStrokes.length) return;
    ctx.setTransform(bufScale, 0, 0, bufScale, 0, -S * bufScale);
    for (const s of penStrokes) drawStroke(ctx, s);
}

function redrawAll() {
    document.querySelectorAll('canvas.pen-canvas').forEach(redrawPanel);
}

// 滚动/缩放/尺寸变化高频触发时，按帧合并重绘
function schedulePenRedraw() {
    if (_redrawQueued) return;
    _redrawQueued = true;
    requestAnimationFrame(() => {
        _redrawQueued = false;
        redrawAll();
    });
}

// 为每个正文框的内容层补齐 canvas overlay（重复调用幂等）
function ensurePenPanels() {
    container.querySelectorAll('.article-pane').forEach(pane => {
        const wrap = paneContentWrap(pane);
        if (!wrap) return;
        let canvas = _panels.get(pane);
        if (!canvas || canvas.parentElement !== wrap) {
            if (canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas);
            canvas = document.createElement('canvas');
            canvas.className = 'pen-canvas';
            canvas._pane = pane;
            _panels.set(pane, canvas);
            wrap.insertBefore(canvas, wrap.firstChild);
            attachPenCanvas(canvas);
        }
    });
    // 观察内容层尺寸（滚动条出现/消失、缩放布局稳定都会改变它 → 自动重停靠）
    if (_wrapRO) {
        _wrapRO.disconnect();
        container.querySelectorAll('.pane-content').forEach(w => _wrapRO.observe(w));
    }
    redrawAll();
}

// ---------- 指针交互（落笔时现测标定，client 坐标闭环） ----------
function attachPenCanvas(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
        if (penActive) {
            e.preventDefault();
            const calib = wrapCalib(canvas._pane);
            if (!calib) return;
            canvas._calib = calib;   // 整笔期间固定用同一次标定，坐标系一致
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
            _drawing = true;
            _strokeCanvas = canvas;
            _currentStroke = { color: penColor, size: penSize, points: [calibPoint(calib, e.clientX, e.clientY)] };
            penStrokes.push(_currentStroke);
            schedulePenRedraw();
        } else if (eraserActive) {
            e.preventDefault();
            const calib = wrapCalib(canvas._pane);
            if (!calib) return;
            const p = calibPoint(calib, e.clientX, e.clientY);
            if (penEraseAtContent(p.x, p.y)) return;
            // 画笔笔迹未命中 → 让 canvas 暂时穿透，找其下方的荧光笔笔迹整段擦除
            canvas.style.pointerEvents = 'none';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            canvas.style.pointerEvents = '';
            const run = el && el.closest ? el.closest('.hl-run') : null;
            if (run) eraseHighlightRun(run);
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!_drawing || !penActive || _strokeCanvas !== canvas || !canvas._calib) return;
        // 主事件坐标累积落笔点，同时用 coalesced 中间点补齐快速拖动
        const calib = canvas._calib;
        const co = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (let i = 0; i < co.length; i++) {
            if (co[i].pointerId === e.pointerId && co[i].clientX !== undefined) {
                _currentStroke.points.push(calibPoint(calib, co[i].clientX, co[i].clientY));
            }
        }
        _currentStroke.points.push(calibPoint(calib, e.clientX, e.clientY));
        schedulePenRedraw();
    });

    const finish = (e) => {
        if (!_drawing || _strokeCanvas !== canvas) return;
        _drawing = false;
        _currentStroke = null;
        _strokeCanvas = null;
        canvas._calib = null;
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
        }
        markTabDirty();
        schedulePenRedraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
}

// ---------- 点与折线的距离（橡皮擦命中检测，纯数学无浏览器 quirk） ----------
function distSqToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const qx = a.x + t * dx, qy = a.y + t * dy;
    return (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
}

function pointDistPolyline(p, pts) {
    const n = pts.length;
    if (n === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    let best = Infinity;
    for (let i = 0; i < n - 1; i++) {
        const d = distSqToSegment(p, pts[i], pts[i + 1]);
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

// 橡皮擦擦除画笔笔迹：内容坐标点到折线距离命中，擦除返回 true
function penEraseAtContent(x, y) {
    for (let i = penStrokes.length - 1; i >= 0; i--) {
        const s = penStrokes[i];
        const hitR = Math.max(6, s.size / 2 + 2);
        if (pointDistPolyline({ x, y }, s.points) <= hitR) {
            penStrokes.splice(i, 1);
            markTabDirty();
            schedulePenRedraw();
            return true;
        }
    }
    return false;
}

// ---------- 工作区保存 / 恢复 / 清空 ----------
function penSave() {
    return penStrokes.map(s => ({
        color: s.color,
        size: s.size,
        points: s.points.map(p => ({ x: p.x, y: p.y }))
    }));
}

function penRestore(arr) {
    penStrokes = (arr || []).map(s => ({
        color: s.color,
        size: s.size,
        points: (s.points || []).map(p => ({ x: p.x, y: p.y }))
    }));
    schedulePenRedraw();
}

function penClear() {
    penStrokes = [];
    schedulePenRedraw();
}

// renderContent 之后调用：为新生成的内容层补 canvas 并重绘
function penRenderSync() {
    ensurePenPanels();
    schedulePenRedraw();
}

// ---------- 粗细控制 + 偏好记忆 ----------
const penSizeRange = document.getElementById('penSizeRange');
const penSizeVal = document.getElementById('penSizeVal');

function applyPenSizeUI(v) {
    penSize = v;
    penSizeRange.value = v;
    penSizeVal.textContent = v;
}

function savePenPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem('toolPrefs') || '{}') || {};
        prefs.penSize = penSize;
        localStorage.setItem('toolPrefs', JSON.stringify(prefs));
    } catch (e) { /* localStorage 不可用则忽略 */ }
}

penSizeRange.addEventListener('input', () => {
    applyPenSizeUI(parseInt(penSizeRange.value, 10));
    savePenPrefs();
    markTabDirty();
});

// ---------- 滚动 / 窗口尺寸变化时重绘 ----------
// canvas 覆盖一屏高度，滚动时需更新其内容位置（style.top）并重绘
container.addEventListener('scroll', () => {
    if (document.querySelector('canvas.pen-canvas')) schedulePenRedraw();
}, true);

window.addEventListener('resize', () => {
    ensurePenPanels();
    schedulePenRedraw();
    // 窗口尺寸变化后滚动条出现/消失可能晚一帧才稳定，延迟再停靠一次
    setTimeout(schedulePenRedraw, 90);
});

// ---------- 初始化 ----------
(function initPen() {
    try {
        const prefs = JSON.parse(localStorage.getItem('toolPrefs') || '{}') || {};
        if (typeof prefs.penSize === 'number') penSize = prefs.penSize;
    } catch (e) {}
    applyPenSizeUI(penSize);
    ensurePenPanels();
    schedulePenRedraw();
})();
