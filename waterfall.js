// ==UserScript==
// @name         Level-Plus 瀑布流看图
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  在 level-plus.net 的帖子列表页，将帖子以一楼预览图的瀑布流形式展示，并支持自定义列数和状态记忆。
// @author       Gemini
// @match        https://*.level-plus.net/thread.php*
// @match        https://*.south-plus.net/thread.php*
// @match        https://*.white-plus.net/thread.php*
// @match        https://*.summer-plus.net/thread.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      level-plus.net
// @connect      south-plus.net
// @connect      white-plus.net
// @connect      summer-plus.net
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 新功能：动态更新瀑布流列数的样式 ---
    let columnStyleElement = null;

    function updateWaterfallColumnStyles(columns) {
        if (!columnStyleElement) {
            columnStyleElement = document.createElement('style');
            columnStyleElement.id = 'waterfall-column-styles';
            document.head.appendChild(columnStyleElement);
        }
        columnStyleElement.textContent = `
            #waterfall-container { column-count: ${columns}; }
            @media (max-width: 1600px) { #waterfall-container { column-count: ${Math.max(1, columns - 1)}; } }
            @media (max-width: 1200px) { #waterfall-container { column-count: ${Math.max(1, columns - 2)}; } }
            @media (max-width: 992px) { #waterfall-container { column-count: ${Math.max(1, columns - 3)}; } }
            @media (max-width: 768px) { #waterfall-container { column-count: 2; } }
            @media (max-width: 576px) { #waterfall-container { column-count: 1; } }
        `;
    }

    // --- 读取用户保存的设置，或使用默认值 ---
    let savedColumnCount = GM_getValue('waterfall_columns', 5);
    updateWaterfallColumnStyles(savedColumnCount);

    // --- 静态样式（只添加一次） ---
    GM_addStyle(`
        #waterfall-container {
            column-gap: 15px; padding: 15px; background-color: #f0f2f5;
        }
        .waterfall-item {
            display: inline-block; width: 100%; margin-bottom: 15px;
            break-inside: avoid; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 8px; overflow: hidden; background: #fff;
            transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }
        .waterfall-item:hover {
            transform: translateY(-5px); box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .waterfall-item a { text-decoration: none; color: #333; display: block; }
        .waterfall-item img {
            width: 100%; height: auto; display: block;
            border-bottom: 1px solid #eee; background-color: #fafafa;
        }
        .waterfall-item p {
            padding: 10px; margin: 0; font-size: 14px;
            line-height: 1.4; text-align: left; word-break: break-all;
        }
        #waterfall-controls {
            padding: 10px 20px; background-color: #f8f8f8;
            border-bottom: 1px solid #ddd; display: flex;
            justify-content: center; align-items: center;
            gap: 15px; position: sticky; top: 0; z-index: 1001;
        }
        .waterfall-btn, .waterfall-save-btn {
            padding: 8px 15px; cursor: pointer; border: 1px solid #ccc;
            background-color: #fff; border-radius: 5px;
            font-size: 14px; font-weight: bold;
        }
        .waterfall-btn:hover, .waterfall-save-btn:hover {
            background-color: #e9e9e9; border-color: #bbb;
        }
        #waterfall-columns-input {
            width: 50px; text-align: center; padding: 7px;
            border: 1px solid #ccc; border-radius: 5px;
        }
        #save-feedback { color: green; font-weight: bold; transition: opacity 0.5s; }
        #waterfall-loading {
            text-align: center; padding: 50px; font-size: 18px;
            color: #555; width: 100%; column-span: all;
        }
    `);

    const mainTable = document.querySelector('#ajaxtable');
    if (!mainTable) {
        console.log('[瀑布流脚本] 未能找到帖子列表（#ajaxtable），脚本停止运行。');
        return;
    }

    // --- 创建控制面板 ---
    const controlPanel = document.createElement('div');
    controlPanel.id = 'waterfall-controls';
    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-waterfall-btn';
    toggleButton.className = 'waterfall-btn';
    const settingsLabel = document.createElement('label');
    settingsLabel.textContent = '每行个数: ';
    settingsLabel.style.fontWeight = 'bold';
    const columnsInput = document.createElement('input');
    columnsInput.type = 'number';
    columnsInput.id = 'waterfall-columns-input';
    columnsInput.min = '1';
    columnsInput.max = '10';
    columnsInput.value = savedColumnCount;
    const saveButton = document.createElement('button');
    saveButton.className = 'waterfall-save-btn';
    saveButton.textContent = '保存设置';
    const saveFeedback = document.createElement('span');
    saveFeedback.id = 'save-feedback';
    controlPanel.appendChild(toggleButton);
    controlPanel.appendChild(settingsLabel);
    controlPanel.appendChild(columnsInput);
    controlPanel.appendChild(saveButton);
    controlPanel.appendChild(saveFeedback);
    mainTable.parentNode.insertBefore(controlPanel, mainTable);

    // --- 全局状态变量 ---
    let isWaterfallMode = false;
    let waterfallContainer = null;

    // --- 核心视图切换功能 ---
    function enterWaterfallMode() {
        isWaterfallMode = true;
        GM_setValue('waterfall_mode_enabled', true);
        toggleButton.textContent = '📄 切换回列表视图';
        mainTable.style.display = 'none';

        if (!waterfallContainer) {
            createWaterfallView();
        } else {
            waterfallContainer.style.display = 'block';
        }
    }

    function exitWaterfallMode() {
        isWaterfallMode = false;
        GM_setValue('waterfall_mode_enabled', false);
        toggleButton.textContent = '🏞️ 切换瀑布流视图';
        mainTable.style.display = 'table';
        if (waterfallContainer) {
            waterfallContainer.style.display = 'none';
        }
    }

    // --- 事件监听 ---
    toggleButton.addEventListener('click', () => {
        if (isWaterfallMode) {
            exitWaterfallMode();
        } else {
            enterWaterfallMode();
        }
    });

    saveButton.addEventListener('click', () => {
        const newColumnCount = parseInt(columnsInput.value, 10);
        if (newColumnCount > 0 && newColumnCount <= 10) {
            GM_setValue('waterfall_columns', newColumnCount);
            updateWaterfallColumnStyles(newColumnCount);
            saveFeedback.textContent = '设置已保存！';
            setTimeout(() => { saveFeedback.textContent = ''; }, 2000);
        } else {
            alert('请输入1到10之间的数字。');
        }
    });

    // --- 页面加载时初始化 ---
    // 读取保存的模式状态，如果为true，则自动进入瀑布流模式
    if (GM_getValue('waterfall_mode_enabled', false)) {
        // 使用 setTimeout 确保在所有DOM元素都加载完毕后执行
        setTimeout(enterWaterfallMode, 0);
    } else {
        // 确保按钮文本在默认状态下是正确的
        toggleButton.textContent = '🏞️ 切换瀑布流视图';
    }


    /**
     * 主函数：创建瀑布流视图
     */
    function createWaterfallView() {
        waterfallContainer = document.createElement('div');
        waterfallContainer.id = 'waterfall-container';
        mainTable.parentNode.insertBefore(waterfallContainer, mainTable.nextSibling);

        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'waterfall-loading';
        loadingIndicator.textContent = '🚀 正在加载帖子预览图，请稍候...';
        waterfallContainer.appendChild(loadingIndicator);

        const threadRows = document.querySelectorAll('#ajaxtable tr.tr3.t_one');
        const fetchPromises = [];

        threadRows.forEach(row => {
            const threadLinkElement = row.querySelector('h3 a[id^="a_ajax_"]');
            if (threadLinkElement && threadLinkElement.href) {
                const threadUrl = new URL(threadLinkElement.href, window.location.origin).href;
                const threadTitle = threadLinkElement.textContent.trim();

                const promise = new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: threadUrl,
                        onload: function(response) {
                            if (response.status >= 200 && response.status < 400) {
                                resolve({html: response.responseText, title: threadTitle, url: threadUrl});
                            } else {
                                reject(`请求失败: ${threadUrl} (状态: ${response.status})`);
                            }
                        },
                        onerror: function(response) {
                            reject(`请求错误: ${threadUrl} (${response.statusText})`);
                        }
                    });
                });
                fetchPromises.push(promise);
            }
        });

        if (fetchPromises.length === 0) {
            loadingIndicator.textContent = '当前页面没有找到可以处理的帖子链接。';
            return;
        }

        Promise.allSettled(fetchPromises)
        .then(results => {
            loadingIndicator.style.display = 'none';
            let totalImageCount = 0;

            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    const pageData = result.value;
                    const doc = new DOMParser().parseFromString(pageData.html, 'text/html');
                    const firstPostContent = doc.querySelector('div.tpc_content');
                    if (!firstPostContent) return;

                    const images = firstPostContent.querySelectorAll('img');
                    if (images.length === 0) return;

                    const postImageContainer = document.createElement('div');
                    postImageContainer.className = 'waterfall-item';
                    const link = document.createElement('a');
                    link.href = pageData.url;
                    link.target = '_blank';
                    link.title = `点击查看原帖：${pageData.title}`;

                    let imagesAddedToPost = 0;
                    images.forEach(img => {
                        const imgSrc = img.getAttribute('src') || '';
                        if (imgSrc.includes('/face/') || imgSrc.includes('/images/')) {
                            return;
                        }

                        const imageEl = document.createElement('img');
                        imageEl.src = new URL(imgSrc, pageData.url).href;
                        imageEl.loading = 'lazy';
                        imageEl.onerror = () => imageEl.style.display = 'none';
                        link.appendChild(imageEl);
                        imagesAddedToPost++;
                    });

                    if (imagesAddedToPost > 0) {
                        const titleEl = document.createElement('p');
                        titleEl.textContent = pageData.title;
                        link.appendChild(titleEl);
                        postImageContainer.appendChild(link);
                        waterfallContainer.appendChild(postImageContainer);
                        totalImageCount += imagesAddedToPost;
                    }
                } else if (result.status === 'rejected') {
                    console.error("[瀑布流脚本] 加载帖子失败:", result.reason);
                }
            });

            if(totalImageCount === 0) {
                loadingIndicator.textContent = '分析了所有帖子，但未在主楼中发现可供预览的大图。';
                loadingIndicator.style.display = 'block';
            }
        });
    }
})();
