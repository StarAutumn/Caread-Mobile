// ================================================================
// 顶部提示通知（Toast）
// ================================================================
// type: 'success' | 'error' | 'info'
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);

    // 显示一段时间后向上渐变消失
    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('transitionend', () => toast.remove());
        // 兜底移除
        setTimeout(() => toast.remove(), 500);
    }, 2200);
}

// ================================================================
// 工作区：保存 / 打开 / 新建
// ================================================================
// 收集当前工作区完整状态
function buildSaveData() {
    const pane = container.querySelector('.article-pane');

    // 打开的卡片（第一个 pane 的单词索引）
    const openCards = [];
    if (pane) {
        pane.querySelectorAll('.word').forEach((w, i) => {
            if (w.querySelector('.def-card')) openCards.push(i);
        });
    }

    // 选中的选项
    const selectedOptions = [];
    container.querySelectorAll('.option-item.selected').forEach(item => {
        const letterSpan = item.querySelector('.option-letter');
        const letter = letterSpan ? letterSpan.dataset.letter : null;
        if (item.dataset.question && letter) {
            selectedOptions.push({ question: item.dataset.question, letter });
        }
    });

    // 颜色面板完整状态
    const colors = {};
    colorPanels.forEach(panel => {
        colors[panel.prefix] = {
            hsv: { ...panel.state.hsv },
            alpha: panel.state.alpha
        };
    });

    return {
        app: 'Caread',
        version: 1,
        source: { html: currentHtml || '', text: textInput.value },
        dualMode,
        highlights: collectHighlightRanges(),
        openCards,
        hiddenCards: savedCards.slice(),   // 被一键隐藏的卡片记忆（按标签隔离）
        cardsHidden: cardsHiddenMode,      // 是否处于「隐藏卡片」模式
        selectedOptions,
        outline: currentOutline.slice(),   // 大纲
        notes: noteAnnotations.slice(),    // 批注
        colors,
        penStrokes: typeof penSave === 'function' ? penSave() : [],
        scrollTop: pane ? pane.scrollTop : 0
    };
}

async function saveWorkspace() {
    if (!getActiveTab()) { showToast('当前没有可保存的标签', 'info'); return; }
    try {
        const result = await window.electronAPI.saveFile(buildSaveData());
        if (result.canceled) return;
        if (result.error) {
            showToast('保存失败：' + result.error, 'error');
        } else {
            showToast('已保存：' + result.filePath, 'success');
            // 记录保存路径并把标签标题更新为文件名
            const tab = getActiveTab();
            if (tab) {
                tab.filePath = result.filePath;
                tab.title = result.filePath.split(/[\\/]/).pop().replace(/\.json$/i, '') || tab.title;
                renderTabBar();
            }
            clearTabDirty();   // 保存成功，清除未保存标记
        }
    } catch (err) {
        console.error('保存异常:', err);
        showToast('保存出错：' + err.message, 'error');
    }
}

// ---------- 退出保存确认：有未保存改动或新建项目从未保存过时拦截 ----------
// 判定：任一标签有未保存标记，或所有标签都没有 filePath（新建未存）
function computeUnsavedState() {
    if (!tabs.length) return false;   // 无标签（开始页）：无可保存内容，静默退出
    const anyDirty = tabs.some(t => t.dirty);
    const neverSaved = !tabs.some(t => t.filePath);
    return anyDirty || neverSaved;
}

// 通用应用内确认框：确定 resolve(true)（标签关闭等场景）
function showAppConfirm(message, okLabel) {
    return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;';
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-input);border:1px solid var(--border-color);border-radius:12px;box-shadow:var(--shadow);padding:22px 26px;width:min(340px,86%);';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:14px;color:var(--text-primary);line-height:1.6;';
        msg.textContent = message;
        card.appendChild(msg);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;';
        const mkBtn = (label, act, primary) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.dataset.act = act;
            b.style.cssText = 'padding:6px 14px;border-radius:8px;font-size:13px;cursor:pointer;'
                + (primary
                    ? 'background:var(--btn-bg);color:#fff;border:none;'
                    : 'background:transparent;color:var(--text-secondary);border:1px solid var(--border-color);');
            return b;
        };
        row.appendChild(mkBtn('取消', 'cancel', false));
        row.appendChild(mkBtn(okLabel || '确定', 'ok', true));
        card.appendChild(row);
        ov.appendChild(card);
        ov.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            ov.remove();
            resolve(b.dataset.act === 'ok');
        });
        document.body.appendChild(ov);
    });
}

// 应用内样式退出确认框（桌面端由主进程 close 拦截后触发，取代原生弹框）
let exitModal = null;
function showExitConfirm() {
    return new Promise(resolve => {
        if (exitModal) { exitModal.remove(); exitModal = null; }
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;';
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-input);border:1px solid var(--border-color);border-radius:12px;box-shadow:var(--shadow);padding:22px 26px;width:min(340px,86%);';
        card.innerHTML = '<div style="font-size:15px;font-weight:700;color:var(--text-primary);">有未保存的更改</div>'
            + '<div style="font-size:13px;color:var(--text-secondary);margin-top:8px;">退出前是否保存当前工作区？</div>';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;';
        const mkBtn = (label, act, primary) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.dataset.act = act;
            b.style.cssText = 'padding:6px 14px;border-radius:8px;font-size:13px;cursor:pointer;'
                + (primary
                    ? 'background:var(--btn-bg);color:#fff;border:none;'
                    : 'background:transparent;color:var(--text-secondary);border:1px solid var(--border-color);');
            return b;
        };
        row.appendChild(mkBtn('取消', 'cancel', false));
        row.appendChild(mkBtn('直接退出', 'quit', false));
        row.appendChild(mkBtn('保存并退出', 'save', true));
        card.appendChild(row);
        ov.appendChild(card);
        ov.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            const act = b.dataset.act;
            ov.remove();
            exitModal = null;
            resolve(act);
        });
        document.body.appendChild(ov);
        exitModal = ov;
    });
}

// 桌面版：把标记同步给主进程（窗口 close 事件据此触发确认框）。
// 轮询 800ms——改动入口多（荧光/批注/画笔/标签…），轮询最省事可靠
let lastUnsaved = null;
if (window.electronAPI.setDirtyFlag) {
    setInterval(() => {
        const v = computeUnsavedState();
        if (v !== lastUnsaved) {
            lastUnsaved = v;
            window.electronAPI.setDirtyFlag(v);
        }
    }, 800);
    window.electronAPI.onConfirmExit(async () => {
        const act = await showExitConfirm();
        if (act === 'save') {
            await saveWorkspace();
            if (!computeUnsavedState()) window.electronAPI.quitApp(true);
        } else if (act === 'quit') {
            window.electronAPI.quitApp(true);
        }
        // cancel：留在应用，主进程已 preventDefault
    });
}

// 浏览器/平板：beforeunload 原生确认（桌面版走上面的弹框，不重复注册）
if (document.documentElement.classList.contains('no-electron')) {
    window.addEventListener('beforeunload', (e) => {
        if (computeUnsavedState()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

// 打开工作区并恢复全部状态
function restoreWorkspace(data) {
    if (!data || !data.source) return;

    if (typeof data.source.text === 'string') {
        textInput.value = data.source.text;
    }

    // 双屏模式
    dualMode = !!data.dualMode;
    dualToggleBtn.textContent = dualMode ? '📺 单屏' : '🖥️ 双屏';
    container.classList.toggle('dual', dualMode);

    // 渲染文章
    currentHtml = data.source.html || '';
    renderContent(currentHtml);

    // 清空打开前残留的高亮（renderContent 会保存旧状态，需丢弃）
    container.querySelectorAll('.article-pane').forEach(pane => {
        pane.querySelectorAll('.hl-run').forEach(run => unwrapRun(run));
    });

    // 恢复荧光笔
    restoreHighlightRanges(data.highlights || []);

    // 恢复颜色状态
    restoreColorState(data.colors);

    // 恢复打开的卡片（所有 pane 对应索引）
    const panes = container.querySelectorAll('.article-pane');
    (data.openCards || []).forEach(idx => {
        panes.forEach(pane => {
            const span = pane.querySelectorAll('.word')[idx];
            if (span && !span.querySelector('.def-card')) showDefinition(span);
        });
    });

    // 恢复该标签的「隐藏卡片模式」与被隐藏卡片记忆，并同步按钮文字
    savedCards = (data.hiddenCards || []).slice();
    cardsHiddenMode = !!data.cardsHidden;
    syncToggleCardsBtn();

    // 恢复选中的选项
    (data.selectedOptions || []).forEach(({ question, letter }) => {
        panes.forEach(pane => {
            const item = pane.querySelector(`.option-item[data-question="${question}"] .option-letter[data-letter="${letter}"]`);
            if (item) {
                const opt = item.closest('.option-item');
                if (opt) opt.classList.add('selected');
            }
        });
    });

    // 恢复大纲
    setOutline(data.outline);

    // 恢复批注（数据 + 卡片，renderContent 已执行过）
    setNoteAnnotations(data.notes);
    restoreNoteCards();

    // 恢复画笔笔迹（内容坐标，恢复到所有 pane）
    if (typeof penRestore === 'function') penRestore(data.penStrokes);

    // 恢复滚动位置
    if (typeof data.scrollTop === 'number') {
        const pane = container.querySelector('.article-pane');
        if (pane) pane.scrollTop = data.scrollTop;
    }
}

async function openWorkspace() {
    try {
        const result = await window.electronAPI.openFile();
        if (result.canceled) return;
        if (result.error) {
            showToast('打开失败：' + result.error, 'error');
            return;
        }
        // 同一文件已打开时直接切换到对应标签，避免重复
        const existing = tabs.find(t => t.filePath === result.filePath);
        if (existing) {
            switchTab(existing.id);
            showToast('已在标签中打开：' + result.filePath, 'success');
            return;
        }
        // 在新标签中打开
        const fileName = result.filePath.split(/[\\/]/).pop().replace(/\.json$/i, '') || '未命名';
        createTab(fileName, result.data, result.filePath);
        showToast('已打开：' + result.filePath, 'success');
    } catch (err) {
        console.error('打开异常:', err);
        showToast('打开出错：' + err.message, 'error');
    }
}

function newWorkspace() {
    if (!confirm('新建将创建一个空白标签，确定吗？')) return;
    createTab('未命名', emptyWorkspace());
}

// 监听菜单栏动作（新建 / 打开 / 保存 / 导出 PDF）
window.electronAPI.onMenuAction(action => {
    if (action === 'new') newWorkspace();
    else if (action === 'open') openWorkspace();
    else if (action === 'save') saveWorkspace();
    else if (action === 'export-pdf') exportWorkspace();
});

// ---------- 导出 PDF（仅通过菜单 文件 → 导出 PDF… / Ctrl+P 触发） ----------
async function exportWorkspace() {
    if (!getActiveTab()) { showToast('当前没有可导出的内容', 'info'); return; }
    try {
        const result = await window.electronAPI.exportPdf();
        // 用户取消保存对话框：静默退出，不弹提示
        if (result.canceled) return;
        if (result.error) {
            showToast('导出失败：' + result.error, 'error');
        } else {
            showToast('已导出：' + result.filePath, 'success');
        }
    } catch (err) {
        console.error('导出 PDF 异常:', err);
        showToast('导出出错：' + err.message, 'error');
    }
}

// ---------- 开始页面 ----------
const startNewBtn = document.getElementById('startNewBtn');
const startOpenBtn = document.getElementById('startOpenBtn');
const startImportBtn = document.getElementById('startImportBtn');

startNewBtn.addEventListener('click', () => {
    // 当前标签已是空白且无修改时，不再重复新建
    const cur = getActiveTab();
    if (cur && !cur.data.source.html && !cur.dirty) {
        showToast('当前已是空白标签', 'info');
        return;
    }
    createTab('未命名', emptyWorkspace());
});

startOpenBtn.addEventListener('click', openWorkspace);
startImportBtn.addEventListener('click', () => importBtn.click());

let renderTimer = null;
textInput.addEventListener('input', () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        // 开始页（无标签）首次输入：懒建标签承载内容
        // createTab 会经 restoreWorkspace 清空 textInput，需先留存再还原
        if (!getActiveTab()) {
            const text = textInput.value;
            createTab('未命名', emptyWorkspace());
            textInput.value = text;
            markTabDirty();
        }
        // 内容改变：按字符偏移的可恢复（高亮/批注），按像素的画笔笔迹无法对齐，清空
        if (typeof penClear === 'function') penClear();
        renderArticle(textInput.value, true);
    }, 300);
    markTabDirty();
});

importBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.importFile();
        // 用户取消选择文件对话框：静默退出，不弹提示
        if (result.canceled) return;
        if (result.error) {
            showToast('导入失败：' + result.error, 'error');
            return;
        }
        if (result.text) {
            // 开始页导入：先建标签承载（restoreWorkspace 会清空 textInput，之后再赋值）
            if (!getActiveTab()) createTab('未命名', emptyWorkspace());
            textInput.value = result.text;
            if (typeof penClear === 'function') penClear();
            if (result.html) {
                renderStyledArticle(result.text, result.html);
            } else {
                console.warn('未收到 HTML，使用纯文本渲染');
                renderArticle(result.text, false);
            }
        }
    } catch (err) {
        console.error('导入异常:', err);
        showToast('导入出错：' + err.message, 'error');
    }
});

// 初始化：仅显示开始页，不创建「未命名」标签；首次产生内容时再懒建（输入/导入/打开/新建）
renderArticle(textInput.value, false);
renderTabBar();

// ================================================================
// 首帧就绪握手：等页面 load 后连续两帧渲染完成，再通知主进程显示窗口。
// 提前显示会出现「显示 → 白 → 布局 → 白 → 内容」的连续白闪
// ================================================================
window.addEventListener('load', () => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (window.electronAPI && window.electronAPI.firstFrameReady) {
                window.electronAPI.firstFrameReady();
            }
        });
    });
});
