// ================================================================
// 一键显示/隐藏单词卡片（模式切换 + 记忆手动打开状态）
// - 显示卡片模式：点击单词可弹出释义卡，按钮显示「📕 隐藏卡片」（点击切到隐藏模式）
// - 隐藏卡片模式：点击单词仅提示，按钮显示「📖 显示卡片」（点击切回显示模式）
// - 切到隐藏模式时记住已打开的卡片，切回时恢复（savedCards 随标签保存）
// ================================================================
const toggleCardsBtn = document.getElementById('toggleCardsBtn');
let savedCards = [];
let cardsHiddenMode = false;   // 当前是否为「隐藏卡片」模式（随标签保存/恢复）

// 按钮文字与模式同步：能点开卡片时显示「隐藏卡片」，隐藏模式显示「显示卡片」。
// 同时把 body.cards-hidden-mode 开关同步给批注卡（含字符边框）的隐藏样式
function syncToggleCardsBtn() {
    toggleCardsBtn.textContent = cardsHiddenMode ? '📖 显示卡片' : '📕 隐藏卡片';
    document.body.classList.toggle('cards-hidden-mode', cardsHiddenMode);
}

// 收集所有 pane 中已打开卡片的单词索引（双屏时两个 pane 内容一致，按索引去重）
function getVisibleWords() {
    const words = [];
    const seen = new Set();
    const panes = container.querySelectorAll('.article-pane');
    panes.forEach(pane => {
        const allWords = pane.querySelectorAll('.word');
        allWords.forEach((span, idx) => {
            if (span.querySelector('.def-card') && !seen.has(idx)) {
                seen.add(idx);
                words.push(idx);
            }
        });
    });
    return words;
}

function hideAllCards() {
    const visible = getVisibleWords();
    if (visible.length === 0) return;
    savedCards = visible;
    container.querySelectorAll('.word .def-card').forEach(card => {
        card.parentNode.removeChild(card);
    });
}

function showSavedCards() {
    if (savedCards.length === 0) return;
    const panes = container.querySelectorAll('.article-pane');
    savedCards.forEach(idx => {
        panes.forEach(pane => {
            const span = pane.querySelectorAll('.word')[idx];
            if (span && !span.querySelector('.def-card')) {
                showDefinition(span);
            }
        });
    });
}

toggleCardsBtn.addEventListener('click', function () {
    cardsHiddenMode = !cardsHiddenMode;
    if (cardsHiddenMode) {
        // 若有批注正处在编辑态，先提交，避免编辑卡被隐藏后状态悬空
        if (typeof noteEditingOffset !== 'undefined' && noteEditingOffset !== null) commitNoteEdit();
        hideAllCards();
    } else {
        showSavedCards();
    }
    syncToggleCardsBtn();
    markTabDirty();
});

// 初始按钮文字与默认模式（显示卡片）同步
syncToggleCardsBtn();
