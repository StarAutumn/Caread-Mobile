// ================================================================
// 核心功能
// ================================================================
const container = document.getElementById('article-container');

// 事件代理：处理单词点击（查词或选项高亮）
container.addEventListener('click', function (e) {
    // 画笔/橡皮擦模式下，点击用于划线或擦除，不触发查词/选项
    if ((typeof penActive !== 'undefined' && penActive) ||
        (typeof eraserActive !== 'undefined' && eraserActive)) return;
    const target = e.target.closest('.word');
    if (!target) return;
    if (target.classList.contains('option-letter')) {
        toggleOptionSelection(target);
    } else {
        toggleDefinition(target);
    }
});
const textInput = document.getElementById('textInput');
const importBtn = document.getElementById('importBtn');
const wordCount = document.getElementById('wordCount');
const startPage = document.getElementById('start-page');

// ---------- 缩放状态 ----------
// 缩放用 CSS zoom 加在正文容器 #article-container 上（保持原有行为）：
// zoom 参与布局，单/双屏在任意缩放下自动铺满窗口，背景框与内容一起缩放。
// 画笔坐标不做任何「假定 API 返回视觉/布局像素」的换算，采用运行时自校准
// （实测缩放系数 q = 视觉宽/布局宽，见 pen.js 的 wrapCalib），
// 与 Chromium 各版本几何 API 的语义差异彻底解耦。
let currentZoom = 1;   // 当前缩放比例（1 = 100%）

// 把当前缩放应用到正文容器（自动覆盖单/双屏所有正文框）
function applyZoomToPanes() {
    container.style.zoom = currentZoom;
}

// 缩放改变后的统一出口：应用缩放 + 触发画笔重绘
function refreshZoom() {
    applyZoomToPanes();
    if (typeof schedulePenRedraw === 'function') {
        schedulePenRedraw();
        // 缩放后滚动条出现/消失可能晚一帧才稳定（布局异步收敛），延迟再停靠一次画布
        setTimeout(() => schedulePenRedraw(), 90);
    }
}

// ---------- 双屏控制 ----------
let dualMode = false;
let currentHtml = '';

// 构造单个正文框的内容：正文包进 .pane-content（背景框随内容缩放），画笔 canvas 在其内部
function buildPaneInner(pane, html) {
    const content = document.createElement('div');
    content.className = 'pane-content';
    content.innerHTML = html;
    pane.appendChild(content);
}

function renderContent(html) {
    // 保存荧光笔高亮（基于第一个 pane 的字符偏移），渲染后恢复
    const savedHighlightRanges = collectHighlightRanges();
    currentHtml = html;
    // 无内容时显示开始页面，隐藏文章区
    if (startPage) startPage.classList.toggle('hidden', !!html);
    container.classList.toggle('hidden', !html);
    container.innerHTML = '';
    if (dualMode) {
        container.classList.add('dual');
        const pane1 = document.createElement('div');
        pane1.className = 'article-pane';
        buildPaneInner(pane1, html);
        const pane2 = document.createElement('div');
        pane2.className = 'article-pane';
        buildPaneInner(pane2, html);
        container.appendChild(pane1);
        container.appendChild(pane2);
    } else {
        container.classList.remove('dual');
        const pane = document.createElement('div');
        pane.className = 'article-pane';
        buildPaneInner(pane, html);
        container.appendChild(pane);
    }

    // 恢复荧光笔高亮
    restoreHighlightRanges(savedHighlightRanges);

    // 标记选项字母
    markOptionLetters();

    // 恢复批注卡片（基于字符偏移，重新渲染后自动还原）
    if (typeof restoreNoteCards === 'function') restoreNoteCards();

    // 重新应用缩放 + 重建画笔 overlay（含双屏/单屏切换）
    refreshZoom();
    if (typeof penRenderSync === 'function') penRenderSync();

    // 统计单词数
    const total = container.querySelectorAll('.word').length;
    wordCount.textContent = total + ' 个单词';
}

// 标记选项字母，使其变为可点击按钮
function markOptionLetters() {
    const optionItems = container.querySelectorAll('.option-item');
    optionItems.forEach(item => {
        const words = item.querySelectorAll('.word');
        let letterSpan = null;
        for (let w of words) {
            const t = w.textContent.trim();
            // 匹配各种格式：A, [A], (A), A., A、等
            if (/^[A-D]$/.test(t) || /^[\[\(]?[A-D][\]\)]?[.、]?$/.test(t)) {
                letterSpan = w;
                break;
            }
        }
        if (letterSpan) {
            const letter = letterSpan.textContent.trim().replace(/[\[\(]?([A-D])[\]\)]?[.、]?/, '$1');
            letterSpan.textContent = letter;
            letterSpan.classList.add('option-letter');
            letterSpan.dataset.letter = letter;
        }
    });
}

// 点击选项字母时的处理（单选高亮）
function toggleOptionSelection(letterSpan) {
    const optionItem = letterSpan.closest('.option-item');
    if (!optionItem) return;

    // 使用题号+字母作为唯一标识
    const group = optionItem.dataset.question;
    const letter = letterSpan.dataset.letter;
    if (!group || !letter) {
        console.warn('选项缺少 group 或 letter', optionItem);
        return;
    }

    const panes = container.querySelectorAll('.article-pane');

    // 如果当前选项已选中，则取消所有窗格中同组同字母选项的高亮
    if (optionItem.classList.contains('selected')) {
        panes.forEach(pane => {
            pane.querySelectorAll(`.option-item[data-question="${group}"] .option-letter[data-letter="${letter}"]`).forEach(span => {
                const item = span.closest('.option-item');
                if (item) item.classList.remove('selected');
            });
        });
        markTabDirty();
        return;
    }

    // 否则：先清除所有窗格中同组所有选项的高亮（单选）
    panes.forEach(pane => {
        pane.querySelectorAll(`.option-item[data-question="${group}"]`).forEach(item => {
            item.classList.remove('selected');
        });
    });
    // 然后给所有窗格中该字母的选项添加高亮
    panes.forEach(pane => {
        pane.querySelectorAll(`.option-item[data-question="${group}"] .option-letter[data-letter="${letter}"]`).forEach(span => {
            const item = span.closest('.option-item');
            if (item) item.classList.add('selected');
        });
    });
    markTabDirty();
}

// 切换双屏按钮
const dualToggleBtn = document.getElementById('dualToggleBtn');
dualToggleBtn.addEventListener('click', function () {
    // 1. 保存滚动位置
    const panesBefore = container.querySelectorAll('.article-pane');
    const scrollPositions = [];
    panesBefore.forEach(pane => {
        scrollPositions.push(pane.scrollTop);
    });

    // 2. 保存当前所有打开的卡片（单词 + 在 pane 中的索引，避免重复单词恢复错位）
    const openWords = [];
    const allWordsBefore = container.querySelectorAll('.word');
    allWordsBefore.forEach((span, idx) => {
        if (span.querySelector('.def-card')) {
            openWords.push({ word: span.dataset.word, idx });
        }
    });

    // 3. 保存当前所有选中的选项（高亮）
    const selectedOptions = [];
    container.querySelectorAll('.option-item.selected').forEach(item => {
        const question = item.dataset.question;
        const letterSpan = item.querySelector('.option-letter');
        const letter = letterSpan ? letterSpan.dataset.letter : null;
        if (question && letter) {
            selectedOptions.push({ question, letter });
        }
    });

    // 4. 切换模式
    dualMode = !dualMode;
    this.textContent = dualMode ? '📺 单屏' : '🖥️ 双屏';

    // 5. 重新渲染内容
    if (currentHtml) {
        renderContent(currentHtml);

        // 6. 恢复卡片（按索引定位同一次出现的单词）
        const panes = container.querySelectorAll('.article-pane');
        openWords.forEach(({ idx }) => {
            panes.forEach(pane => {
                const span = pane.querySelectorAll('.word')[idx];
                if (span && !span.querySelector('.def-card')) {
                    showDefinition(span);
                }
            });
        });

        // 7. 恢复高亮选项
        selectedOptions.forEach(({ question, letter }) => {
            panes.forEach(pane => {
                const item = pane.querySelector(`.option-item[data-question="${question}"] .option-letter[data-letter="${letter}"]`);
                if (item) {
                    const optionItem = item.closest('.option-item');
                    if (optionItem) optionItem.classList.add('selected');
                }
            });
        });

        // 8. 恢复滚动位置
        panes.forEach((pane, index) => {
            if (index < scrollPositions.length) {
                pane.scrollTop = scrollPositions[index];
            } else {
                pane.scrollTop = 0; // 新增加的 pane 滚动到顶部
            }
        });
    }
    markTabDirty();
});

// ---------- 分词工具 ----------
function tokenize(text) {
    // 三类 token：单词 / 空白（必须保留，否则渲染后单词会连在一起）/ 其它单字符
    const regex = /([a-zA-Z']+)|(\s+)|([^\s])/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1]) {
            tokens.push({ type: 'word', text: match[1] });
        } else if (match[2]) {
            tokens.push({ type: 'space', text: match[2] });
        } else {
            tokens.push({ type: 'punctuation', text: match[3] });
        }
    }
    return tokens;
}

// ---------- 纯文本渲染 ----------
function renderArticle(text, keepCards = false) {
    // 构建 HTML 字符串
    let html = '';
    let wordTotal = 0;

    // 临时容器用于生成内容
    const tempDiv = document.createElement('div');
    tempDiv.style.fontSize = '20px';
    tempDiv.style.lineHeight = '1.8';
    tempDiv.style.fontFamily = "'Segoe UI', 'PingFang SC', Roboto, sans-serif";
    tempDiv.style.whiteSpace = 'pre-wrap';

    let openWords = [];
    if (keepCards) {
        const allWordsBefore = document.querySelectorAll('.word');
        allWordsBefore.forEach((span, idx) => {
            if (span.querySelector('.def-card')) {
                openWords.push({ idx });
            }
        });
    }

    let i = 0;
    while (i < text.length) {
        if (/[a-zA-Z']/.test(text[i])) {
            let start = i;
            while (i < text.length && /[a-zA-Z']/.test(text[i])) i++;
            const wordText = text.slice(start, i);
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = wordText;
            span.dataset.word = wordText.toLowerCase();
            span.addEventListener('click', function (e) {
                if (e.target === this) toggleDefinition(this);
            });
            tempDiv.appendChild(span);
            wordTotal++;
        } else {
            let start = i;
            while (i < text.length && !/[a-zA-Z']/.test(text[i])) i++;
            const raw = text.slice(start, i);
            const node = document.createTextNode(raw);
            tempDiv.appendChild(node);
        }
    }

    // 保留卡片
    if (keepCards) {
        // 由于重新渲染，需要重新打开卡片
        // 但这里我们只负责生成 HTML，卡片打开逻辑由 renderContent 后的点击触发
        // 所以先不处理，后面可以通过 showDefinition 恢复
    }

    html = tempDiv.innerHTML;
    // 清理临时元素
    tempDiv.remove();

    // 渲染
    renderContent(html);

    // 恢复卡片（如果有记忆，按索引定位）
    if (keepCards) {
        const allWords = container.querySelectorAll('.word');
        openWords.forEach(({ idx }) => {
            const span = allWords[idx];
            if (span) showDefinition(span);
        });
    }
    wordCount.textContent = wordTotal + ' 个单词';
}

// ---------- 带样式渲染（导入 Word） ----------
function renderStyledArticle(plainText, styledHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(styledHtml, 'text/html');

    // 为所有段落和标题添加基本样式，并检测选项段落
    let currentQuestion = null;  // 跟踪当前题号

    doc.querySelectorAll('p, div, li, td, th, h1, h2, h3, h4, h5, h6').forEach(el => {
        const text = el.textContent.trim();

        // 检测题号：段落以数字开头即视为题号
        // 覆盖 "1."、"2、"、"3)"、"（1）"、"1. 题干" 等各种写法
        const questionMatch = text.match(/^[（(【\[]?\s*(\d+)\s*(?:[.、)）】\]]|$)/);
        if (questionMatch) {
            currentQuestion = questionMatch[1];
        }

        if (['P', 'DIV', 'LI', 'TD', 'TH'].includes(el.tagName)) {
            // 选项行（在线真题）用紧凑间距，其余段落保持默认
            el.style.margin = el.classList.contains('exam-option') ? '0.1em 0' : '0.5em 0';
            el.style.lineHeight = '1.6';

            // 识别选项段落
            const optionPattern = /^\s*(\[\s*[A-G]\s*\]|\([A-G]\)|[A-G]\s*[.、)）])\s*/i;
            if (optionPattern.test(text) && text.length < 100) {
                el.classList.add('option-item');
                // 兜底：若尚未检测到题号，尝试从前一个兄弟元素推断
                if (!currentQuestion) {
                    const prev = el.previousElementSibling;
                    if (prev) {
                        const m = prev.textContent.trim().match(/^[（(【\[]?\s*(\d+)\s*(?:[.、)）】\]]|$)/);
                        if (m) currentQuestion = m[1];
                    }
                }
                if (currentQuestion) {
                    el.dataset.question = currentQuestion;
                }
            }
        } else if (el.tagName.startsWith('H')) {
            el.style.margin = '0.7em 0';
            el.style.lineHeight = '1.4';
        }
    });

    // 遍历文本节点替换单词
    const walker = document.createTreeWalker(
        doc.body,
        NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentNode;
                if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return NodeFilter
                    .FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    textNodes.forEach(textNode => {
        const parent = textNode.parentNode;
        const text = textNode.textContent;
        const tokens = tokenize(text);
        if (tokens.length === 0) return;

        if (tokens.length === 1 && tokens[0].type === 'word') {
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = text;
            span.dataset.word = text.toLowerCase();
            parent.replaceChild(span, textNode);
        } else {
            const fragment = document.createDocumentFragment();
            tokens.forEach(token => {
                if (token.type === 'word') {
                    const span = document.createElement('span');
                    span.className = 'word';
                    span.textContent = token.text;
                    span.dataset.word = token.text.toLowerCase();
                    fragment.appendChild(span);
                } else {
                    fragment.appendChild(document.createTextNode(token.text));
                }
            });
            parent.replaceChild(fragment, textNode);
        }
    });

    // 获取生成的 HTML
    const html = doc.body.innerHTML;
    renderContent(html);
    // 重新绑定点击事件已经在 renderContent 中完成
}
