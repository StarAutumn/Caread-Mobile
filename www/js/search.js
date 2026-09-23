// ================================================================
// 标题栏搜索（Ctrl+F 风格）：
// - 匹配文章中的任意文本（单词、句子、跨单词短语均可）
// - 下拉列出所有匹配及上下文（可滚动），顶部显示匹配总数
// - 点击选项定位到匹配位置并高亮闪烁 2 秒（双屏同步）
// 高亮实现：优先 Custom Highlight API（脉冲闪烁），降级为文本选区
// ================================================================
const titleSearchInput = document.getElementById('titleSearchInput');
const searchDropdown = document.getElementById('searchDropdown');
const SEARCH_LIMIT = 100;   // 下拉最多显示条数
const FLASH_MS = 2000;      // 闪烁时长
const CONTEXT_LEN = 24;     // 上下文前后字符数
const supportsHighlight = typeof Highlight !== 'undefined' &&
    typeof CSS !== 'undefined' && !!CSS.highlights;

let searchTimer = null;

function hideSearchDropdown() {
    searchDropdown.classList.add('hidden');
    searchDropdown.innerHTML = '';
}

// 构建某个 pane 的文本索引与全文
function buildFullText(pane) {
    const index = buildTextIndex(pane);
    const full = index.list.map(i => i.node.textContent).join('');
    return { index, full };
}

// 根据全局字符偏移 [s, e) 构造 Range（可能跨节点）
function rangeForOffsets(index, s, e) {
    let sn = null, so = 0, en = null, eo = 0;
    for (const item of index.list) {
        const ns = item.start, ne = item.start + item.node.length;
        if (!sn && s >= ns && s <= ne) {
            sn = item.node;
            so = Math.min(s - ns, item.node.length);
        }
        if (!en && e > ns && e <= ne) {
            en = item.node;
            eo = e - ns;
        }
        if (sn && en) break;
    }
    if (!sn || !en) return null;
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    return r;
}

// 搜索：全文不区分大小写，收集所有匹配位置
function performSearch(q) {
    q = q.trim();
    searchDropdown.innerHTML = '';
    if (!q) {
        hideSearchDropdown();
        return;
    }
    const pane = container.querySelector('.article-pane');
    if (!pane) {
        hideSearchDropdown();
        return;
    }

    const { index, full } = buildFullText(pane);
    const lower = full.toLowerCase();
    const ql = q.toLowerCase();
    if (!ql) {
        hideSearchDropdown();
        return;
    }

    const matches = [];
    let pos = lower.indexOf(ql);
    while (pos !== -1) {
        matches.push({ s: pos, e: pos + ql.length });
        pos = lower.indexOf(ql, pos + 1);
        if (matches.length >= SEARCH_LIMIT) break;
    }

    // 顶部统计
    const stat = document.createElement('div');
    stat.className = 'search-stat';
    stat.textContent = matches.length
        ? `共 ${matches.length} 处匹配`
        : '无匹配结果';
    searchDropdown.appendChild(stat);
    if (!matches.length) {
        searchDropdown.classList.remove('hidden');
        return;
    }

    // 生成结果条目（上下文 + 序号）
    matches.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'search-item';

        const ctx = document.createElement('span');
        ctx.className = 's-context';
        if (m.s > 0) ctx.appendChild(document.createTextNode('…'));
        ctx.appendChild(document.createTextNode(full.slice(Math.max(0, m.s - CONTEXT_LEN), m.s)));
        const b = document.createElement('b');
        b.textContent = full.slice(m.s, m.e);
        ctx.appendChild(b);
        ctx.appendChild(document.createTextNode(full.slice(m.e, Math.min(full.length, m.e + CONTEXT_LEN))));
        if (m.e < full.length) ctx.appendChild(document.createTextNode('…'));

        const pos = document.createElement('span');
        pos.className = 's-pos';
        pos.textContent = '#' + (i + 1);

        item.appendChild(ctx);
        item.appendChild(pos);
        item.addEventListener('click', () => locateAndFlash(m.s, m.e));
        searchDropdown.appendChild(item);
    });
    searchDropdown.classList.remove('hidden');
}

// 定位：平滑滚动到匹配位置并闪烁 2 秒（双屏同步）
function locateAndFlash(s, e) {
    const pane = container.querySelector('.article-pane');
    if (!pane) return;
    const index = buildTextIndex(pane);
    const range = rangeForOffsets(index, s, e);
    if (!range) return;

    // 平滑滚动，让匹配区域居于 pane 视口中部
    const paneRect = pane.getBoundingClientRect();
    const rRect = range.getBoundingClientRect();
    if (rRect && (rRect.width || rRect.height)) {
        const target = pane.scrollTop + (rRect.top - paneRect.top)
            - pane.clientHeight / 2 + rRect.height / 2;
        pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
    flashRange(pane, index, s, e, 'search-flash-0');

    // 双屏同步定位
    if (dualMode) {
        const other = otherPaneOf(pane);
        if (other) {
            const oIndex = buildTextIndex(other);
            const oRange = rangeForOffsets(oIndex, s, e);
            if (oRange) {
                const oRect = oRange.getBoundingClientRect();
                const opRect = other.getBoundingClientRect();
                if (oRect && (oRect.width || oRect.height)) {
                    const oTarget = other.scrollTop + (oRect.top - opRect.top)
                        - other.clientHeight / 2 + oRect.height / 2;
                    other.scrollTo({ top: Math.max(0, oTarget), behavior: 'smooth' });
                }
                flashRange(other, oIndex, s, e, 'search-flash-1');
            }
        }
    }
}

// 对指定 pane 的字符区间闪烁 2 秒
function flashRange(pane, index, s, e, name) {
    const range = rangeForOffsets(index, s, e);
    if (!range) return;

    if (supportsHighlight) {
        // Custom Highlight API：脉冲闪烁（亮-灭交替）
        const hl = new Highlight(range);
        let on = true;
        CSS.highlights.set(name, hl);
        const iv = setInterval(() => {
            on = !on;
            if (on) CSS.highlights.set(name, hl);
            else CSS.highlights.delete(name);
        }, 400);
        setTimeout(() => {
            clearInterval(iv);
            CSS.highlights.delete(name);
        }, FLASH_MS);
    } else {
        // 降级：用文本选区高亮 2 秒
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setTimeout(() => {
            if (sel.rangeCount && sel.getRangeAt(0) === range) {
                sel.removeAllRanges();
            }
        }, FLASH_MS);
    }
}

// ---------- 事件 ----------
titleSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(titleSearchInput.value), 200);
});

// 聚焦时若已有输入，重新弹出结果
titleSearchInput.addEventListener('focus', () => {
    if (titleSearchInput.value.trim()) {
        performSearch(titleSearchInput.value);
    }
});

titleSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideSearchDropdown();
        titleSearchInput.blur();
        e.stopPropagation();
    }
});

// 点击搜索区域之外关闭下拉
document.addEventListener('click', (e) => {
    if (!e.target.closest('.title-search')) {
        hideSearchDropdown();
    }
});
