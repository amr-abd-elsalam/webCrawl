// Mind & Machine - Site Visualizer Lab Enhancements v4.0 (The Performance & Insight Update)
console.log("✅ Visualizer Enhancements v4.0 is loading...");

document.addEventListener("DOMContentLoaded", function() {
    'use strict';

    let visualizerWorker;

    const dom = {
        fileInput: document.getElementById('fileInput'),
        jsonInput: document.getElementById('jsonInput'),
        renderBtn: document.getElementById('renderBtn'),
        renderBtnText: document.querySelector('#renderBtn .btn-text'),
        renderBtnSpinner: document.querySelector('#renderBtn .spinner-border'),
        loadSampleDataBtn: document.getElementById('loadSampleDataBtn'),
        legendContainer: document.getElementById('view-legend'),
        viewModeButtons: document.querySelectorAll('[data-view-mode]'),
        viewModesGroup: document.getElementById('view-modes-group'),
        topicClusterControls: document.getElementById('topic-cluster-controls'),
        clusterRulesContainer: document.getElementById('cluster-rules-container'),
        addClusterRuleBtn: document.getElementById('addClusterRuleBtn'),
        applyClusterRulesBtn: document.getElementById('applyClusterRulesBtn'),
        clusterRuleTemplate: document.getElementById('cluster-rule-template'),
        inspector: {
            placeholder: document.getElementById('inspector-placeholder'),
            details: document.getElementById('inspector-details'),
            title: document.getElementById('inspector-title'),
            url: document.getElementById('inspector-url'),
            depth: document.getElementById('inspector-depth'),
            inlinks: document.getElementById('inspector-inlinks'),
            outlinks: document.getElementById('inspector-outlinks'),
            status: document.getElementById('inspector-status'),
        },
        toast: {
            el: document.getElementById('appToast'),
            instance: null,
            icon: document.getElementById('toast-icon'),
            title: document.getElementById('toast-title'),
            body: document.getElementById('toast-body'),
        }
    };

    window.enhancements = {
        showToast(message, type = 'error', title = null) {
            if (!dom.toast.el) return;
            if (!dom.toast.instance) {
                dom.toast.instance = new bootstrap.Toast(dom.toast.el, { delay: 6000 });
            }
            dom.toast.body.textContent = message;
            if (type === 'error') {
                dom.toast.title.textContent = title || 'خطأ';
                dom.toast.icon.className = 'bi bi-exclamation-triangle-fill text-danger me-2';
            } else if (type === 'success') {
                dom.toast.title.textContent = title || 'نجاح';
                dom.toast.icon.className = 'bi bi-check-circle-fill text-success me-2';
            } else {
                 dom.toast.title.textContent = title || 'معلومة';
                 dom.toast.icon.className = 'bi bi-info-circle-fill text-info me-2';
            }
            dom.toast.instance.show();
        },
        
        setLoadingState(isLoading) {
            if (isLoading) {
                dom.renderBtnText.textContent = 'جاري المعالجة...';
                dom.renderBtnSpinner.classList.remove('d-none');
                dom.renderBtn.disabled = true;
                dom.loadSampleDataBtn.disabled = true;
            } else {
                dom.renderBtnText.innerHTML = '<i class="bi bi-play-fill ms-2" aria-hidden="true"></i> عرض وتحليل البنية';
                dom.renderBtnSpinner.classList.add('d-none');
                dom.renderBtn.disabled = false;
                dom.loadSampleDataBtn.disabled = false;
            }
        },
            handleProcessedData(data, pageCount) {
            const WARN_THRESHOLD = 500;
            const HARD_LIMIT = 2000;

            if (pageCount > HARD_LIMIT) {
                // Trim to top pages by internalLinkEquity
                const trimmed = [...data.fullSearchIndex]
                    .sort((a, b) => (b.seo?.internalLinkEquity || 0) - (a.seo?.internalLinkEquity || 0))
                    .slice(0, HARD_LIMIT);
                
                const keptUrls = new Set(trimmed.map(p => p.url));
                const filteredEdges = data.edges.filter(e => keptUrls.has(e.from) && keptUrls.has(e.to));

                this.showToast(
                    `الموقع يحتوي ${pageCount} صفحة. تم عرض أهم ${HARD_LIMIT} صفحة لضمان أداء سلس. للتحليل الكامل، استخدم طبقة المجموعات لتصفية الأقسام.`,
                    'info',
                    'تم تقليص البيانات'
                );
                window.svl.renderFromProcessedData({ fullSearchIndex: trimmed, edges: filteredEdges, communityStats: data.communityStats });
                this.onGraphRendered();
                return;
            }

            if (pageCount > WARN_THRESHOLD) {
                this.showToast(
                    `${pageCount} صفحة — قد يستغرق الرسم بضع ثوانٍ. سيتم تفعيل التجميع تلقائياً لتحسين الأداء.`,
                    'info',
                    'موقع كبير'
                );
            } else {
                this.showToast('تمت معالجة البيانات بنجاح، جاري الآن رسم الخريطة.', 'success');
            }

            window.svl.renderFromProcessedData({ fullSearchIndex: data.fullSearchIndex, edges: data.edges, communityStats: data.communityStats });
            this.onGraphRendered();
        },

        processWithWorker(fileContent, fileType) {
            if (!fileContent) {
                this.showToast('لا توجد بيانات للمعالجة.', 'error');
                return;
            }
            this.setLoadingState(true);
            this.showToast('بدأت معالجة البيانات في الخلفية...', 'info', 'جاري العمل');
            visualizerWorker.postMessage({ fileContent, fileType });
        },
        
        updateLegend(mode, rules = []) {
            let legendHtml = '';
            const createSwatch = (color, text) => `<li><span class="legend-color-swatch" style="background-color: ${color};"></span> ${text}</li>`;
            
            switch (mode) {
                case 'crawlDepth':
                    legendHtml = `<ul>
                        ${createSwatch(window.svl.getDepthColor(0), 'الرئيسية')}
                        ${createSwatch(window.svl.getDepthColor(1), 'قريب')}
                        ${createSwatch(window.svl.getDepthColor(5), 'متوسط')}
                        ${createSwatch(window.svl.getDepthColor(10), 'بعيد')}
                    </ul>`;
                    break;
                case 'topicCluster':
                    if (rules.length > 0) {
                        let rulesHtml = rules.map(rule => {
                             try {
                                 const pattern = new RegExp(rule.pattern).source;
                                 return createSwatch(rule.color, pattern);
                             } catch (e) {
                                 return createSwatch('#888', 'قاعدة غير صالحة');
                             }
                        }).join('');
                        legendHtml = `<ul>${rulesHtml}${createSwatch('#cccccc', 'أخرى')}</ul>`;
                    } else {
                         legendHtml = `<p class="mb-0 small text-muted">يتم تلوين كل قسم (حسب المسار) بلون فريد.</p>`;
                    }
                    break;
                                    case 'pageRank':
                    legendHtml = `<ul>
                        ${createSwatch('#5bc0de', 'منخفض (0)')}
                        ${createSwatch('#ffc107', 'متوسط (50)')}
                        ${createSwatch('#28a745', 'مرتفع (100)')}
                    </ul><p class="mb-0 mt-1 small text-muted">الرقم على كل عقدة يمثل نقاط القوة (0–100). الحجم يتناسب مع القيمة.</p>`;
                    break;
                case 'betweenness':
                    legendHtml = `<ul>
                        ${createSwatch('#6c757d', 'طرفية (0)')}
                        ${createSwatch('#fd7e14', 'معتدلة (50)')}
                        ${createSwatch('#dc3545', 'جسر حرج (100)')}
                    </ul><p class="mb-0 mt-1 small text-muted">الرقم يمثل أهمية الصفحة كجسر بين أقسام الموقع. القيمة العالية = نقطة اختناق.</p>`;
                    break;

                case 'community': {
                    const stats = window.svl.communityStats;
                    if (!stats) {
                        legendHtml = '<p class="mb-0 small text-muted">لا توجد بيانات مجتمعات.</p>';
                        break;
                    }
                    // Count pages per community
                    const commCounts = {};
                    (window.svl.fullSearchIndex || []).forEach(p => {
                        const cId = p.seo?._computed?.communityId ?? 0;
                        commCounts[cId] = (commCounts[cId] || 0) + 1;
                    });
                    // Sort by size descending
                    const sorted = Object.entries(commCounts).sort((a, b) => b[1] - a[1]);
                    let itemsHtml = sorted.map(([cId, count]) => {
                        const color = window.svl.communityColors[cId] || '#cccccc';
                        return `<div class="community-legend-item"><span class="legend-color-swatch" style="background-color: ${color};"></span>مجتمع ${parseInt(cId) + 1} (${count})</div>`;
                    }).join('');

                    const qualityLabel = stats.modularity >= 0.5 ? 'ممتاز' : stats.modularity >= 0.3 ? 'جيد' : 'ضعيف';
                    legendHtml = `<div class="community-legend-grid">${itemsHtml}</div>
                    <p class="mb-0 mt-2 small text-muted">تم اكتشاف <strong>${stats.count}</strong> مجتمع — جودة التقسيم (Modularity): <strong>${stats.modularity}</strong> (${qualityLabel}). المجتمعات تُكتشف تلقائياً بخوارزمية Louvain بناءً على بنية الروابط الفعلية.</p>`;
                    break;
                }
                case 'linkEquity':
                default:

                    legendHtml = `<ul>
                        ${createSwatch('#5bc0de', 'صفحة عادية')}
                        ${createSwatch('#f0ad4e', 'صفحة يتيمة')}
                        ${createSwatch('#d9534f', 'صفحة NoIndex')}
                    </ul>`;
                    break;
            }
            dom.legendContainer.innerHTML = legendHtml;
        },

        updateInspector(nodeId) {
            if (!nodeId || !window.svl?.fullSearchIndex) {
                dom.inspector.details.classList.add('d-none');
                dom.inspector.placeholder.classList.remove('d-none');
                return;
            }
            
            const page = window.svl.fullSearchIndex.find(p => p.url === nodeId);
            if (!page) return;

            const seo = page.seo || {};
            const analysis = seo.contentAnalysis || {};
            const computed = seo._computed || {};

            dom.inspector.title.textContent = page.title || page.url;
            dom.inspector.title.title = page.title || page.url;
            dom.inspector.url.href = page.url;
            dom.inspector.depth.textContent = seo.crawlDepth ?? 'N/A';
            dom.inspector.inlinks.textContent = seo.internalLinkEquity || 0;
            dom.inspector.outlinks.textContent = analysis.outgoingInternalLinks?.length || 0;
            
            let statusText = 'عادية';
            if (seo.isNoIndex) statusText = 'NoIndex';
            else if (seo.isOrphan) statusText = 'يتيمة';
            dom.inspector.status.textContent = statusText;

            // PageRank & Betweenness scores
            const prEl = document.getElementById('inspector-pagerank');
            const bcEl = document.getElementById('inspector-betweenness');
            if (prEl) prEl.textContent = computed.pageRankScore ?? 'N/A';
            if (bcEl) bcEl.textContent = computed.betweennessScore ?? 'N/A';

            const communityEl = document.getElementById('inspector-community');
            const communityDot = document.getElementById('inspector-community-dot');
            if (communityEl) {
                const cId = computed.communityId ?? 'N/A';
                communityEl.textContent = typeof cId === 'number' ? 'مجتمع ' + (cId + 1) : 'N/A';
                if (communityDot && typeof cId === 'number') {
                    communityDot.style.backgroundColor = window.svl.communityColors?.[cId] || '#cccccc';
                }
            }

            // ── Build Inlinks list ──
            const inlinksItems = document.getElementById('inspector-inlinks-items');
            const inlinksCount = document.getElementById('inspector-inlinks-count');
            const outlinksItems = document.getElementById('inspector-outlinks-items');
            const outlinksCount = document.getElementById('inspector-outlinks-count');

            if (inlinksItems && outlinksItems) {
                // Find pages that link TO this page
                const incomingPages = window.svl.fullSearchIndex.filter(p => 
                    p.url !== nodeId && 
                    (p.seo?.contentAnalysis?.outgoingInternalLinks || []).includes(nodeId)
                );
                
                inlinksCount.textContent = incomingPages.length;
                inlinksItems.innerHTML = '';
                
                const inFragment = document.createDocumentFragment();
                incomingPages.forEach(p => {
                    const li = document.createElement('li');
                    li.className = 'list-group-item list-group-item-action text-truncate';
                    li.textContent = p.title || p.url;
                    li.title = p.url;
                    li.addEventListener('click', () => {
                        if (window.svl.network) {
                            window.svl.network.focus(p.url, { scale: 1.2, animation: true });
                            window.svl.network.selectNodes([p.url]);
                            this.onNodeSelection([p.url]);
                        }
                    });
                    inFragment.appendChild(li);
                });
                inlinksItems.appendChild(inFragment);

                // ── Build Outlinks list ──
                const outgoingUrls = analysis.outgoingInternalLinks || [];
                const pageMap = new Map(window.svl.fullSearchIndex.map(p => [p.url, p]));
                const outgoingPages = outgoingUrls
                    .filter(url => url !== nodeId && pageMap.has(url))
                    .map(url => pageMap.get(url));
                
                outlinksCount.textContent = outgoingPages.length;
                outlinksItems.innerHTML = '';
                
                const outFragment = document.createDocumentFragment();
                outgoingPages.forEach(p => {
                    const li = document.createElement('li');
                    li.className = 'list-group-item list-group-item-action text-truncate';
                    li.textContent = p.title || p.url;
                    li.title = p.url;
                    li.addEventListener('click', () => {
                        if (window.svl.network) {
                            window.svl.network.focus(p.url, { scale: 1.2, animation: true });
                            window.svl.network.selectNodes([p.url]);
                            this.onNodeSelection([p.url]);
                        }
                    });
                    outFragment.appendChild(li);
                });
                outlinksItems.appendChild(outFragment);
            }

            dom.inspector.placeholder.classList.add('d-none');
            dom.inspector.details.classList.remove('d-none');
        },
        
        onNodeSelection(nodeIds) {
            const nodeId = nodeIds.length > 0 ? nodeIds[0] : null;
            this.updateInspector(nodeId);

            document.querySelectorAll('#visualizer-page-list li').forEach(li => {
                const isActive = li.dataset.nodeId === nodeId;
                li.classList.toggle('active', isActive);
                if (isActive) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            
            if (!window.svl.network || !window.svl.currentNodes) return;
            
            const prevDimmed = window.svl._dimmedNodeIds;
            const prevHidden = window.svl._hiddenEdgeIds;

            if (!nodeId) { // Reset — only restore previously dimmed nodes
                 if (window.svl.isClustered) return;
                if (prevDimmed.size > 0) {
                    const nodesToRestore = [];
                    for (const id of prevDimmed) {
                        const orig = window.svl.originalNodeSettings[id];
                        if (orig) nodesToRestore.push({ id, color: orig.color, font: window.svl.areLabelsVisible ? orig.font : { size: 0 } });
                    }
                    if (nodesToRestore.length > 0) window.svl.currentNodes.update(nodesToRestore);
                }
                if (prevHidden.size > 0) {
                    const edgesToShow = [];
                    for (const id of prevHidden) edgesToShow.push({ id, hidden: false });
                    window.svl.currentEdges.update(edgesToShow);
                }
                window.svl._dimmedNodeIds = new Set();
                window.svl._hiddenEdgeIds = new Set();
            } else {
                const connectedNodes = new Set([nodeId, ...window.svl.network.getConnectedNodes(nodeId)]);
                const connectedEdgeIds = new Set(window.svl.network.getConnectedEdges(nodeId));
                const dimColor = 'rgba(200, 200, 200, 0.1)';
                const dimBorder = 'rgba(200,200,200,0.2)';

                const newDimmed = new Set();
                const nodesToUpdate = [];

                // Nodes that were dimmed but should now be restored
                for (const id of prevDimmed) {
                    if (connectedNodes.has(id)) {
                        const orig = window.svl.originalNodeSettings[id];
                        if (orig) nodesToUpdate.push({ id, color: orig.color, font: window.svl.areLabelsVisible ? orig.font : { size: 0 } });
                    }
                }

                // Nodes that should be dimmed now
                const allNodeIds = window.svl.currentNodes.getIds();
                for (const id of allNodeIds) {
                    if (!connectedNodes.has(id)) {
                        newDimmed.add(id);
                        if (!prevDimmed.has(id)) { // Only update if not already dimmed
                            nodesToUpdate.push({ id, color: { background: dimColor, border: dimBorder }, font: { color: dimColor, strokeWidth: 0 } });
                        }
                    }
                }

                if (nodesToUpdate.length > 0) window.svl.currentNodes.update(nodesToUpdate);

                // Edges — only update changed ones
                const newHidden = new Set();
                const edgesToUpdate = [];
                const allEdges = window.svl.currentEdges.getIds();
                for (const eid of allEdges) {
                    const shouldHide = !connectedEdgeIds.has(eid);
                    if (shouldHide) newHidden.add(eid);
                    const wasHidden = prevHidden.has(eid);
                    if (shouldHide !== wasHidden) {
                        edgesToUpdate.push({ id: eid, hidden: shouldHide });
                    }
                }
                if (edgesToUpdate.length > 0) window.svl.currentEdges.update(edgesToUpdate);

                window.svl._dimmedNodeIds = newDimmed;
                window.svl._hiddenEdgeIds = newHidden;
            }
        },

        onGraphRendered() {
            if (!window.svl.network) return;
            this.updateLegend('linkEquity');
            this.updateInspector(null);
            
            window.svl.network.off('selectNode');
            window.svl.network.off('deselectNode');
            window.svl.network.off('click');

            window.svl.network.on('selectNode', (params) => this.onNodeSelection(params.nodes));
            window.svl.network.on('deselectNode', () => this.onNodeSelection([]));
            window.svl.network.on('click', (params) => {
                if (params.nodes.length === 0 && params.edges.length === 0) {
                    window.svl.network.unselectAll();
                    this.onNodeSelection([]);
                }
            });
        },

        autoLoadFromSession() {
            const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
            try {
                const raw = localStorage.getItem('ai8v_crawl_data');
                if (!raw || raw.length < 10) return;

                const envelope = JSON.parse(raw);

                // ── Format v1: { version, timestamp, data[] } ──
                if (envelope && envelope.version === 1 && Array.isArray(envelope.data)) {
                    // Check expiry
                    if (Date.now() - envelope.timestamp > MAX_AGE_MS) {
                        localStorage.removeItem('ai8v_crawl_data');
                        return;
                    }
                    const pages = envelope.data;
                    if (pages.length === 0 || !pages[0].url || !pages[0].seo) {
                        this.showToast('بيانات الجلسة لا تتوافق مع الصيغة المطلوبة.', 'error', 'خطأ في التحميل التلقائي');
                        return;
                    }
                    const jsonString = JSON.stringify(pages, null, 2);
                    dom.jsonInput.value = jsonString;
                    this.showToast(
                        `تم تحميل بيانات الزحف تلقائياً (${pages.length} صفحة). جارِ بناء الخريطة...`,
                        'success',
                        'تحميل تلقائي'
                    );
                    this.processWithWorker(jsonString, 'json');
                    return;
                }

                // ── Legacy format: plain array (from old sessionStorage) ──
                if (Array.isArray(envelope) && envelope.length > 0 && envelope[0].url) {
                    const jsonString = JSON.stringify(envelope, null, 2);
                    dom.jsonInput.value = jsonString;
                    this.showToast(
                        `تم تحميل بيانات الزحف تلقائياً (${envelope.length} صفحة). جارِ بناء الخريطة...`,
                        'success',
                        'تحميل تلقائي'
                    );
                    this.processWithWorker(jsonString, 'json');
                    // Migrate to v1 format
                    localStorage.setItem('ai8v_crawl_data', JSON.stringify({
                        version: 1, timestamp: Date.now(), data: envelope,
                    }));
                    return;
                }

            } catch (e) {
                console.warn('Auto-load from localStorage failed:', e.message);
            }
        },

        initialize() {
            window.showToast = (msg, type, title) => this.showToast(msg, type, title);

            // Init Web Worker
            try {
                visualizerWorker = new Worker('../assets/js/SiteVisualizerLab/visualizer-worker.js');
                visualizerWorker.onmessage = (e) => {
                    this.setLoadingState(false);
                    const { status, data, message, pageCount } = e.data;
                    if (status === 'success') {
                        this.handleProcessedData(data, pageCount);
                    } else {
                        this.showToast(message, 'error');
                    }
                };
                visualizerWorker.onerror = (e) => {
                    this.setLoadingState(false);
                    console.error('Worker Error:', e);
                    this.showToast(`حدث خطأ فني في العامل: ${e.message}`, 'error');
                };
            } catch (e) {
                console.error("Failed to initialize Web Worker:", e);
                this.showToast('متصفحك لا يدعم Web Workers أو هناك مشكلة في تحميله. ستعمل الأداة في الوضع العادي.', 'error', 'تحذير التوافقية');
            }

            // --- Event Listeners ---
            dom.renderBtn.addEventListener('click', () => {
                this.processWithWorker(dom.jsonInput.value, 'json');
            });

            dom.fileInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileType = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
                    dom.jsonInput.value = ''; // Clear textarea if file is used
                    this.processWithWorker(e.target.result, fileType);
                };
                reader.readAsText(file, 'UTF-8');
            });
            
            dom.loadSampleDataBtn.addEventListener('click', () => {
                fetch('../assets/js/SiteVisualizerLab/sample-data.json')
                    .then(res => res.ok ? res.text() : Promise.reject('فشل تحميل الملف التجريبي.'))
                    .then(data => {
                        dom.jsonInput.value = data;
                        this.processWithWorker(data, 'json');
                    }).catch(err => this.showToast(err, 'error'));
            });
            
            // Regex Cluster Controls Logic — listen on both button groups
            const handleViewModeClick = (e) => {
                const btn = e.target.closest('[data-view-mode]');
                if (!btn) return;
                const mode = btn.dataset.viewMode;
                this.updateLegend(mode);
                dom.topicClusterControls.classList.toggle('d-none', mode !== 'topicCluster');
            };
            dom.viewModesGroup.addEventListener('click', handleViewModeClick);
            const viewModesGroup2 = document.getElementById('view-modes-group-2');
            if (viewModesGroup2) viewModesGroup2.addEventListener('click', handleViewModeClick);

            dom.addClusterRuleBtn.addEventListener('click', () => {
                const ruleNode = dom.clusterRuleTemplate.firstElementChild.cloneNode(true);
                dom.clusterRulesContainer.appendChild(ruleNode);
            });

            dom.clusterRulesContainer.addEventListener('click', (e) => {
                if (e.target.closest('.remove-cluster-rule-btn')) {
                    e.target.closest('.cluster-rule-item').remove();
                }
            });

            dom.applyClusterRulesBtn.addEventListener('click', () => {
                if (!window.svl.network) return;
                
                const rules = Array.from(dom.clusterRulesContainer.querySelectorAll('.cluster-rule-item')).map(item => {
                    const pattern = item.querySelector('.cluster-regex-input').value.trim();
                    const color = item.querySelector('.cluster-color-input').value;
                    return { pattern, color };
                }).filter(rule => rule.pattern);

                try {
                    // Test regex validity
                    rules.forEach(rule => new RegExp(rule.pattern));
                    window.svl.updateNodeDisplay('topicCluster', { rules });
                    this.updateLegend('topicCluster', rules);
                } catch(e) {
                    this.showToast(`تعبير نمطي غير صالح: ${e.message}`, 'error');
                }
            });
            
            this.updateLegend('linkEquity');
            this.updateInspector(null);

            // ── Auto-load from sessionStorage (integration with Crawler tool) ──
            this.autoLoadFromSession();

// ── Floating scroll-to-top button (mobile only) ──
const scrollBtn = document.getElementById('scrollToTopBtn');
if (scrollBtn) {
  const visualizerCol = document.querySelector('.visualizer-column');

  // Use IntersectionObserver to detect when the visualizer column enters the viewport
  if (visualizerCol && window.matchMedia('(max-width: 991.98px)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          scrollBtn.classList.add('visible');
        } else {
          scrollBtn.classList.remove('visible');
        }
      });
    }, { threshold: 0.1 });

    observer.observe(visualizerCol);
  }

        scrollBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Re-evaluate on resize (in case orientation changes)
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 992) {
            scrollBtn.classList.remove('visible');
            }
        });
        }
        
        }
    };

    window.enhancements.initialize();
});
