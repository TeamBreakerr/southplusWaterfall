// ==UserScript==
// @name         Level-Plus 瀑布流看图
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  在 level-plus.net 的帖子列表页，将帖子以一楼预览图的瀑布流形式展示，提升浏览效率。
// @author       Gemini
// @match        https://*.level-plus.net/thread.php*
// @match        https://*.south-plus.net/thread.php*
// @match        https://*.white-plus.net/thread.php*
// @match        https://*.summer-plus.net/thread.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      level-plus.net
// @connect      south-plus.net
// @connect      white-plus.net
// @connect      summer-plus.net
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- 脚本配置 ---
    // 瀑布流布局的列数（可以根据你的屏幕宽度调整）
    const WIDE_SCREEN_COLUMNS = 5;
    // --- 配置结束 ---

    // 1. 为瀑布流和控制按钮添加样式
    GM_addStyle(`
        #waterfall-container {
            column-count: ${WIDE_SCREEN_COLUMNS};
            column-gap: 15px;
            padding: 15px;
            background-color: #f0f2f5; /* 添加一个浅色背景，与论坛融为一体 */
        }
        .waterfall-item {
            display: inline-block;
            width: 100%;
            margin-bottom: 15px;
            break-inside: avoid; /* 防止元素在列中断开 */
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
            transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }
        .waterfall-item:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .waterfall-item a {
            text-decoration: none;
            color: #333;
            display: block;
        }
        .waterfall-item img {
            width: 100%;
            height: auto;
            display: block;
            border-bottom: 1px solid #eee;
            background-color: #fafafa; /* 图片加载前的占位背景色 */
        }
        .waterfall-item p {
            padding: 10px;
            margin: 0;
            font-size: 14px;
            line-height: 1.4;
            text-align: left;
            word-break: break-all;
        }
        #waterfall-controls {
            padding: 10px 20px;
            background-color: #f8f8f8;
            border-bottom: 1px solid #ddd;
            text-align: center;
            position: sticky;
            top: 0;
            z-index: 1001; /* 提高层级 */
        }
        .waterfall-btn {
            padding: 8px 15px;
            cursor: pointer;
            border: 1px solid #ccc;
            background-color: #fff;
            border-radius: 5px;
            font-size: 14px;
            font-weight: bold;
        }
        .waterfall-btn:hover {
            background-color: #e9e9e9;
            border-color: #bbb;
        }
        #waterfall-loading {
            text-align: center;
            padding: 50px;
            font-size: 18px;
            color: #555;
            width: 100%;
            column-span: all; /* 让加载提示横跨所有列 */
        }
        /* 响应式布局，自动调整列数 */
        @media (max-width: 1600px) { #waterfall-container { column-count: ${Math.max(1, WIDE_SCREEN_COLUMNS - 1)}; } }
        @media (max-width: 1200px) { #waterfall-container { column-count: ${Math.max(1, WIDE_SCREEN_COLUMNS - 2)}; } }
        @media (max-width: 992px) { #waterfall-container { column-count: ${Math.max(1, WIDE_SCREEN_COLUMNS - 3)}; } }
        @media (max-width: 768px) { #waterfall-container { column-count: 2; } }
        @media (max-width: 576px) { #waterfall-container { column-count: 1; } }
    `);

    // 2. 创建并插入控制按钮
    const mainTable = document.querySelector('#ajaxtable');
    if (!mainTable) {
        console.log('[瀑布流脚本] 未能找到帖子列表（#ajaxtable），脚本停止运行。');
        return;
    }

    const controlPanel = document.createElement('div');
    controlPanel.id = 'waterfall-controls';

    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-waterfall-btn';
    toggleButton.className = 'waterfall-btn';
    toggleButton.textContent = '🏞️ 切换瀑布流视图';

    controlPanel.appendChild(toggleButton);
    mainTable.parentNode.insertBefore(controlPanel, mainTable);

    let isWaterfallMode = false;
    let waterfallContainer = null;

    toggleButton.addEventListener('click', () => {
        isWaterfallMode = !isWaterfallMode;
        if (isWaterfallMode) {
            toggleButton.textContent = '📄 切换回列表视图';
            mainTable.style.display = 'none';

            // ** 关键修复 **
            // 之前版本会隐藏父容器`.t`，导致瀑布流无法显示。
            // 现在只精确隐藏分页`.t3`和页脚`#footer`。
            document.querySelectorAll('.t3, #footer').forEach(el => {
                el.style.display = 'none';
            });

            if (!waterfallContainer) {
                createWaterfallView();
            } else {
                waterfallContainer.style.display = 'block';
            }
        } else {
            toggleButton.textContent = '🏞️ 切换瀑布流视图';
            mainTable.style.display = 'table';
            if (waterfallContainer) {
                waterfallContainer.style.display = 'none';
            }
            // 恢复被隐藏的元素
            document.querySelectorAll('.t3, #footer').forEach(el => {
                el.style.display = '';
            });
        }
    });

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
        console.log(`[瀑布流脚本] 发现 ${threadRows.length} 个帖子行，开始处理...`);

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
            console.log('[瀑布流脚本] 未找到任何有效帖子链接。');
            return;
        }

        console.log(`[瀑布流脚本] 准备获取 ${fetchPromises.length} 个帖子的内容。`);

        Promise.allSettled(fetchPromises)
        .then(results => {
            loadingIndicator.style.display = 'none';
            let totalImageCount = 0;

            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    const pageData = result.value;
                    const doc = new DOMParser().parseFromString(pageData.html, 'text/html');
                    const firstPostContent = doc.querySelector('div.tpc_content');

                    if (!firstPostContent) {
                        console.log(`[瀑布流脚本] 在帖子 "${pageData.title}" 中未找到 "div.tpc_content" 容器。`);
                        return; // continue to next result
                    }

                    const images = firstPostContent.querySelectorAll('img');
                    if (images.length === 0) {
                         return; // 无图则跳过
                    }

                    const postImageContainer = document.createElement('div');
                    postImageContainer.className = 'waterfall-item';
                    const link = document.createElement('a');
                    link.href = pageData.url;
                    link.target = '_blank';
                    link.title = `点击查看原帖：${pageData.title}`;

                    let imagesAddedToPost = 0;
                    images.forEach(img => {
                        const imgSrc = img.getAttribute('src') || '';
                        // 通过图片路径过滤掉表情和UI图标
                        if (imgSrc.includes('/face/') || imgSrc.includes('/images/')) {
                            return;
                        }

                        const imageEl = document.createElement('img');
                        imageEl.src = new URL(imgSrc, pageData.url).href;
                        imageEl.loading = 'lazy'; // 使用图片懒加载，优化性能
                        imageEl.onerror = () => {
                            console.warn(`[瀑布流脚本] 图片加载失败: ${imageEl.src}`);
                            imageEl.style.display = 'none';
                        };

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

            console.log(`[瀑布流脚本] 处理完成，共加载了 ${totalImageCount} 张图片。`);

            if(totalImageCount === 0) {
                loadingIndicator.textContent = '分析了所有帖子，但未在主楼中发现可供预览的大图。';
                loadingIndicator.style.display = 'block';
            }
        });
    }

})();

