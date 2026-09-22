// ================================================================
// 词典瘦身脚本：node_modules/ecdict/data/dict.json (119MB 全量)
//   → data/dict-slim.json（仅 [word, translation] 有序对，浏览器/Capacitor 用）
// 运行：npm run build:dict
// ================================================================
const fs = require('fs');
const path = require('path');

// 本目录已独立于桌面版（D:\EngRead）：从桌面版 node_modules 读取全量词典
const SRC = path.join(__dirname, '..', 'EngRead', 'node_modules', 'ecdict', 'data', 'dict.json');
const DEST = path.join(__dirname, 'data', 'dict-slim.json');

console.log('读取全量词典…');
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const list = Array.isArray(raw) ? raw : Object.values(raw);
console.log('词条总数:', list.length);

const seen = new Set();
const pairs = [];
for (const e of list) {
    if (!e || !e.word || !e.translation) continue;
    const w = String(e.word).trim();
    const t = String(e.translation).trim();
    if (!w || !t) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;   // 小写去重：查询统一走小写键
    seen.add(key);
    pairs.push([w, t]);
}
pairs.sort((a, b) => a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1);

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, JSON.stringify(pairs));
console.log('写出', pairs.length, '条 →', DEST,
    '(' + (fs.statSync(DEST).size / 1048576).toFixed(1) + ' MB)');
