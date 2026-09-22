// ================================================================
// www 组装脚本：把 Web 资源按原相对路径复制到 www/，供 Capacitor 打包
// 运行：npm run build:www（需先 npm run build:dict 生成词典）
// ================================================================
const fs = require('fs');
const path = require('path');

// 本目录已独立于桌面版：Web 资源从 D:\EngRead 读取，组装进本目录 www/
const ROOT = path.join(__dirname, '..', 'EngRead');
const WWW = path.join(__dirname, 'www');

// [源, 目标（相对 www/）]，目标保持与 index.html 引用路径一致
const FILES = [
    ['index.html', 'index.html'],
    ['css', 'css'],
    ['js', 'js'],
    ['assets/icon-256.png', 'assets/icon-256.png'],   // 标题栏/开始页应用图标
    ['node_modules/quill/dist/quill.js', 'node_modules/quill/dist/quill.js'],
    ['node_modules/quill/dist/quill.snow.css', 'node_modules/quill/dist/quill.snow.css'],
    ['node_modules/mammoth/mammoth.browser.min.js', 'node_modules/mammoth/mammoth.browser.min.js'],
    // 瘦身词典由本工程 build-dict.js 生成到本目录 data/，不从桌面版读取
    [path.join(__dirname, 'data', 'dict-slim.json'), 'data/dict-slim.json']
];

function copy(src, dest) {
    const s = path.isAbsolute(src) ? src : path.join(ROOT, src);
    const d = path.join(WWW, dest);
    if (!fs.existsSync(s)) {
        console.warn('跳过（不存在）:', src);
        return;
    }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    if (fs.statSync(s).isDirectory()) {
        fs.cpSync(s, d, { recursive: true });
    } else {
        fs.copyFileSync(s, d);
    }
    console.log('复制:', src);
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
FILES.forEach(([src, dest]) => copy(src, dest));
console.log('\nwww/ 组装完成，可执行: npx cap sync');
