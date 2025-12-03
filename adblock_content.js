if (typeof browser === 'undefined') {
  var browser = chrome;
}

function injectCss(selectors) {
  if (!selectors || selectors.length === 0) return;
  const style = document.createElement('style');
  style.textContent = selectors.map(s => `${s} { display: none !important; visibility: hidden !important; height: 0 !important; width: 0 !important; opacity: 0 !important; pointer-events: none !important; }`).join('\n');
  (document.head || document.documentElement).appendChild(style);
}

function getPageLanguage() {
  return document.documentElement.lang.split('-')[0].toLowerCase();
}

function autoSkipVideoAds() {
  const trySkip = (root = document) => {
    const skipBtn = root.querySelector('.ytp-ad-skip-button');
    if (skipBtn) {
      skipBtn.click();
    }
    const closeBtns = root.querySelectorAll('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot .close-button');
    closeBtns.forEach(btn => btn.click());
  };
  return trySkip;
}

function guardWindowOpen() {
  let lastUserEventTs = 0;
  const markUserEvent = () => { lastUserEventTs = Date.now(); };
  ['click','mousedown','touchstart','keydown'].forEach(evt => {
    window.addEventListener(evt, markUserEvent, { capture: true, passive: true });
  });
  const origOpen = window.open;
  try {
    window.open = function(...args) {
      const now = Date.now();
      const userInitiated = (now - lastUserEventTs) < 1000;
      const url = args[0];
      if (!userInitiated || (url && isBadUrl(url))) {
        return null;
      }
      return origOpen.apply(window, args);
    };
  } catch (e) {}
}

function deepSanitize(o) {
  if (!o || typeof o !== 'object') return o;
  Object.keys(o).forEach(k => {
    const nk = k.toLowerCase();
    if (nk.includes('ad')) {
      const v = o[k];
      if (Array.isArray(v)) o[k] = [];
      else if (typeof v === 'object') o[k] = {};
      else o[k] = null;
    } else {
      deepSanitize(o[k]);
    }
  });
  return o;
}

function hookInitialPlayerResponse() {
  let val;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return val; },
      set(v) { val = deepSanitize(v); }
    });
  } catch (e) {}
  let dataVal;
  try {
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      get() { return dataVal; },
      set(v) { dataVal = deepSanitize(v); }
    });
  } catch (e) {}
}

function patchFetch() {
  const orig = window.fetch;
  if (!orig) return;
  window.fetch = async function(...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : (req && req.url);
    const r = await orig.apply(this, args);
    try {
      if (url && /\/youtubei\/.+\/(player|next)/.test(url)) {
        const clone = r.clone();
        const json = await clone.json();
        const cleaned = deepSanitize(json);
        const headers = new Headers(r.headers);
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(cleaned), { status: r.status, statusText: r.statusText, headers });
      }
    } catch (e) {}
    return r;
  };
}

async function main() {
  const { enabled = true } = await browser.storage.local.get('enabled');
  if (!enabled) return;

  let allElementHidingSelectors = [];
  try {
    const response = await fetch(browser.runtime.getURL('rules.json'));
    const rules = await response.json();
    const globalSelectors = rules.globalElementHidingSelectors || [];
    const pageLanguage = getPageLanguage();
    const languageSpecificSelectors = rules.languageSpecificElementHidingSelectors[pageLanguage] || [];
    allElementHidingSelectors = [...globalSelectors, ...languageSpecificSelectors];
    const nf = rules.networkFilters || [];
    if (Array.isArray(nf) && nf.length) {
      hosts = nf.map(s => String(s).toLowerCase());
    } else {
      hosts = [
        'adfox','doubleclick','googlesyndication','googletagservices','googletagmanager',
        'taboola','outbrain','criteo','rubiconproject','pubmatic','openx',
        'adform','smartadserver','moatads','adsafeprotected','mgid','revcontent',
        'yandex.ru/ads','ad.mail.ru','ad.rambler.ru','marketgid.com','kadam.net',
        'directadvert.ru','bodyclick.net','smi2.ru','relap.io','mgts.ru/ad',
        'begun.ru','rtb.mts.ru','adriver.ru','adv.rbc.ru','ad.kommersant.ru',
        'ad.vedomosti.ru','ad.forbes.ru','ad.gazeta.ru','ad.lenta.ru','ad.ria.ru',
        'ad.tass.ru','ad.interfax.ru','ad.vesti.ru','ad.tvrain.ru','ad.echo.msk.ru',
        'ad.fontanka.ru','ad.ngs.ru','ad.e1.ru','ad.nn.ru','ad.kazan.ru',
        'ad.ufa.ru','ad.chel.ru','ad.omsk.ru','ad.nsk.ru','ad.spb.ru','ad.msk.ru'
      ];
    }
  } catch (e) {
    console.error('Failed to load rules.json:', e);
  }
  injectCss(allElementHidingSelectors);

  guardWindowOpen();
  hookInitialPlayerResponse();
  patchFetch();
  await applyUserRules();
  setupPickerMessaging();
  observeDOMChanges();
}

main();

async function applyUserRules() {
  try {
    const { userRules = {} } = await browser.storage.local.get('userRules');
    const host = location.hostname;
    const selectors = userRules[host] || [];
    if (selectors.length) {
      const style = document.createElement('style');
      style.textContent = selectors.map(s => `${s} { display: none !important; }`).join('\n');
      (document.head || document.documentElement).appendChild(style);
    }
  } catch (e) {}
}

function setupPickerMessaging() {
  let pickerEnabled = false;
  let hoverEl = null;
  let hoverBox = null;
  let menu = null;

  const makeHoverBox = () => {
    const d = document.createElement('div');
    d.style.position = 'absolute';
    d.style.pointerEvents = 'none';
    d.style.border = '2px solid #00a64f';
    d.style.zIndex = '2147483646';
    d.style.background = 'rgba(0,166,79,0.06)';
    return d;
  };

  const makeMenu = () => {
    const m = document.createElement('div');
    m.style.position = 'absolute';
    m.style.zIndex = '2147483647';
    m.style.background = '#fff';
    m.style.border = '1px solid #ccc';
    m.style.borderRadius = '6px';
    m.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)';
    m.style.fontFamily = 'Arial, sans-serif';
    m.style.fontSize = '12px';
    m.style.color = '#222';
    m.style.padding = '6px';
    const btnHide = document.createElement('button');
    btnHide.textContent = 'Скрыть';
    btnHide.style.marginRight = '6px';
    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Отмена';
    [btnHide, btnCancel].forEach(b => { b.style.padding = '4px 8px'; b.style.border = '1px solid #ccc'; b.style.borderRadius = '4px'; b.style.background = '#f5f5f5'; b.style.cursor = 'pointer'; });
    m.appendChild(btnHide); m.appendChild(btnCancel);
    btnHide.addEventListener('click', async () => {
      if (!hoverEl) return;
      const selector = buildSelector(hoverEl);
      if (!selector) { disablePicker(); return; }
      injectRule(selector);
      await saveRule(selector);
      disablePicker();
    });
    btnCancel.addEventListener('click', () => { disablePicker(); });
    return m;
  };

  const positionBox = (el) => {
    if (!hoverBox) return;
    const r = el.getBoundingClientRect();
    hoverBox.style.left = `${r.left + window.scrollX}px`;
    hoverBox.style.top = `${r.top + window.scrollY}px`;
    hoverBox.style.width = `${r.width}px`;
    hoverBox.style.height = `${r.height}px`;
  };

  const injectRule = (selector) => {
    const style = document.createElement('style');
    style.textContent = `${selector} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };

  const saveRule = async (selector) => {
    const { userRules = {} } = await browser.storage.local.get('userRules');
    const host = location.hostname;
    const arr = userRules[host] || [];
    if (!arr.includes(selector)) arr.push(selector);
    userRules[host] = arr;
    await browser.storage.local.set({ userRules });
  };

  const buildSelector = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0,2);
    if (cls.length) return `${el.tagName.toLowerCase()}.${cls.map(c => CSS.escape(c)).join('.')}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      const tag = node.tagName.toLowerCase();
      let nth = 1, sib = node;
      while ((sib = sib.previousElementSibling) && sib.tagName.toLowerCase() === tag) nth++;
      parts.unshift(`${tag}:nth-of-type(${nth})`);
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : null;
  };

  const enablePicker = () => {
    if (pickerEnabled) return;
    if (document.visibilityState !== 'visible') return;
    pickerEnabled = true;
    hoverBox = makeHoverBox();
    document.documentElement.appendChild(hoverBox);
    menu = makeMenu();
    document.documentElement.appendChild(menu);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  };

  const disablePicker = () => {
    pickerEnabled = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    hoverBox = null; menu = null; hoverEl = null;
  };

  const onMove = (e) => {
    if (!pickerEnabled) return;
    const el = e.target;
    hoverEl = el;
    positionBox(el);
    if (menu) {
      menu.style.left = `${e.pageX + 8}px`;
      menu.style.top = `${e.pageY + 8}px`;
    }
  };

  const onClick = (e) => {
    if (!pickerEnabled) return;
    e.preventDefault();
    e.stopPropagation();
  };

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'startPicker') {
      enablePicker();
    }
  });
}

function hideGifAds() {
  const scan = (root = document) => {
    const nodes = root.querySelectorAll('img[src$=".gif"], picture source[srcset*=".gif"], iframe[src*=".gif"], [style*=".gif"]');
    nodes.forEach(n => { checkEl(n); });
  };
  return scan;
}



function hidePopupsAndModals() {
  const popupSelectors = [
    '.popup', '.modal', '.ad-popup', '.ad-modal', '.overlay', '.backdrop', '.dialog',
    '[class*="-popup"]', '[class*="-modal"]', '[class*="-overlay"]', '[class*="-dialog"]',
    '[id*="-popup"]', '[id*="-modal"]', '[id*="-overlay"]', '[id*="-dialog"]',
    'div[aria-modal="true"]', 'div[role="dialog"]',
    'div[data-qa="modal"]', 'div[data-testid="modal"]',
    'div[data-adblock-popup]'
  ];

  const scan = (root = document) => {
    const allPopupElements = root.querySelectorAll(popupSelectors.join(', '));
    allPopupElements.forEach(el => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) { // Only hide visible elements
        hideEl(el);
      }
    });

    // Remove overflow: hidden from body if present (common for modals)
    if (root === document) { // Only apply to document body/documentElement
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
      }
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = '';
      }
    }
  };

  return scan;
}

function hideFlashObjects() {
  const scan = (root = document) => {
    const objs = root.querySelectorAll('object, embed');
    objs.forEach(el => {
      const data = (el.getAttribute('data') || el.getAttribute('src') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const bad = data.endsWith('.swf') || type.includes('flash');
      const mark = /(ad|ads|banner|promo|sponsor)/.test(data);
      if (bad && mark) {
        el.remove();
      }
    });
  };
  return scan;
}

let hosts = [];

const sizes = [
  [728,90],[970,250],[300,250],[336,280],[320,50],[160,600],[300,600],[468,60],[980,120],
  [970,90],[970,200],[300,100],[320,100],[240,400],[234,60],[120,600],[180,150]
];
const near = (a,b)=>Math.abs(a-b)<=6;
const isAdSize = (el)=>{
  const r = el.getBoundingClientRect();
  return sizes.some(([w,h])=>near(r.width,w)&&near(r.height,h));
};
const hasMark = (s)=>/(^|\b)(ad|ads|adv|advert|advertising|banner|sponsor|promo)(\b|$)/.test(s) || /(реклам|баннер)/.test(s);
const hasAncestorMark = (el, depth=4)=>{
  let node = el ? el.parentElement : null;
  let d = 0;
  while (node && d < depth) {
    const id = (node.id || '').toLowerCase();
    const cls = (node.className + '').toLowerCase();
    if (hasMark(id) || hasMark(cls)) return true;
    node = node.parentElement; d++;
  }
  return false;
};
const isGif = (s)=>/\.gif(\?|#|$)/.test(String(s||'').toLowerCase());
const isBadUrl = (u)=>{
  const s = String(u||'').toLowerCase();
  return hosts.some(h=>s.includes(h)) || /(^|\b)(ad|ads|banner|promo|sponsor)(\b|$)/.test(s);
};
const hideEl = (el)=>{ el.style.display='none'; el.style.visibility='hidden'; el.style.opacity='0'; el.style.pointerEvents='none'; cleanupParent(el); };
function cleanupParent(el){
  const p = el && el.parentElement;
  if (!p) return;
  const id = (p.id||'').toLowerCase();
  const cls = (p.className+'').toLowerCase();
  if (hasMark(id) || hasMark(cls)){
    const kids = Array.from(p.children);
    if (kids.length && kids.every(c=>getComputedStyle(c).display==='none')){
      p.style.display='none'; p.style.visibility='hidden'; p.style.opacity='0'; p.style.pointerEvents='none';
    }
  }
}

const checkEl = (el)=>{
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (el.className + '').toLowerCase();
  const styleAttr = el.getAttribute('style') || '';

  // 1. Check for common ad markers in id, class, and inline style (cheap)
  if (hasMark(id) || hasMark(cls) || hasMark(styleAttr)) { hideEl(el); return true; }

  // 2. Check specific tags and their attributes (medium cost)
  if (tag === 'iframe' || tag === 'img' || tag === 'ins' || tag === 'source' || tag === 'picture' || tag === 'a') {
    const src = el.getAttribute('src') || '';
    const dataSrc = el.getAttribute('data-src') || '';
    const srcset = el.getAttribute('srcset') || '';
    const dataSrcset = el.getAttribute('data-srcset') || '';
    const href = el.getAttribute('href') || '';
    const alt = el.getAttribute('alt') || '';
    if (isBadUrl(src) || isBadUrl(dataSrc) || isBadUrl(srcset) || isBadUrl(dataSrcset) || isBadUrl(href) || hasMark(alt)) { hideEl(el); return true; }
    const anc = el.closest('a');
    if (anc) {
      const ah = anc.getAttribute('href') || '';
      if (isBadUrl(ah) || hasMark(ah)) { hideEl(anc); return true; }
    }
    if (isGif(src) || isGif(dataSrc) || isGif(srcset) || isGif(dataSrcset)) {
      if (tag === 'source') {
        const pic = el.closest('picture');
        if (pic && (hasAncestorMark(pic) || isAdSize(pic))) { hideEl(pic); return true; }
      } else if (tag === 'picture') {
        const gifChild = el.querySelector('source[srcset*=".gif"], img[src$=".gif"]');
        if (gifChild && (hasAncestorMark(el) || isAdSize(el))) { hideEl(el); return true; }
      } else {
        if (hasAncestorMark(el) || isAdSize(el)) { hideEl(el); return true; }
      }
    }
  }

  // 3. Check for data-* attributes (medium cost)
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && isBadUrl(attr.value)) { hideEl(el); return true; }
  }

  // 4. Check for noscript tags (medium cost)
  if (tag === 'noscript') {
    const noscriptContent = el.textContent || '';
    if (hasMark(noscriptContent) || hosts.some(h => noscriptContent.includes(h))) { hideEl(el); return true; }
  }

  // Defer expensive checks: Only perform these if the element is potentially visible and not already hidden by cheaper checks.
  // Check for offsetParent to quickly discard elements not in the rendered tree.
  if (el.offsetParent !== null) {
    // 5. Check for ad sizes (potentially expensive due to getBoundingClientRect)
    if (isAdSize(el)) { hideEl(el); return true; }

    // 6. Check for background images (expensive due to window.getComputedStyle)
    const computedStyle = window.getComputedStyle(el);
    const backgroundImage = computedStyle.getPropertyValue('background-image');
    if (backgroundImage && backgroundImage !== 'none') {
      const urlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (urlMatch && urlMatch[1]) {
        const u = urlMatch[1];
        if (isBadUrl(u) || isGif(u)) {
          if (hasAncestorMark(el) || isAdSize(el)) { hideEl(el); return true; }
        }
      }
    }
  }

  // 7. Check for nested iframes, images, ins (expensive due to querySelector)
  const ifr = el.querySelector('iframe, img, ins');
  if (ifr) {
    const s1 = ifr.getAttribute('src') || '';
    const s2 = ifr.getAttribute('data-src') || '';
    const s3 = ifr.getAttribute('srcset') || '';
    if (isBadUrl(s1) || isBadUrl(s2) || isBadUrl(s3) || isAdSize(ifr)) { hideEl(ifr); return true; }
    if (isAdSize(el) && (hasAncestorMark(el) || el.matches('div,section,aside,header,figure'))) { hideEl(el); return true; }
  }
  return false;
};

function enhancedFindHideAds() {
  const scan = (root = document)=>{
    const nodes = root.querySelectorAll('iframe, img, ins, div, section, aside');
    nodes.forEach(n=>{ checkEl(n); });
  };
  return scan;
}

function observeDOMChanges() {
  const scanGif = hideGifAds();
  const scanPopups = hidePopupsAndModals();
  const scanFlash = hideFlashObjects();
  const scanEnhanced = enhancedFindHideAds();
  const scanVideoAds = autoSkipVideoAds();

  const fullScan = () => {
    scanGif();
    scanPopups();
    scanFlash();
    scanEnhanced();
    scanVideoAds();
  };

  const obs = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            checkEl(node);
            node.querySelectorAll('*').forEach(checkEl);
            scanGif(node);
            scanPopups(node);
            scanFlash(node);
            scanEnhanced(node);
            scanVideoAds(node);
          }
        }
      }
      if (mutation.type === 'attributes') {
        const t = mutation.target;
        if (t && t.nodeType === 1) {
          checkEl(t);
          if (mutation.attributeName && ['src','data-src','srcset','data-srcset','style','class'].includes(mutation.attributeName)) {
            scanGif(t);
          }
        }
      }
    }
  });

  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','data-src','srcset','data-srcset','style','class'] });
  fullScan();

  document.addEventListener('load', (e)=>{
    const el = e.target;
    if (el && el.nodeType === 1) {
      if (el.tagName === 'IMG' || el.tagName === 'IFRAME') {
        checkEl(el);
        scanGif(el);
      }
    }
  }, true);
}
