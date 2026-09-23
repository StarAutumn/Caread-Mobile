// ---------- 查词相关 ----------
function toggleDefinition(wordSpan, skipSync = false) {
    // 隐藏卡片模式：点击单词不弹卡，仅提示切换回显示模式
    if (cardsHiddenMode) {
        showToast('请切换为显示卡片模式', 'info');
        return;
    }
    const existing = wordSpan.querySelector('.def-card');
    if (existing) {
        wordSpan.removeChild(existing);
    } else {
        showDefinition(wordSpan);
    }

    // 双屏同步
    if (dualMode && !skipSync) {
        const pane = wordSpan.closest('.article-pane');
        if (pane) {
            const container = pane.parentNode;
            const panes = container.querySelectorAll('.article-pane');
            let otherPane = null;
            for (let p of panes) {
                if (p !== pane) {
                    otherPane = p;
                    break;
                }
            }
            if (otherPane) {
                // 两屏 DOM 结构一致，按单词索引定位「同一次出现」，
                // 避免重复单词（如 the）总是同步到第一次出现的位置
                const allWords = pane.querySelectorAll('.word');
                const idx = Array.prototype.indexOf.call(allWords, wordSpan);
                if (idx >= 0) {
                    const otherWords = otherPane.querySelectorAll('.word');
                    const otherSpan = otherWords[idx];
                    if (otherSpan && otherSpan.dataset.word === wordSpan.dataset.word) {
                        const currentHas = wordSpan.querySelector('.def-card') !== null;
                        const otherHas = otherSpan.querySelector('.def-card') !== null;
                        if (currentHas && !otherHas) {
                            showDefinition(otherSpan);
                        } else if (!currentHas && otherHas) {
                            const card = otherSpan.querySelector('.def-card');
                            if (card) otherSpan.removeChild(card);
                        }
                        // 状态一致，不做操作
                    }
                }
            }
        }
    }
    // 开/关卡片属于工作区修改
    markTabDirty();
}

function showDefinition(wordSpan) {
    const word = wordSpan.dataset.word;
    const card = document.createElement('div');
    card.className = 'def-card';
    card.addEventListener('click', (e) => e.stopPropagation());
    wordSpan.appendChild(card);
    card.innerHTML = `<span class="loading-text">⏳ 查询中...</span>`;
    window.electronAPI.lookupWord(word)
        .then(result => {
            if (result.translation) {
                renderCard(card, result.translation);
            } else {
                card.innerHTML = `<span style="color:var(--error-color);">❌ ${result.error || '未收录'}</span>`;
            }
        })
        .catch(err => {
            card.innerHTML = `<span style="color:var(--error-color);">❌ 查询出错</span>`;
        });
}

function renderCard(card, meaning) {
    card.innerHTML = '';

    function mapPos(pos) { return pos === 'a.' ? 'adj.' : pos; }

    // 领域标签中文展开（ECDICT 行首 [医] / 【计算机】 等），未收录的原样显示
    const DOMAIN_MAP = {
        '医': '医学', '化': '化学', '数': '数学', '物': '物理', '生': '生物',
        '农': '农业', '军': '军事', '法': '法律', '经': '经济', '心': '心理',
        '计': '计算机', '天': '天文', '地': '地质', '音': '音乐', '体': '体育',
        '电': '电学', '林': '林学', '航': '航空', '海': '海洋',
        '口': '口语', '俚': '俚语', '谚': '谚语'
    };
    function mapDomain(t) { return DOMAIN_MAP[t] || t; }

    // 行首解析：领域标签（[医] / 【计算机】）+ 词性缩写（n. / adj.）。
    // 标签内容须为纯中英文且 ≤6 字符，避免把 [1913] 之类的杂项误认成领域标签
    function parseDefLine(line) {
        let domain = null, rest = line;
        let m = rest.match(/^[\[【]([\u4e00-\u9fa5A-Za-z]{1,6})[\]】]\s*(.*)$/);
        if (m) { domain = mapDomain(m[1]); rest = m[2]; }
        m = rest.match(/^([a-zA-Z]+\.)\s*(.*)/);
        return {
            domain,
            pos: m ? mapPos(m[1]) : null,
            text: m ? m[2] : rest
        };
    }
    let normalized = meaning.replace(/\\n/g, '\n').replace(/\\r/g, '');
    const lines = normalized.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);

    function clearHighlight() {
        card.querySelectorAll('.def-item').forEach(el => {
            el.classList.remove('highlight');
            el.style.order = '0';
        });
        card._highlighted = null;
    }

    function highlightItem(item) {
        clearHighlight();
        item.classList.add('highlight');
        item.style.order = '-1';
        card._highlighted = item;
    }

    if (lines.length === 0) {
        const items = meaning.split(/[；;]+/).map(s => s.trim()).filter(s => s.length > 0);
        items.forEach(item => {
            const { domain, pos, text } = parseDefLine(item);
            const div = document.createElement('div');
            div.className = 'def-item';
            let html = '';
            if (domain) html += `<span class="pos">${domain}</span>`;
            if (pos) html += `<span class="pos">${pos}</span>`;
            div.innerHTML = html + `<span class="meaning">${text}</span>`;
            div.addEventListener('click', function (e) {
                e.stopPropagation();
                if (card._highlighted === this) clearHighlight();
                else highlightItem(this);
            });
            card.appendChild(div);
        });
        return;
    }

    const groups = {};
    const extra = [];
    lines.forEach(line => {
        const { domain, pos, text } = parseDefLine(line);
        if (pos || domain) {
            // 组键：领域标签·词性（如「医学·n.」），同组释义合并展示
            const key = [domain, pos].filter(Boolean).join('·');
            const subItems = text.split(/[,，、；;]+/).map(s => s.trim()).filter(s => s.length > 0);
            if (subItems.length === 0) subItems.push(text);
            if (!groups[key]) groups[key] = [];
            groups[key] = groups[key].concat(subItems);
        } else {
            extra.push(line);
        }
    });

    for (const [pos, items] of Object.entries(groups)) {
        const div = document.createElement('div');
        div.className = 'def-item';
        div.innerHTML = `<span class="pos">${pos}</span><span class="meaning">${items.join('、')}</span>`;
        div.addEventListener('click', function (e) {
            e.stopPropagation();
            if (card._highlighted === this) clearHighlight();
            else highlightItem(this);
        });
        card.appendChild(div);
    }
    extra.forEach(line => {
        const div = document.createElement('div');
        div.className = 'def-item';
        div.innerHTML = `<span class="meaning">${line}</span>`;
        div.addEventListener('click', function (e) {
            e.stopPropagation();
            if (card._highlighted === this) clearHighlight();
            else highlightItem(this);
        });
        card.appendChild(div);
    });
}
