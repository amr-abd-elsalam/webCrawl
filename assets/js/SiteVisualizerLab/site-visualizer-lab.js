// Mind & Machine - Site Visualizer Lab v6.0 (The Architect Update)
console.log("✅ Site Visualizer Lab v6.0 (The Architect Update) is loading...");

document.addEventListener("DOMContentLoaded", function() {
    'use strict';
    
    const CLUSTER_THRESHOLD = 500; // Nodes above this will trigger clustering option

    // State is managed globally for simplicity and inter-script communication
    window.svl = {
        network: null,
        fullSearchIndex: [],
        currentNodes: null,
        currentEdges: null,
        areLabelsVisible: true,
        originalNodeSettings: {},
        isPhysicsEnabled: true,
        isClustered: false,
    };

    const dom = {
        jsonInput: document.getElementById('jsonInput'),
        fileInput: document.getElementById('fileInput'),
        renderBtn: document.getElementById('renderBtn'),
        graphContainer: document.getElementById('site-graph-container'),
        placeholder: document.getElementById('visualizerPlaceholder'),
        viewModeButtons: document.querySelectorAll('[data-view-mode]'),
        searchInput: document.getElementById('visualizer-search'),
        toggleLabelsBtn: document.getElementById('toggleLabelsBtn'),
        togglePhysicsBtn: document.getElementById('togglePhysicsBtn'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        clusterGraphBtn: document.getElementById('clusterGraphBtn'),
        exportPngBtn: document.getElementById('exportPngBtn'),
    };

    function sanitizeHTML(str) {
        if (typeof str !== 'string' || !str) return '';
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    function truncateLabel(str, maxLength = 25) {
        if (!str || typeof str !== 'string') return '';
        return str.length > maxLength ? str.substring(0, maxLength) + '…' : str;
    }

    const getDepthColor = (depth) => {
        if (depth === null || typeof depth === 'undefined') return '#cccccc';
        if (!window.svl.fullSearchIndex || window.svl.fullSearchIndex.length === 0) return '#cccccc';
        const validDepths = window.svl.fullSearchIndex.map(p => p.seo?.crawlDepth).filter(d => typeof d === 'number');
        if (validDepths.length === 0) return '#cccccc';
        const maxDepth = Math.max(0, ...validDepths);
        if (depth === 0) return '#28a745';
        if (maxDepth <= 1) return '#0dcaf0';
        const percentage = depth / maxDepth;
        if (percentage <= 0.33) return '#0dcaf0';
        if (percentage <= 0.66) return '#ffc107';
        return '#dc3545';
    };
    window.svl.getDepthColor = getDepthColor;

    const stringToColor = (str) => {
        let hash = 0; if (!str) return '#cccccc';
        str.split('').forEach(char => { hash = char.charCodeAt(0) + ((hash << 5) - hash); });
        let color = '#'; for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF; color += `00${value.toString(16)}`.slice(-2);
        } return color;
    };
    window.svl.stringToColor = stringToColor;

    function populateSidebar(searchIndex, edges) {
        // ── Core stats ──
        document.getElementById('visualizer-total-pages').textContent = searchIndex.length;
        document.getElementById('visualizer-total-links').textContent = edges.length;

        // ── Extended stats ──
        let orphanCount = 0;
        let noindexCount = 0;
        let maxDepth = 0;
        let totalInlinks = 0;

        for (const page of searchIndex) {
            const seo = page.seo || {};
            if (seo.isOrphan) orphanCount++;
            if (seo.isNoIndex) noindexCount++;
            const depth = seo.crawlDepth || 0;
            if (depth > maxDepth) maxDepth = depth;
            totalInlinks += seo.internalLinkEquity || 0;
        }

        const avgInlinks = searchIndex.length > 0
            ? (totalInlinks / searchIndex.length).toFixed(1)
            : '0';

        document.getElementById('visualizer-orphan-pages').textContent = orphanCount;
        document.getElementById('visualizer-noindex-pages').textContent = noindexCount;
        document.getElementById('visualizer-max-depth').textContent = maxDepth;
        document.getElementById('visualizer-avg-inlinks').textContent = avgInlinks;

        // ── Smart Insights ──
        const insightsEl = document.getElementById('stats-insights');
        const insights = [];

        if (orphanCount > 0) {
            insights.push({
                icon: 'bi-exclamation-triangle-fill text-warning',
                text: `${orphanCount} صفحة يتيمة — أضف لها روابط داخلية لتحسين الزحف.`,
            });
        }
        if (noindexCount > 0) {
            insights.push({
                icon: 'bi-eye-slash-fill text-danger',
                text: `${noindexCount} صفحة ممنوعة من الفهرسة — تأكد أن هذا مقصود.`,
            });
        }
        if (maxDepth > 3) {
            insights.push({
                icon: 'bi-arrow-down-circle-fill text-info',
                text: `أعمق صفحة على بعد ${maxDepth} نقرات — حاول ألا تتجاوز 3.`,
            });
        }
        if (searchIndex.length > 0 && orphanCount === 0 && noindexCount === 0 && maxDepth <= 3) {
            insights.push({
                icon: 'bi-check-circle-fill text-success',
                text: 'بنية الموقع سليمة — لا مشاكل واضحة في الربط الداخلي.',
            });
        }

        if (insights.length > 0) {
            insightsEl.classList.remove('d-none');
            insightsEl.innerHTML = insights.map(i =>
                `<div class="insight-item"><i class="bi ${i.icon}"></i><span>${i.text}</span></div>`
            ).join('');
        } else {
            insightsEl.classList.add('d-none');
        }
        const pageList = document.getElementById('visualizer-page-list');
        pageList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const sortedIndex = [...searchIndex].sort((a, b) => (b.seo?.internalLinkEquity || 0) - (a.seo?.internalLinkEquity || 0));

        sortedIndex.forEach(page => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center list-group-item-action';
            li.dataset.nodeId = page.url;
            const pageTitle = page.title || page.url;
            li.dataset.pageTitle = pageTitle.toLowerCase();
            li.dataset.pageUrl = page.url.toLowerCase();
            const titleSpan = document.createElement('span');
            titleSpan.className = 'text-truncate';
            titleSpan.title = pageTitle;
            titleSpan.textContent = pageTitle;
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge bg-secondary rounded-pill';
            badgeSpan.textContent = page.seo?.internalLinkEquity || 0;
            li.appendChild(titleSpan);
            li.appendChild(badgeSpan);
            li.addEventListener('click', () => {
                if (window.svl.network && page.url) {
                    window.svl.network.focus(page.url, { scale: 1.2, animation: true });
                    window.svl.network.selectNodes([page.url]);
                }
            });
            fragment.appendChild(li);
        });
        pageList.appendChild(fragment);
    }

    function getFontSettings() {
        const isDarkMode = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        return isDarkMode
            ? { color: '#FFFFFF', face: 'Tahoma', strokeWidth: 2, strokeColor: '#212529', size: 14 }
            : { color: '#212529', face: 'Tahoma', strokeWidth: 4, strokeColor: '#FFFFFF', size: 14 };
    }
    window.svl.getFontSettings = getFontSettings;

    function resetUI() {
        if (window.svl.network) {
            window.svl.network.destroy();
            window.svl.network = null;
        }
        Object.assign(window.svl, { fullSearchIndex: [], originalNodeSettings: {}, isClustered: false });
        
        dom.graphContainer.classList.add('d-none');
        dom.placeholder.classList.remove('d-none');
        dom.toggleLabelsBtn.classList.add('d-none');
        dom.togglePhysicsBtn.classList.add('d-none');
        dom.fullscreenBtn.classList.add('d-none');
        dom.exportPngBtn.classList.add('d-none');
        dom.clusterGraphBtn.classList.add('d-none');

        document.getElementById('visualizer-page-list').innerHTML = '';
        document.getElementById('visualizer-total-pages').textContent = '0';
        document.getElementById('visualizer-total-links').textContent = '0';
        document.getElementById('visualizer-orphan-pages').textContent = '0';
        document.getElementById('visualizer-noindex-pages').textContent = '0';
        document.getElementById('visualizer-max-depth').textContent = '0';
        document.getElementById('visualizer-avg-inlinks').textContent = '0';
        const insightsEl = document.getElementById('stats-insights');
        if (insightsEl) { insightsEl.classList.add('d-none'); insightsEl.innerHTML = ''; }
        dom.searchInput.value = '';
    }

    function renderFromProcessedData({ fullSearchIndex, edges }) {
        try {
            resetUI();
            window.svl.fullSearchIndex = fullSearchIndex;
            
            dom.placeholder.classList.add('d-none');
            dom.graphContainer.classList.remove('d-none');
            dom.toggleLabelsBtn.classList.remove('d-none');
            dom.togglePhysicsBtn.classList.remove('d-none');
            dom.fullscreenBtn.classList.remove('d-none');
            dom.exportPngBtn.classList.remove('d-none');

            dom.viewModeButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelector('[data-view-mode="linkEquity"]').classList.add('active');

            createGraphData(edges);
            updateNodeDisplay('linkEquity');
            renderGraph();
            
        } catch (e) {
            resetUI();
            window.showToast?.(e.message, 'error');
            console.error("Rendering Error:", e);
        }
    }
    window.svl.renderFromProcessedData = renderFromProcessedData;

    function createGraphData(edges) {
        window.svl.currentNodes = new vis.DataSet();
        window.svl.currentEdges = new vis.DataSet(edges);
        
        const fontSettings = getFontSettings();
        const newNodes = window.svl.fullSearchIndex.map(page => {
            const tooltipElement = document.createElement('div');
            const pageTitle = page.title || page.url;
            const internalLinkEquity = page.seo?.internalLinkEquity || 0;
            const crawlDepth = page.seo?.crawlDepth ?? 'N/A';
            tooltipElement.innerHTML = `<b>${sanitizeHTML(pageTitle)}</b><br>الروابط الواردة: ${internalLinkEquity}<br>العمق: ${crawlDepth}`;
            return {
                id: page.url,
                value: 1 + internalLinkEquity,
                title: tooltipElement,
                label: truncateLabel(pageTitle),
                font: { ...fontSettings }
            };
        });
        window.svl.currentNodes.add(newNodes);
        
        populateSidebar(window.svl.fullSearchIndex, edges);
    }
    
    function updateNodeDisplay(displayMode, options = {}) {
        if (!window.svl.currentNodes) return;
        const fontSettings = getFontSettings();
        window.svl.originalNodeSettings = {};
        
        const nodesToUpdate = window.svl.fullSearchIndex.map(page => {
            const pageTitle = page.title || page.url;
            let newProperties = { id: page.url, font: { ...fontSettings } };
            
            switch (displayMode) {
                case 'crawlDepth':
                    newProperties.color = getDepthColor(page.seo?.crawlDepth);
                    newProperties.label = String(page.seo?.crawlDepth ?? 'N/A');
                    break;
                case 'topicCluster':
                    let color = '#cccccc'; // Default color
                    let matched = false;
                    if (options.rules && options.rules.length > 0) {
                        for (const rule of options.rules) {
                            try {
                                if (new RegExp(rule.pattern, 'i').test(page.url)) {
                                    color = rule.color;
                                    matched = true;
                                    break;
                                }
                            } catch(e) { /* Ignore invalid regex */ }
                        }
                    }
                    if (!matched) {
                        const firstSegment = page.url.split('/')[3] || 'homepage';
                        color = stringToColor(firstSegment);
                    }
                    newProperties.color = color;
                    break;
                case 'pageRank': {
                    const score = page.seo?._computed?.pageRankScore ?? 0;
                    // Gradient: low(blue #5bc0de) → mid(yellow #ffc107) → high(green #28a745)
                    let color;
                    if (score <= 50) {
                        const t = score / 50;
                        const r = Math.round(91 + (255 - 91) * t);
                        const g = Math.round(192 + (193 - 192) * t);
                        const b = Math.round(222 + (7 - 222) * t);
                        color = `rgb(${r},${g},${b})`;
                    } else {
                        const t = (score - 50) / 50;
                        const r = Math.round(255 + (40 - 255) * t);
                        const g = Math.round(193 + (167 - 193) * t);
                        const b = Math.round(7 + (69 - 7) * t);
                        color = `rgb(${r},${g},${b})`;
                    }
                    newProperties.color = color;
                    newProperties.value = 1 + (score / 10);
                    newProperties.label = String(score);
                    break;
                }
                case 'betweenness': {
                    const score = page.seo?._computed?.betweennessScore ?? 0;
                    // Gradient: low(grey #6c757d) → mid(orange #fd7e14) → high(red #dc3545)
                    let color;
                    if (score <= 50) {
                        const t = score / 50;
                        const r = Math.round(108 + (253 - 108) * t);
                        const g = Math.round(117 + (126 - 117) * t);
                        const b = Math.round(125 + (20 - 125) * t);
                        color = `rgb(${r},${g},${b})`;
                    } else {
                        const t = (score - 50) / 50;
                        const r = Math.round(253 + (220 - 253) * t);
                        const g = Math.round(126 + (53 - 126) * t);
                        const b = Math.round(20 + (69 - 20) * t);
                        color = `rgb(${r},${g},${b})`;
                    }
                    newProperties.color = color;
                    newProperties.value = 1 + (score / 10);
                    newProperties.label = String(score);
                    break;
                }
                case 'linkEquity':
                default:
                    newProperties.color = page.seo?.isOrphan ? '#f0ad4e' : (page.seo?.isNoIndex ? '#d9534f' : '#5bc0de');
                    newProperties.label = truncateLabel(pageTitle);
                    break;
            }
            window.svl.originalNodeSettings[page.url] = { color: newProperties.color, font: newProperties.font };
            return newProperties;
        });
        window.svl.currentNodes.update(nodesToUpdate);
    }
    window.svl.updateNodeDisplay = updateNodeDisplay;
    
    function clusterGraph() {
        if (!window.svl.network) return;
        window.svl.isClustered = true;
        const clusterOptions = {
            joinCondition: (nodeOptions) => {
                // Cluster nodes with more than 5 connections
                return window.svl.network.getConnectedEdges(nodeOptions.id).length > 5;
            },
            clusterNodeProperties: {
                shape: 'hexagon',
                color: '#ffc107',
                label: 'مجموعة',
                font: { size: 20 },
                allowSingleNodeCluster: true
            }
        };
        window.svl.network.cluster(clusterOptions);
        dom.clusterGraphBtn.innerHTML = '<i class="bi bi-grid-3x3-gap ms-2"></i> عرض كل العقد';
    }
    
    function unclusterGraph() {
        if (!window.svl.network || !window.svl.isClustered) return;
        
        // Open all clusters
        const clusterNodeIds = window.svl.network.body.nodeIndices.filter(id => window.svl.network.isCluster(id));
        clusterNodeIds.forEach(nodeId => {
            if (window.svl.network.isCluster(nodeId)) {
                window.svl.network.openCluster(nodeId);
            }
        });

        window.svl.isClustered = false;
        dom.clusterGraphBtn.innerHTML = '<i class="bi bi-grid-3x3-gap-fill ms-2"></i> تجميع العقد الكبيرة';
        window.enhancements.onNodeSelection([]); // Reset selection styles
    }


    function renderGraph() {
        const options = {
            nodes: { shape: 'dot' },
            edges: { scaling: { min: 0.5, max: 5 }, color: { inherit: 'from', opacity: 0.4 }, smooth: { type: 'continuous' } },
            physics: {
                enabled: true,
                forceAtlas2Based: { gravitationalConstant: -50, centralGravity: 0.01, springLength: 200, springConstant: 0.08, avoidOverlap: 0.5 },
                maxVelocity: 50,
                solver: 'forceAtlas2Based',
                stabilization: { iterations: 1000, fit: true, updateInterval: 25 }
            },
            interaction: { tooltipDelay: 200, hideEdgesOnDrag: true, navigationButtons: true, selectConnectedEdges: false },
        };
        window.svl.network = new vis.Network(dom.graphContainer, { nodes: window.svl.currentNodes, edges: window.svl.currentEdges }, options);
        
        window.svl.network.on("stabilizationIterationsDone", () => {
            window.svl.network.setOptions({ physics: false });
            window.svl.isPhysicsEnabled = false;
            dom.togglePhysicsBtn.innerHTML = '<i class="bi bi-activity ms-2"></i>إعادة تفعيل الحركة';
            dom.togglePhysicsBtn.classList.replace('btn-info', 'btn-outline-info');
        });

        // Handle clustering for large graphs
        if (window.svl.currentNodes.length > CLUSTER_THRESHOLD) {
            dom.clusterGraphBtn.classList.remove('d-none');
            unclusterGraph(); // Ensure it starts unclustered
        } else {
            dom.clusterGraphBtn.classList.add('d-none');
        }
    }

    function checkRenderButtonState() {
        const hasJson = dom.jsonInput.value.trim().length > 3;
        const hasFile = dom.fileInput.files.length > 0;
        const isDisabled = !hasJson && !hasFile;
        
        dom.renderBtn.disabled = isDisabled;
        dom.renderBtn.classList.toggle('disabled', isDisabled);
    }
    
    function initialize() {
        resetUI();
        
        dom.fileInput.addEventListener('change', checkRenderButtonState);
        dom.jsonInput.addEventListener('input', checkRenderButtonState);

        dom.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            if (!searchTerm) {
                document.querySelectorAll('#visualizer-page-list li').forEach(item => {
                    item.classList.remove('d-none');
                });
                return;
            }
            let firstMatch = null;
            document.querySelectorAll('#visualizer-page-list li').forEach(item => {
                const titleMatch = (item.dataset.pageTitle || '').includes(searchTerm);
                const urlMatch = (item.dataset.pageUrl || '').includes(searchTerm);
                const isVisible = titleMatch || urlMatch;
                item.classList.toggle('d-none', !isVisible);
                if (isVisible && !firstMatch) firstMatch = item;
            });
            // Auto-focus the first match in the graph
            if (firstMatch && window.svl.network) {
                const nodeId = firstMatch.dataset.nodeId;
                window.svl.network.focus(nodeId, { scale: 1.0, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
            }
        });

        dom.viewModeButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (!window.svl.network) return;
                const selectedNodes = window.svl.network.getSelectedNodes();
                dom.viewModeButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                updateNodeDisplay(button.dataset.viewMode);
                if (window.enhancements) window.enhancements.onNodeSelection(selectedNodes);
            });
        });

        dom.toggleLabelsBtn.addEventListener('click', () => {
            if (!window.svl.currentNodes) return;
            window.svl.areLabelsVisible = !window.svl.areLabelsVisible;
            const nodesToUpdate = window.svl.currentNodes.getIds().map(nodeId => ({
                id: nodeId,
                font: window.svl.areLabelsVisible ? window.svl.originalNodeSettings[nodeId]?.font : { size: 0 }
            }));
            window.svl.currentNodes.update(nodesToUpdate);
            dom.toggleLabelsBtn.innerHTML = window.svl.areLabelsVisible
                ? '<i class="bi bi-chat-text ms-2"></i>إخفاء العناوين'
                : '<i class="bi bi-chat-text-fill ms-2"></i>إظهار العناوين';
        });
        
        dom.togglePhysicsBtn.addEventListener('click', () => {
            if (!window.svl.network) return;
            window.svl.isPhysicsEnabled = !window.svl.isPhysicsEnabled;
            window.svl.network.setOptions({ physics: window.svl.isPhysicsEnabled });
            dom.togglePhysicsBtn.innerHTML = window.svl.isPhysicsEnabled
                ? '<i class="bi bi-pause-circle-fill ms-2"></i>إيقاف الحركة'
                : '<i class="bi bi-activity ms-2"></i>إعادة تفعيل الحركة';
            dom.togglePhysicsBtn.classList.toggle('btn-info', window.svl.isPhysicsEnabled);
            dom.togglePhysicsBtn.classList.toggle('btn-outline-info', !window.svl.isPhysicsEnabled);
        });
        
        dom.clusterGraphBtn.addEventListener('click', () => {
            if (window.svl.isClustered) {
                unclusterGraph();
            } else {
                clusterGraph();
            }
        });
        dom.exportPngBtn.addEventListener('click', () => {
            if (!window.svl.network) return;
            try {
                const networkCanvas = dom.graphContainer.querySelector('canvas');
                if (!networkCanvas) {
                    window.showToast?.('لا يوجد رسم بياني للتصدير.', 'error');
                    return;
                }
                // Create a new canvas with background
                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = networkCanvas.width;
                exportCanvas.height = networkCanvas.height;
                const ctx = exportCanvas.getContext('2d');

                // Fill background
                const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
                ctx.fillStyle = isDark ? '#1a1d21' : '#ffffff';
                ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

                // Draw the network canvas on top
                ctx.drawImage(networkCanvas, 0, 0);

                // Add watermark
                ctx.font = '14px Tahoma';
                ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';
                ctx.textAlign = 'right';
                ctx.fillText('Ai8V | Mind & Machine — Site Visualizer Lab', exportCanvas.width - 16, exportCanvas.height - 16);

                // Download
                const link = document.createElement('a');
                link.download = `site-structure-${new Date().toISOString().slice(0, 10)}.png`;
                link.href = exportCanvas.toDataURL('image/png');
                link.click();
                window.showToast?.('تم تصدير الخريطة بنجاح.', 'success');
            } catch (e) {
                console.error('Export error:', e);
                window.showToast?.('فشل التصدير: ' + e.message, 'error');
            }
        });

        dom.fullscreenBtn.addEventListener('click', () => {
            document.body.classList.toggle('fullscreen-mode');
            const isFullscreen = document.body.classList.contains('fullscreen-mode');
            const icon = dom.fullscreenBtn.querySelector('i');
            icon.className = isFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
            dom.fullscreenBtn.title = isFullscreen ? 'الخروج من وضع ملء الشاشة' : 'وضع ملء الشاشة';
            if (window.svl.network) setTimeout(() => window.svl.network.fit(), 300);
        });

        checkRenderButtonState();
    }

    initialize();
});
