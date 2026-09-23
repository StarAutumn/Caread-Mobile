// ---------- 荧光笔高亮 ----------
// 展开高亮容器（把内容放回原位）
function unwrapRun(run) {
    const parent = run.parentNode;
    if (!parent) return;
    while (run.firstChild) parent.insertBefore(run.firstChild, run);
    parent.removeChild(run);
}

// 构建 pane 内文本节点与全局字符偏移的映射
// 跳过释义卡片 / 批注卡片内部文本：卡片是悬浮内容，不参与正文偏移计算
function buildTextIndex(pane) {
    const list = [];
    let offset = 0;
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
            const p = n.parentElement;
            if (p && p.closest('.def-card, .note-card')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    while (walker.nextNode()) {
        const n = walker.currentNode;
        list.push({ node: n, start: offset });
        offset += n.length;
    }
    return { list, total: offset };
}

// 文本节点在 index 中的起始偏移
function indexStart(node, index) {
    for (const item of index.list) {
        if (item.node === node) return item.start;
    }
    return -1;
}

// 获取选区所在 pane（按 start 容器归属）
function selectionPane(range) {
    const el = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentNode;
    return (el && el.closest) ? el.closest('.article-pane') || null : null;
}

// 双屏：返回另一个 pane
function otherPaneOf(pane) {
    const panes = container.querySelectorAll('.article-pane');
    const idx = Array.prototype.indexOf.call(panes, pane);
    return panes[1 - idx] || null;
}

// 把 range 边界吸附到文本节点，并 splitText 截断部分覆盖的节点
// 成功返回 true，此时 range 首尾都是精确的文本节点
function snapRangeToTextNodes(range) {
    let sc = range.startContainer, so = range.startOffset;
    if (sc.nodeType === Node.ELEMENT_NODE) {
        const child = sc.childNodes[so];
        if (child && child.nodeType === Node.TEXT_NODE) {
            sc = child; so = 0;
        } else if (child && child.nodeType === Node.ELEMENT_NODE) {
            const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
            const t = w.nextNode();
            if (t) { sc = t; so = 0; }
        } else if (!child && sc.childNodes.length) {
            const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
            let last = null;
            while (w.nextNode()) last = w.currentNode;
            if (last) { sc = last; so = last.length; }
        }
        if (sc.nodeType !== Node.TEXT_NODE) return false;
        range.setStart(sc, so);
    }
    if (sc.nodeType !== Node.TEXT_NODE) return false;

    let ec = range.endContainer, eo = range.endOffset;
    if (ec.nodeType === Node.ELEMENT_NODE) {
        const child = ec.childNodes[eo];
        if (child && child.nodeType === Node.TEXT_NODE) {
            ec = child; eo = 0;
        } else if (child && child.nodeType === Node.ELEMENT_NODE) {
            const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
            const t = w.nextNode();
            if (t) { ec = t; eo = 0; }
        } else if (!child && ec.childNodes.length) {
            const w = document.createTreeWalker(ec, NodeFilter.SHOW_TEXT);
            let last = null;
            while (w.nextNode()) last = w.currentNode;
            if (last) { ec = last; eo = last.length; }
        }
        if (ec.nodeType !== Node.TEXT_NODE) return false;
        range.setEnd(ec, eo);
    }
    if (ec.nodeType !== Node.TEXT_NODE) return false;

    // 先切 end 再切 start；若 start/end 在同一节点，需同步更新边界引用
    const same = sc === ec;
    if (eo > 0 && eo < ec.length) {
        ec.splitText(eo);
        eo = ec.length;
    }
    if (so > 0 && so < sc.length) {
        const tail = sc.splitText(so);
        if (same) {
            ec = tail;
            eo = eo - so;
        }
        sc = tail;
        so = 0;
    }
    range.setStart(sc, so);
    range.setEnd(ec, eo);
    return true;
}

// 包裹从 first 到 last 之间的所有同级节点（含空格、标点），使背景连续
function wrapRange(first, last, color) {
    if (!first || !last || first.parentNode !== last.parentNode) return;
    const block = first.parentNode;

    // 端点所在的高亮容器（文本节点取其父元素）
    const fEl = first.nodeType === Node.ELEMENT_NODE ? first : first.parentElement;
    const lEl = last.nodeType === Node.ELEMENT_NODE ? last : last.parentElement;
    if (!fEl || !lEl) return;
    const fRun = fEl.closest('.hl-run');
    const lRun = lEl.closest('.hl-run');
    if (fRun) unwrapRun(fRun);
    if (lRun && lRun !== fRun) unwrapRun(lRun);

    // 展开区间内已存在的高亮容器，合并成一条连续荧光
    const nodes = [];
    let n = first;
    while (true) {
        nodes.push(n);
        if (n === last) break;
        n = n.nextSibling;
        if (!n) break;
    }
    nodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('hl-run')) {
            unwrapRun(node);
        }
    });

    const children = Array.from(block.childNodes);
    const startIdx = children.indexOf(first);
    const endIdx = children.indexOf(last);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return;

    const run = document.createElement('span');
    run.className = 'hl-run';
    run.style.background = color || 'var(--highlighter-bg)';
    for (let i = startIdx; i <= endIdx; i++) run.appendChild(children[i]);
    block.insertBefore(run, block.childNodes[startIdx]);
}

// 返回 node 所在的块级容器（宿主按该容器的直接子节点包裹）
function blockContainer(node, pane) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== pane &&
        !/^(P|DIV|LI|TD|TH|H1|H2|H3|H4|H5|H6)$/.test(el.tagName)) {
        el = el.parentElement;
    }
    return el || pane;
}

// 按全局字符偏移区间高亮某个 pane（支持任意字符）
function highlightOffsetsInPane(pane, startOffset, endOffset, color) {
    const index = buildTextIndex(pane);
    const covered = [];
    for (const item of index.list) {
        const s = item.start, e = item.start + item.node.length;
        if (e <= startOffset) continue;
        if (s >= endOffset) break;
        covered.push(item);
    }
    if (!covered.length) return;

    // 截断边界节点，使高亮精确到字符
    if (covered.length === 1) {
        let node = covered[0].node;
        const ns = covered[0].start;
        if (startOffset > ns) {
            node = node.splitText(startOffset - ns);
            covered[0] = { node, start: startOffset };
        }
        const relEnd = endOffset - startOffset;
        if (relEnd < node.length) node.splitText(relEnd);
    } else {
        if (startOffset > covered[0].start) {
            const tail = covered[0].node.splitText(startOffset - covered[0].start);
            covered[0] = { node: tail, start: startOffset };
        }
        const last = covered[covered.length - 1];
        if (endOffset < last.start + last.node.length) {
            last.node.splitText(endOffset - last.start);
        }
    }

    // 先展开覆盖范围内已有的高亮容器，再映射宿主
    covered.forEach(c => {
        const r = c.node.parentElement ? c.node.parentElement.closest('.hl-run') : null;
        if (r) unwrapRun(r);
    });

    // 按块容器分组；块内端点取「块的直接子节点」（.word 或文本节点）
    const groups = new Map();
    covered.forEach(c => {
        const block = blockContainer(c.node, pane);
        let host = c.node;
        while (host.parentNode && host.parentNode !== block) host = host.parentNode;
        if (!groups.has(block)) groups.set(block, []);
        const list = groups.get(block);
        if (list.indexOf(host) === -1) list.push(host);
    });
    groups.forEach(hosts => {
        if (hosts.length === 1) {
            wrapRange(hosts[0], hosts[0], color);
        } else {
            wrapRange(hosts[0], hosts[hosts.length - 1], color);
        }
    });
}

// 查找 pane 内文本范围与 [startOffset, endOffset) 完全一致的荧光笔段
function findRunByOffsets(pane, index, startOffset, endOffset) {
    let found = null;
    pane.querySelectorAll('.hl-run').forEach(run => {
        const inner = [];
        const w = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) inner.push(w.currentNode);
        if (!inner.length) return;
        const s = indexStart(inner[0], index);
        const e = indexStart(inner[inner.length - 1], index) + inner[inner.length - 1].length;
        if (s === startOffset && e === endOffset) found = run;
    });
    return found;
}

// 收集第一个 pane 的高亮区间（字符偏移 + 颜色，用于渲染后恢复）
function collectHighlightRanges() {
    const pane = container.querySelector('.article-pane');
    if (!pane) return [];
    const index = buildTextIndex(pane);
    const ranges = [];
    pane.querySelectorAll('.hl-run').forEach(run => {
        const inner = [];
        const w = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) inner.push(w.currentNode);
        if (!inner.length) return;
        const s = indexStart(inner[0], index);
        const e = indexStart(inner[inner.length - 1], index) + inner[inner.length - 1].length;
        if (s >= 0 && e >= 0) ranges.push({ s, e, color: run.style.background || '' });
    });
    return ranges;
}

// 按区间恢复高亮（同步到所有 pane）
function restoreHighlightRanges(ranges) {
    if (!ranges.length) return;
    const panes = container.querySelectorAll('.article-pane');
    panes.forEach(pane => {
        ranges.forEach(r => highlightOffsetsInPane(pane, r.s, r.e, r.color));
    });
}

// 按字符偏移精确重建选区（保证高亮后选区完整保留，含第一个字符）
function restoreSelectionTo(pane, s, e) {
    const index = buildTextIndex(pane);
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
    if (!sn || !en) return;
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
}

// 荧光笔：给鼠标选中的任意字符区域加连续背景高亮
// 选中区域已全部高亮时再次点击则取消
function highlightSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const pane = selectionPane(range);
    if (!pane) return;

    // 选区须完全落在该 pane 内
    const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer
        : range.endContainer.parentNode;
    if (!endEl || !endEl.closest || endEl.closest('.article-pane') !== pane) return;

    // 吸附并截断到文本节点
    if (!snapRangeToTextNodes(range)) return;

    const index = buildTextIndex(pane);
    const startOffset = indexStart(range.startContainer, index);
    const endOffset = indexStart(range.endContainer, index) + range.endContainer.length;
    if (startOffset < 0 || endOffset < 0 || startOffset >= endOffset) return;

    // 取消判定：选区文本范围恰好等于某个荧光笔段
    const exactRun = findRunByOffsets(pane, index, startOffset, endOffset);
    if (exactRun) {
        unwrapRun(exactRun);
        if (dualMode) {
            const other = otherPaneOf(pane);
            if (other) {
                const oIndex = buildTextIndex(other);
                const oRun = findRunByOffsets(other, oIndex, startOffset, endOffset);
                if (oRun) unwrapRun(oRun);
            }
        }
        restoreSelectionTo(pane, startOffset, endOffset);
        markTabDirty();
        return;
    }

    // 高亮当前 pane（任意字符，荧光连续）
    highlightOffsetsInPane(pane, startOffset, endOffset, highlighterColor);

    // 双屏同步高亮
    if (dualMode) {
        const other = otherPaneOf(pane);
        if (other) highlightOffsetsInPane(other, startOffset, endOffset, highlighterColor);
    }

    // 高亮后精确重建选区，避免 splitText/节点移动导致选区丢失首字符
    restoreSelectionTo(pane, startOffset, endOffset);
    markTabDirty();
}
