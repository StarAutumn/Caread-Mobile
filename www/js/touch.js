// ================================================================
// 触屏适配：选区浮动菜单按钮（平板无右键）
// - 粗指针（触屏）环境检测，桌面环境零行为变化
// - 正文选区非空时，在选区末行上方显示「⋯」浮动按钮
// - 点按按钮 = 合成 contextmenu 事件派发到 container，
//   完整复用大纲/批注既有的「缓存选区 + 弹菜单」流程（outline.js/notes.js）
// - 长按选词仍走浏览器原生选择（有拖拽手柄可调整），本模块只管菜单入口
// ================================================================
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;

if (IS_TOUCH) {
    const touchSelBtn = document.createElement('div');
    touchSelBtn.id = 'touch-sel-btn';
    touchSelBtn.textContent = '⋯';
    touchSelBtn.classList.add('hidden');
    document.body.appendChild(touchSelBtn);

    let selRafPending = false;

    // 选区变化后校准按钮位置：贴选区末行上方，左右防出屏
    function updateTouchSelBtn() {
        selRafPending = false;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            touchSelBtn.classList.add('hidden');
            return;
        }
        const range = sel.getRangeAt(0);
        const el = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer.parentNode;
        // 仅正文选区触发；卡片/输入区内选区不弹按钮
        if (!el || !el.closest || !el.closest('.article-pane') ||
            el.closest('.def-card, .note-card')) {
            touchSelBtn.classList.add('hidden');
            return;
        }
        if (!sel.toString().trim()) {
            touchSelBtn.classList.add('hidden');
            return;
        }
        const rects = range.getClientRects();
        const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
        if (!r || (!r.width && !r.height)) {
            touchSelBtn.classList.add('hidden');
            return;
        }
        const x = Math.min(Math.max(r.right - 20, 8), window.innerWidth - 48);
        const y = Math.max(r.top - 44, 8);
        touchSelBtn.style.left = x + 'px';
        touchSelBtn.style.top = y + 'px';
        touchSelBtn.classList.remove('hidden');
    }

    document.addEventListener('selectionchange', () => {
        if (selRafPending) return;
        selRafPending = true;
        requestAnimationFrame(updateTouchSelBtn);
    });

    // 滚动/缩放时先隐藏，selectionchange 随后再校准
    window.addEventListener('scroll', () => touchSelBtn.classList.add('hidden'), true);
    document.addEventListener('contextmenu', () => touchSelBtn.classList.add('hidden'));

    // 点按按钮：pointerdown 阻止默认行为（否则触屏点按会清除正文选区，
    // 与 ctxAddNote 同一手法），click 时合成 contextmenu 走既有流程
    touchSelBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    touchSelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = touchSelBtn.getBoundingClientRect();
        touchSelBtn.classList.add('hidden');
        container.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.bottom + 12)
        }));
    });

    // 点按按钮以外区域隐藏按钮（菜单自身的开关由 outline.js 处理）
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#touch-sel-btn')) {
            touchSelBtn.classList.add('hidden');
        }
    });
}
