// assets/js/ghost-crawler.js
// Ai8V - Ghost Crawler v3.0 (Backend-Powered Edition)
// Now orchestrates crawling via Ai8V Crawler API

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const API_BASE = 'https://ai8v-crawler-api.ai8v.workers.dev';
  const API_KEY = 'ai8v_2026_xK9mP4qR7wL2nJ5vT8bQ';
  const BATCH_SIZE = 3;           // URLs per batch (Free Plan safe)
  const LINK_CHECK_BATCH = 20;    // Links per check batch
  const LOW_WORD_COUNT_THRESHOLD = 250;

  const SEVERITY = {
    CRITICAL: { level: 0, text: 'حرجة', class: 'bg-danger' },
    HIGH:     { level: 1, text: 'عالية', class: 'bg-warning text-dark' },
    MEDIUM:   { level: 2, text: 'متوسطة', class: 'bg-info text-dark' },
    LOW:      { level: 3, text: 'منخفضة', class: 'bg-secondary' },
    INFO:     { level: 4, text: 'للعلم', class: 'bg-light text-dark border' },
  };

  // ═══════════════════════════════════════════════════════════════
  // DOM ELEMENTS
  // ═══════════════════════════════════════════════════════════════

  const startUrlInput = document.getElementById('startUrl');
  const startCrawlBtn = document.getElementById('startCrawlBtn');
  const crawlDelayInput = document.getElementById('crawlDelay');
  const maxDepthInput = document.getElementById('maxDepth');
  const progressSection = document.getElementById('progress-section');
  const statusBar = document.getElementById('progress-bar');
  const statusText = document.getElementById('status-text');
  const crawlCounter = document.getElementById('crawl-counter');
  const resultsSection = document.getElementById('results-section');
  const resultsTableBody = document.getElementById('results-table-body');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const errorToastEl = document.getElementById('errorToast');
  const errorToast = bootstrap.Toast.getOrCreateInstance(errorToastEl);
  const toastBodyMessage = document.getElementById('toast-body-message');

  // Visualizer elements
  const visualizerActionsContainer = document.getElementById('visualizerActionsContainer');
  const copyVisualizerDataBtn = document.getElementById('copyVisualizerDataBtn');
  const appToastEl = document.getElementById('appToast');
  const appToast = appToastEl ? bootstrap.Toast.getOrCreateInstance(appToastEl) : null;
  const appToastIcon = document.getElementById('toast-icon');
  const appToastTitle = document.getElementById('toast-title');
  const appToastBody = document.getElementById('toast-body-content');

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let origin = '';
  let crawledUrls = new Set();
  let queue = [];                     // { url, depth, source }
  let queueSet = new Set();           // O(1) lookup for dedup
  let pageData = new Map();           // canonical → full page data
  let allDiscoveredLinks = new Set(); // All links found (for status checking)
  let linkStatusCache = new Map();    // url → { status, ok, error }
  let finalReport = [];
  let robotsRules = null;
  let maxDepthValue = 10;
  let crawlDelayValue = 100;
  let isCrawling = false;

  // ═══════════════════════════════════════════════════════════════
  // API COMMUNICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Makes an authenticated API request.
   */
  async function apiRequest(endpoint, body) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.message || `API error: ${response.status}`);
    }

    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════

  function showToast(message) {
    toastBodyMessage.innerText = message;
    errorToast.show();
  }

  function showAppToast(message, type = 'info', title = 'تنبيه') {
    if (!appToast || !appToastBody || !appToastTitle || !appToastIcon) return;
    appToastBody.textContent = message;
    appToastTitle.textContent = title;
    if (type === 'error') {
      appToastIcon.className = 'bi bi-exclamation-triangle-fill text-danger me-2';
    } else if (type === 'success') {
      appToastIcon.className = 'bi bi-check-circle-fill text-success me-2';
    } else {
      appToastIcon.className = 'bi bi-info-circle-fill text-info me-2';
    }
    appToast.show();
  }

  function updateProgress(current, total, text) {
    statusText.innerText = text;
    crawlCounter.innerText = `${current}/${total}`;
    const percentage = total > 0 ? (current / total) * 100 : 0;
    statusBar.style.width = `${percentage}%`;
  }

  function normalizeUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.href;
    } catch {
      return urlStr;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  function initializeCrawl() {
    const rawStartUrl = startUrlInput.value.trim();
    if (!rawStartUrl || !rawStartUrl.startsWith('https://')) {
      showToast('يرجى إدخال رابط صحيح يبدأ بـ https://');
      return false;
    }

    origin = new URL(rawStartUrl).origin;

    crawlDelayValue = parseInt(crawlDelayInput.value, 10);
    if (isNaN(crawlDelayValue) || crawlDelayValue < 0) crawlDelayValue = 100;

    maxDepthValue = parseInt(maxDepthInput.value, 10);
    if (isNaN(maxDepthValue) || maxDepthValue < 0) maxDepthValue = 10;

    // Reset state
    crawledUrls = new Set();
    queue = [];
    queueSet = new Set();
    pageData = new Map();
    allDiscoveredLinks = new Set();
    linkStatusCache = new Map();
    finalReport = [];
    robotsRules = null;
    isCrawling = true;

    // Reset UI
    resultsTableBody.innerHTML = '';
    progressSection.classList.remove('d-none');
    resultsSection.classList.add('d-none');
    exportCsvBtn.classList.add('d-none');
    if (visualizerActionsContainer) visualizerActionsContainer.classList.add('d-none');
    startCrawlBtn.disabled = true;
    startCrawlBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> جارِ الفحص...`;

    if (copyVisualizerDataBtn) {
      copyVisualizerDataBtn.disabled = false;
      copyVisualizerDataBtn.classList.remove('btn-success');
      copyVisualizerDataBtn.classList.add('btn-secondary');
      copyVisualizerDataBtn.innerHTML = `<i class="bi bi-clipboard-data-fill ms-2"></i>نسخ بيانات الخريطة`;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 0: INIT — robots.txt + sitemap.xml
  // ═══════════════════════════════════════════════════════════════

  async function phaseInit(startUrl) {
    updateProgress(0, 1, 'المرحلة 0: جارِ جلب robots.txt و sitemap.xml...');

    try {
      const data = await apiRequest('/api/init', {
        url: startUrl,
        maxDepth: maxDepthValue,
      });

      origin = data.origin;
      robotsRules = data.robots.rules || { allow: [], disallow: [] };

      // Build initial queue from API response
      for (const item of data.initialQueue) {
        if (item.depth <= maxDepthValue && !queueSet.has(item.url)) {
          queue.push({ url: item.url, depth: item.depth, source: item.source });
          queueSet.add(item.url);
        }
      }

      const robotsStatus = data.robots.found ? 'تم العثور عليه' : 'غير موجود';
      const sitemapCount = data.sitemap.urlsFound;
      updateProgress(1, 1, `المرحلة 0: ${robotsStatus} robots.txt | ${sitemapCount} صفحة من sitemap | ${data.timing.initDuration}ms`);

      return true;
    } catch (err) {
      showToast(`خطأ في التهيئة: ${err.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: CRAWL — Batch Processing
  // ═══════════════════════════════════════════════════════════════

  async function phaseCrawl() {
    let totalEstimate = queue.length;

    while (queue.length > 0 && isCrawling) {
      // Pick next batch
      const batch = [];
      while (batch.length < BATCH_SIZE && queue.length > 0) {
        const item = queue.shift();
        queueSet.delete(item.url);

        if (crawledUrls.has(item.url)) continue;
        if (item.depth > maxDepthValue) continue;

        crawledUrls.add(item.url);
        batch.push(item);
      }

      if (batch.length === 0) continue;

      totalEstimate = Math.max(totalEstimate, crawledUrls.size + queue.length);
      updateProgress(
        crawledUrls.size,
        totalEstimate,
        `المرحلة الأولى: زحف متوازي — ${batch.length} صفحات (${crawledUrls.size}/${totalEstimate})`
      );

      try {
        const data = await apiRequest('/api/crawl/batch', {
          urls: batch.map(b => ({ url: b.url, depth: b.depth })),
          origin: origin,
          robotsRules: robotsRules,
        });

        // Process results
        for (const result of data.results) {
          processPageResult(result);
        }
      } catch (err) {
        console.error('Batch crawl error:', err);
        // Mark failed URLs
        for (const item of batch) {
          const errorData = {
            url: item.url,
            canonical: item.url,
            status: 0,
            error: err.message,
            seo: { title: { value: '[فشل الزحف]', length: 0 }, description: { value: '', length: 0 }, h1s: [], headings: [], wordCount: 0, robotsMeta: { noindex: false, nofollow: false } },
            links: { internal: [], external: [] },
            resources: { images: [], css: [], js: [], counts: { images: 0, css: 0, js: 0 } },
            newUrls: [],
          };
          processPageResult(errorData);
        }
      }

      // Delay between batches (respect crawl delay)
      if (queue.length > 0 && crawlDelayValue > 0) {
        await new Promise(r => setTimeout(r, crawlDelayValue));
      }
    }
  }

  /**
   * Processes a single page result from the API and stores it.
   */
  function processPageResult(result) {
    const canonical = result.canonical ? normalizeUrl(result.canonical) : normalizeUrl(result.url);

    // Collect all discovered links for status checking
    if (result.links) {
      for (const link of result.links.internal) {
        allDiscoveredLinks.add(link.url);
      }
      for (const link of result.links.external) {
        allDiscoveredLinks.add(link.url);
      }
    }

    // Collect image URLs too
    if (result.resources && result.resources.images) {
      for (const img of result.resources.images) {
        allDiscoveredLinks.add(img.src);
      }
    }

    // Store page data
    if (!pageData.has(canonical)) {
      pageData.set(canonical, {
        ...result,
        canonical: canonical,
        incomingLinkCount: 0,
        depth: result.seo ? (result.depth || 0) : 0,
      });
    }

    // Add new discovered URLs to queue
    if (result.newUrls) {
      for (const newItem of result.newUrls) {
        const normalized = normalizeUrl(newItem.url);
        if (!crawledUrls.has(normalized) && !queueSet.has(normalized)) {
          if (newItem.depth <= maxDepthValue) {
            queue.push({ url: normalized, depth: newItem.depth, source: 'crawl' });
            queueSet.add(normalized);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: CHECK LINKS — Batch Link Validation
  // ═══════════════════════════════════════════════════════════════

  async function phaseCheckLinks() {
    // Filter out already-crawled URLs (we already know their status)
    const linksToCheck = [];
    for (const link of allDiscoveredLinks) {
      if (!crawledUrls.has(link) && !linkStatusCache.has(link)) {
        linksToCheck.push(link);
      }
    }

    // Mark crawled URLs as OK in cache
    for (const [canonical, data] of pageData.entries()) {
      if (data.status) {
        linkStatusCache.set(canonical, {
          status: data.status,
          ok: data.status >= 200 && data.status < 400,
          error: data.error,
        });
      }
      // Also cache the original URL if different
      if (data.url && data.url !== canonical) {
        linkStatusCache.set(data.url, {
          status: data.status,
          ok: data.status >= 200 && data.status < 400,
          error: data.error,
        });
      }
    }

    const totalLinks = linksToCheck.length;
    if (totalLinks === 0) return;

    let checked = 0;

    // Process in batches of LINK_CHECK_BATCH
    for (let i = 0; i < totalLinks; i += LINK_CHECK_BATCH) {
      if (!isCrawling) break;

      const batch = linksToCheck.slice(i, i + LINK_CHECK_BATCH);
      checked += batch.length;

      updateProgress(
        checked,
        totalLinks,
        `المرحلة الثانية: فحص الروابط (${checked}/${totalLinks})`
      );

      try {
        const data = await apiRequest('/api/check-links', {
          urls: batch,
        });

        // Store results in cache
        for (const [url, result] of Object.entries(data.results)) {
          linkStatusCache.set(url, result);
        }
      } catch (err) {
        console.error('Link check error:', err);
        // Mark as error
        for (const url of batch) {
          linkStatusCache.set(url, { status: 0, ok: false, error: err.message });
        }
      }

      // Small delay between check batches
      if (i + LINK_CHECK_BATCH < totalLinks) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: BUILD REPORT
  // ═══════════════════════════════════════════════════════════════

  function phaseBuildReport() {
    updateProgress(0, 1, 'المرحلة الثالثة: جاري تجميع التقرير النهائي...');

    // ─── Calculate incoming links ───
    const incomingLinksMap = new Map();
    for (const data of pageData.values()) {
      if (data.links) {
        for (const link of data.links.internal) {
          const normalized = normalizeUrl(link.url);
          incomingLinksMap.set(normalized, (incomingLinksMap.get(normalized) || 0) + 1);
        }
      }
    }
    for (const [, data] of pageData) {
      data.incomingLinkCount = incomingLinksMap.get(data.canonical) || 0;
    }

    // ─── Find issues ───
    const titleMap = new Map();
    const descriptionMap = new Map();
    const fingerprintMap = new Map();

    for (const [canonicalUrl, data] of pageData.entries()) {
      if (!data.seo) continue;

      const seo = data.seo;
      const depth = data.depth || 0;
      const pageInfo = {
        title: seo.title?.value || '[لا يوجد عنوان]',
        status: data.status,
        wordCount: seo.wordCount || 0,
        outgoingLinks: [...(data.links?.internal || []), ...(data.links?.external || [])],
        incomingLinkCount: data.incomingLinkCount,
        depth: depth,
      };

      // ─── Crawl errors ───
      if (data.error) {
        addIssue(canonicalUrl, pageInfo, 'خطأ في الزحف', SEVERITY.CRITICAL, { text: `${data.error}` });
      }
      if (data.status >= 400) {
        addIssue(canonicalUrl, pageInfo, 'خطأ HTTP', SEVERITY.CRITICAL, { text: `الصفحة أعادت رمز الحالة ${data.status}` });
      }

      // ─── Broken links ───
      if (data.links) {
        const allLinks = [...data.links.internal, ...data.links.external];
        for (const link of allLinks) {
          const statusInfo = linkStatusCache.get(link.url);
          if (statusInfo && !statusInfo.ok) {
            addIssue(canonicalUrl, pageInfo, 'رابط تالف', SEVERITY.CRITICAL, {
              errorLink: link.url,
              errorType: statusInfo.status || statusInfo.error,
              anchorText: '[—]',
              linkType: link.url.startsWith(origin) ? 'لينك داخلى' : 'لينك خارجى',
            });
          }
        }
      }

      // ─── Robots meta ───
      if (seo.robotsMeta?.noindex) {
        addIssue(canonicalUrl, pageInfo, 'ممنوعة من الفهرسة (Noindex)', SEVERITY.HIGH, { text: 'تحتوي على وسم "noindex".' });
      }
      if (seo.robotsMeta?.nofollow) {
        addIssue(canonicalUrl, pageInfo, 'الروابط لا تتبع (Nofollow)', SEVERITY.INFO, { text: 'تحتوي على وسم "nofollow".' });
      }

      // ─── Title ───
      if (!seo.title?.value || seo.title.value === '[لا يوجد عنوان]') {
        addIssue(canonicalUrl, pageInfo, 'عنوان مفقود', SEVERITY.HIGH, { text: 'وسم <title> فارغ أو مفقود.' });
      } else {
        if (seo.title.length > 60) {
          addIssue(canonicalUrl, pageInfo, 'عنوان طويل', SEVERITY.LOW, { text: `طول العنوان (${seo.title.length}) أكثر من 60 حرف.` });
        } else if (seo.title.length < 30) {
          addIssue(canonicalUrl, pageInfo, 'عنوان قصير', SEVERITY.LOW, { text: `طول العنوان (${seo.title.length}) أقل من 30 حرف.` });
        }
        const titleKey = seo.title.value.toLowerCase().trim();
        if (!titleMap.has(titleKey)) titleMap.set(titleKey, []);
        titleMap.get(titleKey).push(canonicalUrl);
      }

      // ─── Description ───
      if (!seo.description?.value) {
        addIssue(canonicalUrl, pageInfo, 'وصف ميتا مفقود', SEVERITY.MEDIUM, { text: 'وسم <meta name="description"> فارغ أو مفقود.' });
      } else {
        if (seo.description.length > 160) {
          addIssue(canonicalUrl, pageInfo, 'وصف ميتا طويل', SEVERITY.LOW, { text: `طول الوصف (${seo.description.length}) أكثر من 160 حرف.` });
        } else if (seo.description.length < 70) {
          addIssue(canonicalUrl, pageInfo, 'وصف ميتا قصير', SEVERITY.LOW, { text: `طول الوصف (${seo.description.length}) أقل من 70 حرف.` });
        }
        const descKey = seo.description.value.toLowerCase().trim();
        if (!descriptionMap.has(descKey)) descriptionMap.set(descKey, []);
        descriptionMap.get(descKey).push(canonicalUrl);
      }

      // ─── H1 ───
      if (!seo.h1s || seo.h1s.length === 0) {
        addIssue(canonicalUrl, pageInfo, 'H1 مفقود', SEVERITY.HIGH, { text: 'الصفحة لا تحتوي على وسم <h1>.' });
      } else if (seo.h1s.length > 1) {
        addIssue(canonicalUrl, pageInfo, 'H1 متعدد', SEVERITY.LOW, { text: `تم العثور على ${seo.h1s.length} وسوم H1.`, h1s: seo.h1s });
      }

      // ─── Word count ───
      if (seo.wordCount < LOW_WORD_COUNT_THRESHOLD && data.status < 400) {
        addIssue(canonicalUrl, pageInfo, 'محتوى ضعيف', SEVERITY.MEDIUM, { text: `عدد الكلمات (${seo.wordCount}) أقل من (${LOW_WORD_COUNT_THRESHOLD}).` });
      }

      // ─── Canonical ───
      if (seo.canonical && normalizeUrl(canonicalUrl) !== normalizeUrl(seo.canonical)) {
        addIssue(canonicalUrl, pageInfo, 'Canonical خاطئ', SEVERITY.HIGH, { text: 'الرابط الأساسي المحدد لا يطابق رابط الصفحة.', canonical: seo.canonical });
      }

      // ─── Orphan pages ───
      if (data.incomingLinkCount === 0 && depth > 0) {
        addIssue(canonicalUrl, pageInfo, 'صفحة يتيمة', SEVERITY.HIGH, { text: 'لم يتم العثور على روابط داخلية لهذه الصفحة.' });
      }

      // ─── Images without alt ───
      if (data.resources?.images) {
        const noAltImages = data.resources.images.filter(img => !img.hasAlt);
        if (noAltImages.length > 0) {
          addIssue(canonicalUrl, pageInfo, 'صور بدون Alt', SEVERITY.MEDIUM, {
            text: `${noAltImages.length} صورة بدون نص بديل (alt).`,
          });
        }
      }

      // ─── Missing OG ───
      if (data.og) {
        const missingOg = [];
        if (!data.og.title) missingOg.push('og:title');
        if (!data.og.description) missingOg.push('og:description');
        if (!data.og.image) missingOg.push('og:image');
        if (missingOg.length > 0) {
          addIssue(canonicalUrl, pageInfo, 'Open Graph ناقص', SEVERITY.LOW, {
            text: `وسوم مفقودة: ${missingOg.join(', ')}`,
          });
        }
      }

      // ─── Security headers ───
      if (data.security) {
        const missingHeaders = [];
        if (!data.security['x-content-type-options']) missingHeaders.push('X-Content-Type-Options');
        if (!data.security['x-frame-options']) missingHeaders.push('X-Frame-Options');
        if (!data.security['strict-transport-security']) missingHeaders.push('HSTS');
        if (missingHeaders.length >= 2) {
          addIssue(canonicalUrl, pageInfo, 'Security Headers ناقصة', SEVERITY.LOW, {
            text: `ناقص: ${missingHeaders.join(', ')}`,
          });
        }
      }

      // ─── Content fingerprint (duplicate content) ───
      if (seo.contentFingerprint && seo.contentFingerprint !== '0') {
        if (!fingerprintMap.has(seo.contentFingerprint)) fingerprintMap.set(seo.contentFingerprint, []);
        fingerprintMap.get(seo.contentFingerprint).push(canonicalUrl);
      }
    }

    // ─── Duplicate titles ───
    for (const [, urls] of titleMap) {
      if (urls.length > 1) {
        for (const url of urls) {
          const data = pageData.get(url);
          if (!data) continue;
          const pageInfo = { title: data.seo?.title?.value, status: data.status, wordCount: data.seo?.wordCount || 0, outgoingLinks: [], incomingLinkCount: data.incomingLinkCount, depth: data.depth || 0 };
          addIssue(url, pageInfo, 'عنوان مكرر', SEVERITY.HIGH, { text: `مكرر في ${urls.length} صفحات.`, duplicates: urls });
        }
      }
    }

    // ─── Duplicate descriptions ───
    for (const [, urls] of descriptionMap) {
      if (urls.length > 1) {
        for (const url of urls) {
          const data = pageData.get(url);
          if (!data) continue;
          const pageInfo = { title: data.seo?.title?.value, status: data.status, wordCount: data.seo?.wordCount || 0, outgoingLinks: [], incomingLinkCount: data.incomingLinkCount, depth: data.depth || 0 };
          addIssue(url, pageInfo, 'وصف ميتا مكرر', SEVERITY.MEDIUM, { text: `مكرر في ${urls.length} صفحات.`, duplicates: urls });
        }
      }
    }

    // ─── Duplicate content ───
    for (const [, urls] of fingerprintMap) {
      if (urls.length > 1) {
        for (const url of urls) {
          const data = pageData.get(url);
          if (!data) continue;
          const pageInfo = { title: data.seo?.title?.value, status: data.status, wordCount: data.seo?.wordCount || 0, outgoingLinks: [], incomingLinkCount: data.incomingLinkCount, depth: data.depth || 0 };
          addIssue(url, pageInfo, 'محتوى مكرر (مشتبه)', SEVERITY.MEDIUM, { text: `بصمة محتوى متطابقة مع ${urls.length - 1} صفحات أخرى.`, duplicates: urls });
        }
      }
    }

    // Sort by severity
    finalReport.sort((a, b) => a.issueSeverity.level - b.issueSeverity.level);
  }

  function addIssue(sourceUrl, pageInfo, issueType, issueSeverity, issueDetails) {
    finalReport.push({
      sourcePage: sourceUrl,
      pageTitle: pageInfo.title || '[لا يوجد عنوان]',
      pageStatus: pageInfo.status,
      wordCount: pageInfo.wordCount || 0,
      outgoingLinkCount: pageInfo.outgoingLinks ? pageInfo.outgoingLinks.length : 0,
      incomingLinkCount: pageInfo.incomingLinkCount || 0,
      depth: pageInfo.depth || 0,
      issueType,
      issueSeverity,
      issueDetails,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DISPLAY RESULTS
  // ═══════════════════════════════════════════════════════════════

  function displayResults() {
    resultsSection.classList.remove('d-none');

    if (finalReport.length === 0) {
      resultsTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-success fw-bold p-4">رائع! لم يتم العثور على أي مشاكل تقنية.</td></tr>`;
      exportCsvBtn.classList.add('d-none');
      return;
    }

    const formatDetails = (issue) => {
      switch (issue.issueType) {
        case 'رابط تالف':
          return `<div class="d-flex flex-column"><span class="text-danger fw-bold">الخطأ: ${issue.issueDetails.errorType}</span><a href="${issue.issueDetails.errorLink}" target="_blank" class="text-truncate" style="max-width: 250px;" title="${issue.issueDetails.errorLink}">${issue.issueDetails.errorLink}</a><small class="text-muted">النوع: ${issue.issueDetails.linkType}</small></div>`;
        case 'عنوان مكرر':
        case 'وصف ميتا مكرر':
        case 'محتوى مكرر (مشتبه)':
          const otherPages = (issue.issueDetails.duplicates || []).filter(d => d !== issue.sourcePage);
          return `${issue.issueDetails.text} <a tabindex="0" class="badge bg-primary-subtle text-primary-emphasis rounded-pill" role="button" data-bs-toggle="popover" data-bs-trigger="focus" title="الصفحات المكررة" data-bs-content="${otherPages.join('<br>')}">${otherPages.length}</a>`;
        case 'H1 متعدد':
          return `${issue.issueDetails.text}<br><small class="text-muted" dir="ltr">${(issue.issueDetails.h1s || []).join(' | ')}</small>`;
        case 'Canonical خاطئ':
          return `<div class="d-flex flex-column"><span>الرابط المحدد:</span><small class="text-muted text-truncate" style="max-width: 250px;" title="${issue.issueDetails.canonical}">${issue.issueDetails.canonical}</small></div>`;
        default:
          return issue.issueDetails.text || 'N/A';
      }
    };

    resultsTableBody.innerHTML = finalReport.map(res => `<tr><td><span class="badge ${res.issueSeverity.class}">${res.issueSeverity.text}</span></td><td class="fw-bold">${res.issueType}</td><td class="text-truncate" style="max-width: 150px;"><a href="${res.sourcePage}" target="_blank" title="${res.sourcePage}">${res.sourcePage}</a></td><td>${formatDetails(res)}</td><td class="text-truncate" style="max-width: 150px;" title="${res.pageTitle}">${res.pageTitle}</td><td><span class="badge bg-${String(res.pageStatus).startsWith('2') ? 'success' : String(res.pageStatus).startsWith('S') ? 'info' : 'warning'}">${res.pageStatus}</span></td><td>${res.wordCount}</td><td>${res.outgoingLinkCount}</td><td>${res.incomingLinkCount}</td><td>${res.depth}</td></tr>`).join('');

    [...document.querySelectorAll('[data-bs-toggle="popover"]')].map(el => new bootstrap.Popover(el, { html: true }));
    exportCsvBtn.classList.remove('d-none');
  }

  // ═══════════════════════════════════════════════════════════════
  // VISUALIZER DATA
  // ═══════════════════════════════════════════════════════════════

  function generateVisualizerData() {
    if (!pageData || pageData.size === 0) return null;

    const fullSearchIndex = [];
    for (const [, page] of pageData) {
      fullSearchIndex.push({
        url: page.canonical,
        title: page.seo?.title?.value || '',
        seo: {
          internalLinkEquity: page.incomingLinkCount,
          crawlDepth: page.depth || 0,
          isNoIndex: page.seo?.robotsMeta?.noindex || false,
          isOrphan: (page.depth || 0) > 0 && page.incomingLinkCount === 0,
          contentAnalysis: {
            outgoingInternalLinks: (page.links?.internal || []).map(l => l.url),
          },
        },
      });
    }
    return JSON.stringify(fullSearchIndex, null, 2);
  }

  function setupVisualizer() {
    const visualizerData = generateVisualizerData();
    if (visualizerData) {
      if (visualizerActionsContainer) visualizerActionsContainer.classList.remove('d-none');
      if (copyVisualizerDataBtn) {
        copyVisualizerDataBtn.onclick = () => {
          if (!navigator.clipboard) {
            showAppToast('متصفحك لا يدعم النسخ إلى الحافظة.', 'error');
            return;
          }
          navigator.clipboard.writeText(visualizerData).then(() => {
            copyVisualizerDataBtn.classList.remove('btn-secondary');
            copyVisualizerDataBtn.classList.add('btn-success');
            copyVisualizerDataBtn.innerHTML = `<i class="bi bi-check-circle-fill ms-2"></i> تم النسخ بنجاح!`;
            copyVisualizerDataBtn.disabled = true;
          }).catch(() => showAppToast('فشل النسخ إلى الحافظة.', 'error'));
        };
      }
      try {
        sessionStorage.setItem('ai8v_crawl_data', visualizerData);
      } catch (e) {
        console.error('Could not write to sessionStorage:', e);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CSV EXPORT
  // ═══════════════════════════════════════════════════════════════

  function exportToCsv() {
    if (!finalReport || finalReport.length === 0) {
      showAppToast('لا توجد بيانات لتصديرها.', 'error');
      return;
    }

    const headers = ['الأهمية', 'نوع المشكلة', 'الصفحة المصدر', 'التفاصيل', 'عنوان الصفحة', 'حالة الصفحة', 'عدد الكلمات', 'الروابط الصادرة', 'الروابط الواردة', 'عمق الصفحة'];
    const escapeCsvField = (field) => {
      const str = String(field ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };
    const formatDetailsForCsv = (issue) => {
      switch (issue.issueType) {
        case 'رابط تالف': return `الرابط: ${issue.issueDetails.errorLink}, الحالة: ${issue.issueDetails.errorType}`;
        case 'عنوان مكرر': case 'وصف ميتا مكرر': case 'محتوى مكرر (مشتبه)': return `${issue.issueDetails.text} الصفحات: ${(issue.issueDetails.duplicates || []).join('; ')}`;
        case 'H1 متعدد': return `الوسوم: ${(issue.issueDetails.h1s || []).join(' | ')}`;
        case 'Canonical خاطئ': return `الرابط المحدد: ${issue.issueDetails.canonical}`;
        default: return issue.issueDetails.text || '';
      }
    };

    const csvRows = [headers.join(',')];
    for (const row of finalReport) {
      csvRows.push([
        row.issueSeverity.text, row.issueType, row.sourcePage, formatDetailsForCsv(row),
        row.pageTitle, row.pageStatus, row.wordCount, row.outgoingLinkCount,
        row.incomingLinkCount, row.depth,
      ].map(escapeCsvField).join(','));
    }

    const blob = new Blob([`\uFEFF${csvRows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ai8V_Audit_${origin.replace(/https?:\/\//, '')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN ORCHESTRATOR
  // ═══════════════════════════════════════════════════════════════

  async function startCrawl() {
    if (!initializeCrawl()) return;

    const startUrl = startUrlInput.value.trim();
    const overallStart = Date.now();

    try {
      // Phase 0: Init
      const initOk = await phaseInit(startUrl);
      if (!initOk) {
        resetUI();
        return;
      }

      // Phase 1: Crawl
      await phaseCrawl();

      // Phase 2: Check links
      await phaseCheckLinks();

      // Phase 3: Build report
      phaseBuildReport();

      // Display
      displayResults();
      setupVisualizer();

      const totalTime = ((Date.now() - overallStart) / 1000).toFixed(1);
      statusBar.style.width = '100%';
      statusText.innerText = `اكتمل الفحص في ${totalTime}s! تم زحف ${crawledUrls.size} صفحة وعثر على ${finalReport.length} مشكلة.`;

    } catch (err) {
      console.error('Crawl failed:', err);
      showToast(`خطأ غير متوقع: ${err.message}`);
    } finally {
      resetUI();
    }
  }

  function resetUI() {
    isCrawling = false;
    startCrawlBtn.disabled = false;
    startCrawlBtn.innerHTML = `<i class="bi bi-search ms-2"></i>ابدأ الفحص`;
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════

  startCrawlBtn.addEventListener('click', startCrawl);
  exportCsvBtn.addEventListener('click', exportToCsv);

})();
