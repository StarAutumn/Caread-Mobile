// ================================================================
// 侧边栏折叠
// ================================================================
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');

let isExpanded = false;
sidebarToggle.addEventListener('click', function () {
    isExpanded = !isExpanded;
    sidebar.classList.toggle('expanded', isExpanded);
    sidebarToggle.textContent = isExpanded ? '◀' : '▶';
});

// ================================================================
// 顶部工具栏折叠
// ================================================================
const toolbar = document.getElementById('top-toolbar');
const toolbarToggle = document.getElementById('toolbarToggle');
let toolbarExpanded = true;

toolbarToggle.addEventListener('click', function () {
    toolbarExpanded = !toolbarExpanded;
    toolbar.classList.toggle('collapsed', !toolbarExpanded);
    toolbarToggle.textContent = toolbarExpanded ? '▲' : '▼';

    const newHeight = toolbarExpanded ? 56 : 4;
    document.documentElement.style.setProperty('--toolbar-height', newHeight + 'px');
});
