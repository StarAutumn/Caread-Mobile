// ================================================================
// 橡皮擦：点击荧光笔笔迹，整段擦除（非像素级）
// ================================================================
let eraserActive = false;
const eraserBtn = document.getElementById('eraserBtn');

// 统一开关：切换橡皮擦模式，与画笔（pen.js）互斥
function eraserSetActive(v) {
    eraserActive = v;
    eraserBtn.classList.toggle('active', eraserActive);
    container.classList.toggle('eraser-active', eraserActive);
}

// 点击橡皮擦按钮切换擦除模式
eraserBtn.addEventListener('click', () => {
    eraserSetActive(!eraserActive);
    // 橡皮擦激活时关闭画笔绘制
    if (eraserActive && typeof penSetActive === 'function') penSetActive(false);
});

// 整段擦除荧光笔（含双屏同步）
function eraseHighlightRun(run) {
    const pane = run.closest('.article-pane');
    if (!pane) return;
    // 记录字符偏移区间用于双屏同步
    const index = buildTextIndex(pane);
    const inner = [];
    const w = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) inner.push(w.currentNode);
    let s = -1, e = -1;
    if (inner.length) {
        s = indexStart(inner[0], index);
        e = indexStart(inner[inner.length - 1], index) + inner[inner.length - 1].length;
    }
    unwrapRun(run);
    if (dualMode && s >= 0 && e >= 0) {
        const other = otherPaneOf(pane);
        if (other) {
            const oIndex = buildTextIndex(other);
            const oRun = findRunByOffsets(other, oIndex, s, e);
            if (oRun) unwrapRun(oRun);
        }
    }
    markTabDirty();
}

// 橡皮擦模式下的点击处理在 pen.js 的 canvas 处理器中：
// 先按 canvas 本地坐标做画笔笔迹命中检测，未命中再回退到这里的荧光笔整段擦除
//（eraseHighlightRun 由 pen.js 调用）。