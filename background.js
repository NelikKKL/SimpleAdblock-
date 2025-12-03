if (typeof browser === 'undefined') {
  var browser = chrome;
}

let networkFilters = [];
let filterTokens = [];

async function loadFilters() {
  try {
    const response = await fetch(browser.runtime.getURL('rules.json'));
    const rules = await response.json();
    networkFilters = rules.networkFilters || [];
    filterTokens = networkFilters.map(s => String(s).toLowerCase());
  } catch (e) {
    console.error('Failed to load rules.json:', e);
  }
}

const isBadUrl = (u) => {
  try {
    const obj = new URL(u);
    const host = obj.hostname.toLowerCase();
    const path = (obj.pathname + obj.search).toLowerCase();
    if (filterTokens.some(t => host.includes(t))) return true;
    if (/(^|\b)(ad|ads|banner|promo|sponsor)(\b|$)/.test(path)) return true;
    return false;
  } catch (e) {
    const s = String(u || '').toLowerCase();
    return filterTokens.some(t => s.includes(t)) || /(^|\b)(ad|ads|banner|promo|sponsor)(\b|$)/.test(s);
  }
};

loadFilters();

browser.webRequest.onBeforeRequest.addListener(
  function(details) {
    const url = details.url;
    const isGif = /\.gif(\?|#|$)/i.test(url);
    if (isGif && details.type === 'image') {
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const path = (u.pathname + u.search).toLowerCase();
        if (filterTokens.some(t => host.includes(t)) || /(ad|ads|banner|promo|sponsor)/.test(path)) {
          return { cancel: true };
        }
      } catch (e) {
        if (filterTokens.some(t => url.toLowerCase().includes(t)) || /(ad|ads|banner|promo|sponsor)/i.test(url)) {
          return { cancel: true };
        }
      }
    }
    if (isBadUrl(url)) {
      return { cancel: true };
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "stylesheet", "script", "image", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"] },
  ["blocking"]
);

console.log("Simple AdBlock background script loaded.");
