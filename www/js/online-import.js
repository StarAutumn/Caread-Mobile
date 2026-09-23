// ================================================================
// 在线试卷：从懒笔记站点（english-exam.lazynote.cn）直接加载四六级真题
// - 数据源 1：sitemap-papers.xml → 解析出全部考次/套数，填充下拉框（不硬编码）
// - 数据源 2：整卷页 HTML（Nuxt SSR，静态正文）→ 提取整卷文字
// - 抓取经主进程 fetch-url 代理（带域名白名单），渲染进程无跨域限制
// - 提取的文本填入左侧输入框并自动渲染，随后可正常标注/查义
// ================================================================

const SITE_BASE = 'https://english-exam.lazynote.cn/';
const SITEMAP_URL = SITE_BASE + 'sitemap-papers.xml';

const onlineBtn = document.getElementById('onlineBtn');
const onlinePanel = document.getElementById('online-panel');
const onlineLoadBtn = document.getElementById('onlineLoadBtn');
const onlineCancelBtn = document.getElementById('onlineCancelBtn');
const examLevelSel = document.getElementById('examLevel');
const examYearSel = document.getElementById('examYear');
const examMonthSel = document.getElementById('examMonth');
const examSetSel = document.getElementById('examSet');

// 全部试卷索引 [{ level, year, month, set, url }]（set: 0=无套号后缀的单套卷）
let paperIndex = [];
let paperIndexPromise = null;

// ---------- 索引：拉取并解析 sitemap ----------
function loadPaperIndex() {
    if (paperIndexPromise) return paperIndexPromise;
    paperIndexPromise = (async () => {
        const res = await window.electronAPI.fetchUrl(SITEMAP_URL);
        if (!res.success) throw new Error(res.error);
        const doc = new DOMParser().parseFromString(res.text, 'text/xml');
        const locs = [...doc.querySelectorAll('loc')].map(l => l.textContent.trim());

        // 四六级：URL 形如 /cet4/paper/2023-06-1/listening/ → 按基础卷地址去重
        const map = new Map();
        const re = /english-exam\.lazynote\.cn\/(cet4|cet6)\/paper\/(\d{4})-(\d{2})(?:-(\d))?\/?/;
        locs.forEach(loc => {
            const m = loc.match(re);
            if (!m) return;
            const key = m[1] + '-' + m[2] + '-' + m[3] + '-' + (m[4] || '0');
            if (!map.has(key)) {
                map.set(key, {
                    level: m[1],
                    year: m[2],
                    month: m[3],
                    set: m[4] ? parseInt(m[4], 10) : 0,
                    variant: '',
                    url: `${SITE_BASE}${m[1]}/paper/${m[2]}-${m[3]}${m[4] ? '-' + m[4] : ''}/`
                });
            }
        });
        let index = [...map.values()];
        if (!index.length) throw new Error('未解析到任何试卷');

        // 无套号 URL 在多套考次里是"全 N 套"汇总列表页（无正文），剔除；
        // 仅当该考次完全不存在带套号卷时才保留为单套卷
        const hasSet = new Set(index.filter(p => p.set > 0).map(p => p.level + p.year + p.month));
        index = index.filter(p => p.set > 0 || !hasSet.has(p.level + p.year + p.month));

        // 考研英语：sitemap 不收录，从真题卷总入口页抓链接解析
        // 链接模式：/{year}-english-one（英语一）、/{year}-english-two（英语二）、/{year}（2010 前旧卷）
        try {
            const idxRes = await window.electronAPI.fetchUrl(SITE_BASE + 'exam-papers/');
            if (idxRes.success) {
                const seen = new Set();
                const reKy = /href="(\/kaoyan\/paper\/[^"]*)"/g;
                let m;
                while ((m = reKy.exec(idxRes.text)) !== null) {
                    const path = m[1].replace(/#.*$/, '');
                    if (seen.has(path)) continue;
                    seen.add(path);
                    const v = path.match(/^\/kaoyan\/paper\/(\d{4})(-english-(one|two))?\/$/);
                    if (!v) continue;
                    index.push({
                        level: 'kaoyan',
                        year: v[1],
                        month: '',
                        set: 0,
                        variant: v[3] || 'old',
                        url: SITE_BASE + path.replace(/^\//, '')
                    });
                }
            }
        } catch (e) { /* 考研索引获取失败不影响四六级 */ }

        paperIndex = index;
        return paperIndex;
    })().catch(err => {
        paperIndexPromise = null;   // 失败后允许重试
        throw err;
    });
    return paperIndexPromise;
}

// ---------- 面板：级联下拉 ----------
function fillSelect(sel, options, labels) {
    sel.innerHTML = '';
    options.forEach((value, i) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = labels ? labels[i] : value;
        sel.appendChild(opt);
    });
}

function isKaoyan() {
    return examLevelSel.value === 'kaoyan';
}

function selectedPapers() {
    return paperIndex.filter(p =>
        p.level === examLevelSel.value &&
        p.year === examYearSel.value &&
        (isKaoyan() || p.month === examMonthSel.value)
    );
}

function refreshYearOptions() {
    const kaoyan = isKaoyan();
    // 考研模式：无考次月份栏；卷别栏（英语一/二）替代套数栏
    examMonthSel.classList.toggle('hidden', kaoyan);
    const years = [...new Set(paperIndex.filter(p => p.level === examLevelSel.value).map(p => p.year))]
        .sort((a, b) => b.localeCompare(a));   // 最新年份在前
    fillSelect(examYearSel, years);
    refreshMonthOptions();
}

// 月份选项只按级别+年份过滤（此时月份尚未选定，不能用 selectedPapers）
function refreshMonthOptions() {
    if (isKaoyan()) {
        refreshSetOptions();
        return;
    }
    const months = [...new Set(paperIndex.filter(p =>
        p.level === examLevelSel.value && p.year === examYearSel.value
    ).map(p => p.month))]
        .sort((a, b) => b.localeCompare(a));   // 12 月在前
    fillSelect(examMonthSel, months, months.map(m => parseInt(m, 10) + ' 月'));
    refreshSetOptions();
}

function refreshSetOptions() {
    if (isKaoyan()) {
        // 考研：第三栏切换为英语一/英语二；2010 年前旧卷不区分，隐藏该栏
        const yearPapers = paperIndex.filter(p =>
            p.level === 'kaoyan' && p.year === examYearSel.value);
        const variants = [...new Set(yearPapers.map(p => p.variant))];
        if (variants.length <= 1) {
            examSetSel.innerHTML = '';
            examSetSel.dataset.variant = variants[0] || 'old';
            examSetSel.classList.add('hidden');
        } else {
            examSetSel.dataset.variant = '';
            examSetSel.classList.remove('hidden');
            fillSelect(examSetSel, variants,
                variants.map(v => v === 'one' ? '英语一' : '英语二'));
        }
        return;
    }
    examSetSel.classList.remove('hidden');
    const sets = selectedPapers().sort((a, b) => a.set - b.set);
    fillSelect(examSetSel,
        sets.map(p => String(p.set)),
        sets.map(p => '第 ' + Math.max(1, p.set) + ' 套'));
}

async function openOnlinePanel() {
    onlinePanel.classList.remove('hidden');
    fillSelect(examLevelSel, [], ['加载中…']);
    fillSelect(examYearSel, [], ['—']);
    fillSelect(examMonthSel, [], ['—']);
    fillSelect(examSetSel, [], ['—']);
    try {
        await loadPaperIndex();
        const levels = [...new Set(paperIndex.map(p => p.level))];
        fillSelect(examLevelSel, levels, levels.map(l =>
            l === 'cet4' ? '英语四级 (CET-4)' :
            l === 'cet6' ? '英语六级 (CET-6)' : '考研英语'));
        refreshYearOptions();
    } catch (err) {
        fillSelect(examLevelSel, [], ['加载失败']);
        showToast('试卷列表加载失败：' + err.message, 'error');
    }
}

function closeOnlinePanel() {
    onlinePanel.classList.add('hidden');
}

examLevelSel.addEventListener('change', refreshYearOptions);
examYearSel.addEventListener('change', refreshMonthOptions);
examMonthSel.addEventListener('change', refreshSetOptions);

onlineBtn.addEventListener('click', openOnlinePanel);
onlineCancelBtn.addEventListener('click', closeOnlinePanel);
// 点击面板外关闭
document.addEventListener('click', (e) => {
    if (!onlinePanel.classList.contains('hidden') &&
        !onlinePanel.contains(e.target) && e.target !== onlineBtn) {
        closeOnlinePanel();
    }
});

// ---------- 整卷文字提取 ----------
// 行内/跳过标签集合
const INLINE_TAGS = new Set(['SPAN', 'EM', 'STRONG', 'A', 'B', 'I', 'U', 'SMALL', 'SUP', 'SUB', 'CODE', 'MARK', 'LABEL', 'TIME']);

// 元素是否带下划线样式（考研翻译划线句等）
function isUnderline(el) {
    if (el.tagName === 'U') return true;
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    if (/\b(underline|underlined|u-line|underline-seg)\b/i.test(cls)) return true;
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    return /text-decoration[^;:]*:[^;]*underline/i.test(st);
}
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'NAV', 'HEADER', 'FOOTER']);

// 把 DOM 子树提取为文本行数组（保持原卷顺序）：
// - 行内元素文本续接当前行；块级元素独立成行（BR 强制换行）
// - 孤立短行（段落字母 "A)" / 题号 "1."）作为前缀并入下一行，贴近原卷排版
function extractLines(root) {
    const lines = [];
    let cur = '';
    let prefix = '';
    // 上一个行内片段结束后，与后续文本之间可能需要补一个空格
    // （闭包级变量：跨行内元素递归共享，兄弟 span 之间也能读到）
    let needSpace = false;

    function flush() {
        let text = cur.replace(/\s+/g, ' ').trim();
        if (text && prefix) text = prefix + ' ' + text;
        else if (!text) text = prefix;
        if (text) {
            // 孤立短标记行暂存为前缀（字母 A)~O)、题号 1.~99.）
            if (/^([A-O]\)|\d{1,2}\.)$/.test(text)) {
                prefix = text;
            } else {
                lines.push(text);
                prefix = '';
            }
        }
        cur = '';
        needSpace = false;
    }

    function walk(el) {
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent;
                // 相邻行内片段无空白时补空格（如 "A)" 与选项文字、"Part I" 与 "Writing"）；
                // cur 尾部可能挂着下划线开标记符，判断与插入都需绕过它
                const curPlain = cur.replace(/[\u0001\u0002]/g, '');
                if (needSpace && t.trim() && !/^\s/.test(t) &&
                    /[A-Za-z0-9)]$/.test(curPlain.trimEnd()) &&
                    /^[A-Za-z0-9(]/.test(t.trim()) &&
                    !/\s$/.test(curPlain)) {
                    const m = cur.match(/[\u0001\u0002]*$/);
                    const idx = cur.length - m[0].length;
                    cur = cur.slice(0, idx) + ' ' + cur.slice(idx);
                }
                needSpace = false;
                cur += t;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName;
                if (SKIP_TAGS.has(tag)) continue;
                if (tag === 'BR') { flush(); continue; }
                if (INLINE_TAGS.has(tag)) {
                    // 带下划线的行内片段：夹标记符，转 HTML 时还原为 <u>
                    const ul = isUnderline(node);
                    if (ul) cur += '\u0001';
                    walk(node);   // 行内元素：文本续接当前行
                    if (ul) cur += '\u0002';
                    needSpace = true;
                } else {
                    flush();      // 块级元素：先结束当前行
                    walk(node);
                    flush();
                }
            }
        }
    }

    walk(root);
    flush();
    return lines;
}

// HTML 转义
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 行转义 + 还原下划线标记（\u0001..\u0002 → <u>..</u>），空标记清理
function escLine(line) {
    return escHtml(line)
        .replace(/\u0001/g, '<u>')
        .replace(/\u0002/g, '</u>')
        .replace(/<u><\/u>/g, '');
}

// 按语义给行分类，生成排版 HTML（原卷层级：Part 大标题 / Section 小节 / Directions 说明 / 选项 / 正文段落）
function lineToHtml(line) {
    if (/^Part\s*[IVXivxⅠⅡⅢⅣⅤⅥ]+/.test(line)) {
        return '<h2 class="exam-part">' + escLine(line) + '</h2>';
    }
    // 小节标题：四六级 Section A~D，考研 Section I/II/III（罗马数字）
    if (/^Section\s+[A-DIVXivxⅠⅡⅢⅣⅤⅥ]+/i.test(line)) {
        return '<h3 class="exam-section">' + escLine(line) + '</h3>';
    }
    if (/^Directions[:：]?/i.test(line)) {
        return '<p class="exam-directions">' + escLine(line) + '</p>';
    }
    // 听力题组提示行
    if (/^Questions?\s+\d+/.test(line) && /based on/i.test(line)) {
        return '<p class="exam-note">' + escLine(line) + '</p>';
    }
    // 孤立题号行（由「题号 + A 选项」拆分而来）：紧贴下方选项组
    if (/^\d{1,2}\.$/.test(line)) {
        return '<p class="exam-qno">' + escLine(line) + '</p>';
    }
    // 选项行 / 词库行：四六级 "A) xxx"，考研 "[A] xxx"（可带题号前缀 "1."）
    if (/^(?:\d{1,2}\.\s*)?(?:\[[A-Oa-o]\]\s*|[A-O]\)\s)/.test(line)) {
        return '<p class="exam-option">' + escLine(line) + '</p>';
    }
    // 每大题下重复出现的卷面水印说明（"英语四级2023年6月·第1套真题"/"考研英语2023年真题"），跳过
    if (/^(英语(四级|六级)|考研英语).*真题$/.test(line) && line.length < 40) {
        return '';
    }
    return '<p>' + escLine(line) + '</p>';
}

// 答案速查区：合并表格提取出的零散行为 "题型：答案" 行，生成排版 HTML
function answersToHtml(aLines) {
    const out = [];
    let i = 0;
    while (i < aLines.length) {
        const line = aLines[i];
        if (!line) { i++; continue; }
        // 大标题
        if (/答案速查$/.test(line) && out.length === 0) {
            out.push('<h2 class="exam-part">' + escLine('—— ' + line + ' ——') + '</h2>');
            i++;
            continue;
        }
        // 表 caption / 表头两行 → 跳过
        if (/速查表$/.test(line) || line === '题型（卷面位置）' || line === '参考答案') {
            i++;
            continue;
        }
        // 说明段（以考试名开头且较长）
        if (/^(英语(四级|六级)|考研英语)/.test(line) && line.length > 40) {
            out.push('<p class="exam-directions">' + escLine(line) + '</p>');
            i++;
            continue;
        }
        // 题型名行：与下一行（答案串）合并
        if (i + 1 < aLines.length) {
            out.push('<p class="exam-answer"><strong>' + escLine(line) +
                '</strong>：' + escLine(aLines[i + 1]) + '</p>');
            i += 2;
        } else {
            out.push('<p class="exam-answer">' + escLine(line) + '</p>');
            i++;
        }
    }
    return out.join('\n');
}

// 整卷页 HTML → { text: 纯文本（填输入框）, html: 排版 HTML（渲染用）}
function extractPaper(pageHtml) {
    const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
    const lines = [];

    // 首选：整个卷面区块 section#paper（大题标题可能游离在 mod 容器之外，如 Part Ⅲ）
    const paperSec = doc.querySelector('section#paper');
    if (paperSec) {
        extractLines(paperSec).forEach(l => lines.push(l));
    } else {
        // 兜底：按大题容器逐个提取
        let mods = [...doc.querySelectorAll('div[id^="mod-"]')];
        if (!mods.length) mods = [...doc.querySelectorAll('[data-module-slug]')];
        if (!mods.length) throw new Error('页面中未找到试卷正文');
        mods.forEach(mod => {
            extractLines(mod).forEach(l => lines.push(l));
        });
    }

    // 答案速查表（单独区块）
    let answerHtml = '';
    const answers = doc.querySelector('section#answers, #answers');
    if (answers) {
        answerHtml = answersToHtml(extractLines(answers));
    }

    // 过滤站点 UI 残留文案（卷面模式切换按钮、页面副标题）
    const UI_LINE_RE = [/^整卷.*排版$/, /· 真题卷/];
    // 拆分「题号 + A 选项」同行：题号独立成行，A/B/C/D 选项保持对齐
    // （原卷排版中题号与 A 选项同行对齐，提取后粘连会导致 A 选项与其它选项不一致）
    const splitQno = (l) => {
        const m = l.match(/^(\d{1,2}\.)\s+((?:\[[A-Oa-o]\]|[A-O]\))\s.*)$/);
        return m ? [m[1], m[2]] : [l];
    };
    // 规范考研卷方括号选项标记："[ A ]xxx" → "[A] xxx"
    const contentLines = lines
        .filter(l => !UI_LINE_RE.some(re => re.test(l)))
        .map(l => l.replace(/\[\s*([A-Oa-o])\s*\]\s*/g, '[$1] '))
        .flatMap(splitQno);

    // 输入框纯文本：剥掉下划线标记符（不可见）
    const text = contentLines.map(l => l.replace(/[\u0001\u0002]/g, ''))
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // 渲染 HTML：标记还原为 <u>
    const html = contentLines.map(lineToHtml).filter(Boolean).join('\n') +
        (answerHtml ? '\n' + answerHtml : '');
    return { text, html };
}

// ---------- 加载动作 ----------
onlineLoadBtn.addEventListener('click', async () => {
    const level = examLevelSel.value, year = examYearSel.value;
    let paper;
    if (isKaoyan()) {
        // 考研：卷别下拉隐藏时（2010 前旧卷）取 variant 'old'
        const variant = examSetSel.classList.contains('hidden') ? 'old' : examSetSel.value;
        paper = paperIndex.find(p =>
            p.level === 'kaoyan' && p.year === year && p.variant === variant);
    } else {
        paper = paperIndex.find(p =>
            p.level === level && p.year === year &&
            p.month === examMonthSel.value && String(p.set) === examSetSel.value);
    }
    if (!paper) return;

    onlineLoadBtn.classList.add('loading');
    onlineLoadBtn.textContent = '加载中…';
    try {
        const res = await window.electronAPI.fetchUrl(paper.url);
        if (!res.success) throw new Error(res.error);

        const { text, html } = extractPaper(res.text);

        // 顶部卷名标题
        let titleText;
        if (isKaoyan()) {
            titleText = (paper.variant === 'one' ? '考研英语一 ' :
                paper.variant === 'two' ? '考研英语二 ' : '考研英语 ') + year + ' 年';
        } else {
            titleText = (level === 'cet4' ? '英语四级 ' : '英语六级 ') +
                year + ' 年 ' + parseInt(paper.month, 10) + ' 月 · 第 ' +
                Math.max(1, paper.set) + ' 套';
        }
        const titleHtml = '<h1 class="exam-title">' + escHtml(titleText) + '</h1>';

        // 开始页加载真题：先建标签承载（restoreWorkspace 会清空 textInput，之后再赋值）
        if (!getActiveTab()) createTab('未命名', emptyWorkspace());
        textInput.value = titleText + '\n\n' + text;
        renderStyledArticle(text, titleHtml + html);   // 排版渲染（标题不入分词文本）
        markTabDirty();
        closeOnlinePanel();
        showToast('已加载真题并渲染（来源：懒笔记）', 'success');
    } catch (err) {
        showToast('真题加载失败：' + err.message, 'error');
    } finally {
        onlineLoadBtn.classList.remove('loading');
        onlineLoadBtn.textContent = '加载真题';
    }
});
