// ================================================================
// 平台抽象层：浏览器 / Capacitor(安卓) 环境的 electronAPI 替身
// - Electron 桌面版：本文件直接返回，零行为变化（preload.js 供 API）
// - 浏览器/安卓：按桌面 preload.js 的方法签名实现同名接口，
//   js/*.js 各调用点无需任何改动
// 返回值结构与 main.js 各 ipcMain.handle 严格一致：
//   lookup-word  {translation} | {error}
//   open-file    {success, filePath, data} | {canceled} | {error}
//   save-file    {success, filePath} | {canceled} | {error}
//   import-file  {text, html} | {canceled} | {error}
//   fetch-url    {success, text} | {error}
// ================================================================
(function () {
    'use strict';
    if (window.electronAPI && typeof window.electronAPI.lookupWord === 'function') {
        return; // Electron 桌面版
    }

    // 标记非 Electron 环境：CSS 据此隐藏窗口控制按钮等桌面专属 UI
    document.documentElement.classList.add('no-electron');

    // ---------- 词典：懒加载 data/dict-slim.json（npm run build:dict 生成） ----------
    let dictPromise = null;
    function loadDict() {
        if (!dictPromise) {
            dictPromise = fetch('data/dict-slim.json')
                .then(r => { if (!r.ok) throw new Error('词典文件缺失（先运行 npm run build:dict）'); return r.json(); })
                .then(list => {
                    const map = new Map();
                    for (const pair of list) map.set(pair[0].toLowerCase(), pair[1]);
                    return map;
                })
                .catch(err => { dictPromise = null; throw err; });
        }
        return dictPromise;
    }

    // ---------- 文件选择 / 下载 ----------
    function pickFile(accept) {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept;
            input.onchange = () => resolve(input.files[0] || null);
            input.oncancel = () => resolve(null);
            input.click();
        });
    }

    function download(name, text) {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    // ---------- mammoth 浏览器构建按需加载（Word 导入） ----------
    let mammothPromise = null;
    function loadMammoth() {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        if (!mammothPromise) {
            mammothPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'node_modules/mammoth/mammoth.browser.min.js';
                s.onload = () => resolve(window.mammoth);
                s.onerror = () => { mammothPromise = null; reject(new Error('mammoth 加载失败')); };
                document.head.appendChild(s);
            });
        }
        return mammothPromise;
    }

    window.electronAPI = {
        // ---------- 查词 ----------
        async lookupWord(word) {
            try {
                const dict = await loadDict();
                const t = dict.get(String(word).toLowerCase());
                return t ? { translation: t } : { error: '未收录该词' };
            } catch (err) {
                return { error: '查询失败：' + err.message };
            }
        },

        // ---------- 打开工作区 ----------
        async openFile() {
            const f = await pickFile('.json,application/json');
            if (!f) return { canceled: true };
            try {
                const data = JSON.parse(await f.text());
                if (!data || typeof data !== 'object') return { error: '文件格式无效' };
                return { success: true, filePath: f.name, data };
            } catch (err) {
                return { error: '打开失败：' + err.message };
            }
        },

        // ---------- 保存工作区（浏览器为下载到本地） ----------
        async saveFile(data) {
            try {
                download('文章.caread.json', JSON.stringify(data, null, 2));
                return { success: true, filePath: '文章.caread.json（已下载）' };
            } catch (err) {
                return { error: '保存失败：' + err.message };
            }
        },

        // ---------- Word 导入（mammoth 浏览器版；自定义下划线样式表映射暂缺） ----------
        async importFile() {
            const f = await pickFile('.docx');
            if (!f) return { canceled: true };
            try {
                const mammoth = await loadMammoth();
                const buf = await f.arrayBuffer();
                const htmlResult = await mammoth.convertToHtml(
                    { buffer: buf },
                    {
                        includeDefaultStyleMap: true,
                        styleMap: [
                            'u => u',
                            "p[style-name='Normal'] => p:fresh",
                            "p[style-name='Heading 1'] => h1:fresh",
                            "p[style-name='Heading 2'] => h2:fresh",
                            "p[style-name='Heading 3'] => h3:fresh"
                        ],
                        convertImage: mammoth.images.imgElement(image =>
                            image.read('base64').then(b64 =>
                                ({ src: 'data:' + image.contentType + ';base64,' + b64 })))
                    }
                );
                const textResult = await mammoth.extractRawText({ buffer: buf });
                const cleanedText = textResult.value
                    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                    .replace(/\n\s*\n/g, '\n\n');
                return { text: cleanedText, html: htmlResult.value };
            } catch (err) {
                return { error: '文件解析失败：' + err.message };
            }
        },

        // ---------- 在线试卷抓取 ----------
        // Capacitor 原生 HTTP 无 CORS 限制；纯浏览器模式受 CORS 约束
        async fetchUrl(url) {
            try {
                if (typeof url !== 'string' ||
                    !/^https:\/\/english-exam\.lazynote\.cn\//.test(url)) {
                    return { error: '不允许访问该地址' };
                }
                const cap = window.Capacitor && window.Capacitor.Plugins &&
                    window.Capacitor.Plugins.CapacitorHttp;
                if (cap) {
                    const res = await cap.get({ url, headers: { 'User-Agent': 'Caread/1.0' } });
                    if (res.status < 200 || res.status >= 300) {
                        return { error: '请求失败：HTTP ' + res.status };
                    }
                    return { success: true, text: res.data };
                }
                const res = await fetch(url, { headers: { 'User-Agent': 'Caread/1.0' } });
                if (!res.ok) return { error: '请求失败：HTTP ' + res.status };
                return { success: true, text: await res.text() };
            } catch (err) {
                return { error: '网络请求失败：' + err.message };
            }
        },

        // ---------- 窗口/应用控制：浏览器环境为无害空实现 ----------
        winControl() { },
        quitApp() { },
        toggleDevTools() { },
        editCommand() { },
        onMenuAction() { },          // 浏览器无原生应用菜单
        onWindowState() { },         // 浏览器无窗口状态

        // ---------- 启动窗口状态：localStorage 持久化 ----------
        getLaunchState: async () => localStorage.getItem('launchWindowState') || 'normal',
        setLaunchState: (state) => {
            try { localStorage.setItem('launchWindowState', state); } catch (e) { /* 忽略 */ }
        }
    };
})();
