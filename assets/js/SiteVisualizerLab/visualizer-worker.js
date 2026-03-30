// assets/js/visualizer-worker.js
// Mind & Machine - Site Visualizer Lab Worker v1.0
'use strict';

console.log("✅ Visualizer Worker v1.0 is ready.");

// --- Helper Functions (self-contained, no DOM access) ---
function sanitizeHTML(str) {
    if (typeof str !== 'string' || !str) return '';
    // Basic sanitization for worker context. A more robust library could be used if needed.
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncateLabel(str, maxLength = 25) {
    if (!str || typeof str !== 'string') return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '…' : str;
}

// --- CSV to Ai8V Conversion Logic ---
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++; // skip escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                fields.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }
    fields.push(current.trim());
    return fields;
}

function findColumnIndex(header, keys) {
    for (const key of keys) {
        const index = header.findIndex(h => h.toLowerCase() === key.toLowerCase());
        if (index !== -1) return index;
    }
    return -1;
}

function convertCsvToAi8V(csvText) {
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.substring(1); // Handle BOM
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("ملف CSV فارغ أو غير صالح.");

    const header = parseCSVLine(lines[0]);

    const colMap = {
        url: findColumnIndex(header, ['URL', 'Address', 'العنوان']),
        title: findColumnIndex(header, ['Title 1', 'Title', 'العنوان ١', 'العنوان']),
        contentType: findColumnIndex(header, ['Content Type', 'Content', 'نوع المحتوى']),
        inlinks: findColumnIndex(header, ['Inlinks', 'No. of Inlinks', 'الروابط الداخلية الواردة']),
        crawlDepth: findColumnIndex(header, ['Crawl Depth', 'Crawl depth', 'عمق الزحف']),
        indexability: findColumnIndex(header, ['Indexability', 'Indexability Status', 'Indexable', 'القابلية للفهرسة']),
    };

    if (colMap.url === -1) throw new Error(`العمود الأساسي للرابط (URL/Address) غير موجود في ملف CSV.`);
    
    const pages = lines.slice(1).map(line => {
        const data = parseCSVLine(line);
        const contentType = colMap.contentType !== -1 ? data[colMap.contentType] : 'text/html';
        if (!contentType || !contentType.includes('text/html')) return null;

        const url = data[colMap.url];
        if (!url) return null;

        const inlinks = colMap.inlinks !== -1 ? (parseInt(data[colMap.inlinks], 10) || 0) : 0;
        const crawlDepth = colMap.crawlDepth !== -1 ? (parseInt(data[colMap.crawlDepth], 10) || 0) : 0;
        const title = colMap.title !== -1 ? (data[colMap.title] || url) : url;
        const indexability = colMap.indexability !== -1 ? data[colMap.indexability] : 'Indexable';
        const isNoIndex = !['indexable', 'قابل للفهرسة'].includes(indexability.toLowerCase());
        
        const parentLinks = [];
        try {
            const urlObject = new URL(url);
            const pathSegments = urlObject.pathname.split('/').filter(Boolean);
            if (pathSegments.length > 0) {
                const parentPath = `/${pathSegments.slice(0, -1).join('/')}${pathSegments.length > 1 ? '/' : ''}`;
                const parentUrl = new URL(parentPath, url).href;
                if (parentUrl !== url) {
                   parentLinks.push(parentUrl);
                }
            }
        } catch (e) { /* Ignore invalid URLs for parent link generation */ }
        
        return {
            url, title,
            seo: {
                crawlDepth, isNoIndex,
                isOrphan: crawlDepth > 0 && inlinks === 0,
                internalLinkEquity: inlinks,
                contentAnalysis: { outgoingInternalLinks: parentLinks }
            }
        };
    }).filter(Boolean);

    if (pages.length === 0) throw new Error("لم يتم العثور على صفحات HTML صالحة في ملف CSV.");
    
    const urls = new Set(pages.map(p => p.url));
    if (pages.length > 0) {
        const rootUrl = new URL(pages[0].url).origin + '/';
        if (!urls.has(rootUrl)) {
             pages.push({
                 url: rootUrl,
                 title: new URL(rootUrl).hostname,
                 seo: { crawlDepth: 0, isNoIndex: false, isOrphan: false, internalLinkEquity: 0, contentAnalysis: { outgoingInternalLinks: [] } }
             });
        }
    }

    return JSON.stringify(pages, null, 2);
}

// --- Graph Analysis Algorithms ---

function computePageRank(searchIndex, edgeMap, iterations = 20, damping = 0.85) {
    const N = searchIndex.length;
    if (N === 0) return {};

    const urls = searchIndex.map(p => p.url);
    const urlSet = new Set(urls);

    // Build adjacency: outgoing links for each URL
    const outgoing = {};
    urls.forEach(u => { outgoing[u] = []; });

    searchIndex.forEach(page => {
        (page.seo?.contentAnalysis?.outgoingInternalLinks || []).forEach(target => {
            if (urlSet.has(target) && target !== page.url) {
                outgoing[page.url].push(target);
            }
        });
    });

    // Initialize scores
    const pr = {};
    const base = 1 / N;
    urls.forEach(u => { pr[u] = base; });

    // Iterative computation
    for (let iter = 0; iter < iterations; iter++) {
        const newPr = {};
        let danglingSum = 0;

        // Collect dangling node contributions
        urls.forEach(u => {
            if (outgoing[u].length === 0) {
                danglingSum += pr[u];
            }
        });

        const danglingDistribution = danglingSum / N;

        urls.forEach(u => {
            newPr[u] = (1 - damping) / N + damping * danglingDistribution;
        });

        // Distribute rank through links
        urls.forEach(u => {
            const out = outgoing[u];
            if (out.length > 0) {
                const share = damping * pr[u] / out.length;
                out.forEach(target => {
                    newPr[target] += share;
                });
            }
        });

        // Update
        urls.forEach(u => { pr[u] = newPr[u]; });
    }

    return pr;
}

function computeBetweenness(searchIndex, edgeMap) {
    const urls = searchIndex.map(p => p.url);
    const N = urls.length;
    if (N < 3) {
        const result = {};
        urls.forEach(u => { result[u] = 0; });
        return result;
    }

    const urlSet = new Set(urls);

    // Build undirected adjacency list from actual edges
    const adj = {};
    urls.forEach(u => { adj[u] = []; });

    searchIndex.forEach(page => {
        (page.seo?.contentAnalysis?.outgoingInternalLinks || []).forEach(target => {
            if (urlSet.has(target) && target !== page.url) {
                adj[page.url].push(target);
            }
        });
    });

    // Brandes algorithm
    const cb = {};
    urls.forEach(u => { cb[u] = 0; });

    for (let si = 0; si < N; si++) {
        const s = urls[si];
        const stack = [];
        const pred = {};
        const sigma = {};
        const dist = {};
        const delta = {};

        urls.forEach(u => {
            pred[u] = [];
            sigma[u] = 0;
            dist[u] = -1;
            delta[u] = 0;
        });

        sigma[s] = 1;
        dist[s] = 0;

        const queue = [s];
        let qi = 0;

        while (qi < queue.length) {
            const v = queue[qi++];
            stack.push(v);

            const neighbors = adj[v];
            for (let ni = 0; ni < neighbors.length; ni++) {
                const w = neighbors[ni];
                if (dist[w] === -1) {
                    dist[w] = dist[v] + 1;
                    queue.push(w);
                }
                if (dist[w] === dist[v] + 1) {
                    sigma[w] += sigma[v];
                    pred[w].push(v);
                }
            }
        }

        // Back-propagation
        while (stack.length > 0) {
            const w = stack.pop();
            const preds = pred[w];
            for (let pi = 0; pi < preds.length; pi++) {
                const v = preds[pi];
                delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
            }
            if (w !== s) {
                cb[w] += delta[w];
            }
        }
    }

    // Normalize: for directed graphs, divide by (N-1)(N-2)
    const normFactor = (N - 1) * (N - 2);
    if (normFactor > 0) {
        urls.forEach(u => { cb[u] /= normFactor; });
    }

    return cb;
}

function normalizeToScore(values) {
    const vals = Object.values(values);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const range = max - min;

    const scores = {};
    for (const key in values) {
        scores[key] = range > 0 ? Math.round(((values[key] - min) / range) * 100) : 50;
    }
    return scores;
}

// --- Community Detection: Louvain Algorithm ---

function computeLouvain(searchIndex) {
    const urls = searchIndex.map(p => p.url);
    const N = urls.length;
    if (N < 2) {
        const communities = {};
        urls.forEach(u => { communities[u] = 0; });
        return { communities, modularity: 0, count: 1 };
    }

    const urlToIdx = new Map();
    urls.forEach((u, i) => { urlToIdx.set(u, i); });

    // Build undirected weighted adjacency
    const adj = new Array(N);
    for (let i = 0; i < N; i++) adj[i] = {};

    let totalWeight = 0;
    searchIndex.forEach(page => {
        const i = urlToIdx.get(page.url);
        (page.seo?.contentAnalysis?.outgoingInternalLinks || []).forEach(target => {
            const j = urlToIdx.get(target);
            if (j === undefined || j === i) return;
            // Undirected: add weight in both directions
            if (!adj[i][j]) { adj[i][j] = 0; adj[j][i] = 0; }
            adj[i][j] += 1;
            adj[j][i] += 1;
            totalWeight += 1;
        });
    });

    const m = totalWeight; // total edge weight (each directed link counted once)
    if (m === 0) {
        const communities = {};
        urls.forEach(u => { communities[u] = 0; });
        return { communities, modularity: 0, count: 1 };
    }

    // Degree of each node (sum of weights)
    const deg = new Array(N);
    for (let i = 0; i < N; i++) {
        let s = 0;
        for (const j in adj[i]) s += adj[i][j];
        deg[i] = s;
    }

    // Initialize: each node in its own community
    const comm = new Array(N);
    for (let i = 0; i < N; i++) comm[i] = i;

    // Sum of weights inside each community, sum of degrees
    const commInternalWeight = new Float64Array(N); // sigma_in
    const commTotalDeg = new Float64Array(N);       // sigma_tot
    for (let i = 0; i < N; i++) {
        commInternalWeight[i] = 0;
        commTotalDeg[i] = deg[i];
    }

    const m2 = 2 * m;

    // Phase 1: Local moving — iterate until no improvement
    let improved = true;
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (improved && iterations < MAX_ITERATIONS) {
        improved = false;
        iterations++;

        for (let i = 0; i < N; i++) {
            const currentComm = comm[i];
            const ki = deg[i];

            // Remove i from its community
            commTotalDeg[currentComm] -= ki;
            let selfLinkWeight = 0;
            for (const jStr in adj[i]) {
                const j = parseInt(jStr);
                if (comm[j] === currentComm) {
                    commInternalWeight[currentComm] -= adj[i][j];
                }
                if (j === i) selfLinkWeight = adj[i][j];
            }

            // Compute weight to each neighboring community
            const neighborComms = {};
            for (const jStr in adj[i]) {
                const j = parseInt(jStr);
                const c = comm[j];
                if (!neighborComms[c]) neighborComms[c] = 0;
                neighborComms[c] += adj[i][j];
            }

            // Find best community
            let bestComm = currentComm;
            let bestDeltaQ = 0;
            const kiOverM2 = ki / m2;

            // Check current community as baseline
            const wCurrentComm = neighborComms[currentComm] || 0;
            // deltaQ for staying = 0 (baseline)

            for (const cStr in neighborComms) {
                const c = parseInt(cStr);
                const wc = neighborComms[c];
                // Modularity gain of moving i to community c vs leaving it unassigned
                const deltaQ = (wc / m) - (commTotalDeg[c] * kiOverM2 / m);
                const deltaQCurrent = (wCurrentComm / m) - (commTotalDeg[currentComm] * kiOverM2 / m);
                if (deltaQ - deltaQCurrent > bestDeltaQ) {
                    bestDeltaQ = deltaQ - deltaQCurrent;
                    bestComm = c;
                }
            }

            // Assign to best community
            comm[i] = bestComm;
            commTotalDeg[bestComm] += ki;
            for (const jStr in adj[i]) {
                const j = parseInt(jStr);
                if (comm[j] === bestComm) {
                    commInternalWeight[bestComm] += adj[i][j];
                }
            }

            if (bestComm !== currentComm) improved = true;
        }
    }

    // Renumber communities to 0, 1, 2, ...
    const uniqueComms = [...new Set(comm)];
    const commMap = {};
    uniqueComms.forEach((c, idx) => { commMap[c] = idx; });

    const communities = {};
    urls.forEach((u, i) => { communities[u] = commMap[comm[i]]; });

    // Compute modularity Q
    let Q = 0;
    for (let i = 0; i < N; i++) {
        for (const jStr in adj[i]) {
            const j = parseInt(jStr);
            if (comm[i] === comm[j]) {
                Q += adj[i][j] - (deg[i] * deg[j] / m2);
            }
        }
    }
    Q /= m2;

    return {
        communities,
        modularity: Math.round(Q * 1000) / 1000,
        count: uniqueComms.length
    };
}

// --- Main Data Processing Logic (with progress reporting) ---
function processData(jsonDataString) {
    // ── Stage 1: Parse ──
    self.postMessage({ status: 'progress', stage: 'parse', percent: 5 });
    const data = JSON.parse(jsonDataString);
    if (!Array.isArray(data) || data.length === 0) throw new Error("بيانات JSON غير صالحة أو فارغة.");

    const fullSearchIndex = data.filter(item => item && item.url);
    if (fullSearchIndex.length === 0) throw new Error("لم يتم العثور على صفحات صالحة (تحتوي على url) في البيانات.");

    // ── Stage 2: Build Edges ──
    self.postMessage({ status: 'progress', stage: 'edges', percent: 15 });
    const pageUrls = new Set(fullSearchIndex.map(p => p.url));
    const edgeMap = {};

    fullSearchIndex.forEach(sourcePage => {
        (sourcePage.seo?.contentAnalysis?.outgoingInternalLinks || []).forEach(targetUrl => {
            if (!pageUrls.has(targetUrl) || sourcePage.url === targetUrl) return;

            const [nodeA, nodeB] = [sourcePage.url, targetUrl].sort();
            const key = nodeA + '|' + nodeB;

            if (!edgeMap[key]) {
                edgeMap[key] = { nodeA, nodeB, forwardCount: 0, reverseCount: 0 };
            }

            if (sourcePage.url === nodeA) {
                edgeMap[key].forwardCount++;
            } else {
                edgeMap[key].reverseCount++;
            }
        });
    });

    const edges = Object.values(edgeMap).map(e => {
        const totalWeight = e.forwardCount + e.reverseCount;
        const isBidirectional = e.forwardCount > 0 && e.reverseCount > 0;

        let from, to;
        if (e.forwardCount > 0 && e.reverseCount === 0) {
            from = e.nodeA; to = e.nodeB;
        } else if (e.forwardCount === 0 && e.reverseCount > 0) {
            from = e.nodeB; to = e.nodeA;
        } else {
            from = e.nodeA; to = e.nodeB;
        }

        let title;
        if (isBidirectional) {
            title = `رابط متبادل (${e.forwardCount} + ${e.reverseCount})`;
        } else {
            title = totalWeight > 1 ? `${totalWeight} روابط أحادية` : 'رابط أحادي';
        }

        return {
            from, to,
            value: totalWeight,
            length: 350 / totalWeight,
            title,
            arrows: {
                to: { enabled: true, scaleFactor: 0.5 },
                from: { enabled: isBidirectional, scaleFactor: 0.5 }
            }
        };
    });

    // ── Stage 3: PageRank ──
    self.postMessage({ status: 'progress', stage: 'pagerank', percent: 35 });
    const pageRankRaw = computePageRank(fullSearchIndex, edgeMap);
    const pageRankScores = normalizeToScore(pageRankRaw);

    // ── Stage 4: Betweenness Centrality ──
    self.postMessage({ status: 'progress', stage: 'betweenness', percent: 55 });
    const betweennessRaw = computeBetweenness(fullSearchIndex, edgeMap);
    const betweennessScores = normalizeToScore(betweennessRaw);

    // ── Stage 5: Community Detection ──
    self.postMessage({ status: 'progress', stage: 'community', percent: 80 });
    const louvainResult = computeLouvain(fullSearchIndex);

    // ── Stage 6: Attach metrics ──
    self.postMessage({ status: 'progress', stage: 'finalize', percent: 95 });
    fullSearchIndex.forEach(page => {
        if (!page.seo) page.seo = {};
        page.seo._computed = {
            pageRank: pageRankRaw[page.url] || 0,
            pageRankScore: pageRankScores[page.url] || 0,
            betweenness: betweennessRaw[page.url] || 0,
            betweennessScore: betweennessScores[page.url] || 0,
            communityId: louvainResult.communities[page.url] ?? 0,
        };
    });

    return {
        fullSearchIndex,
        edges,
        communityStats: {
            count: louvainResult.count,
            modularity: louvainResult.modularity,
        }
    };
}


// --- Worker Event Listener ---
self.onmessage = function(e) {
    const { fileContent, fileType } = e.data;

    try {
        let jsonDataString = fileContent;
        if (fileType === 'csv') {
            self.postMessage({ status: 'progress', stage: 'csv', percent: 2 });
            jsonDataString = convertCsvToAi8V(fileContent);
        }
        
        const processedData = processData(jsonDataString);

        self.postMessage({ status: 'progress', stage: 'done', percent: 100 });
        
        self.postMessage({
            status: 'success',
            data: processedData,
            pageCount: processedData.fullSearchIndex.length
        });

    } catch (err) {
        self.postMessage({
            status: 'error',
            message: err.message
        });
    }
};
