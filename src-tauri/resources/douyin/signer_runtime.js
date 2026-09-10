"use strict";

try {
(() => {
  __phase("prelude");
  // QuickJS 的 Error.stack 不含消息行（goja 含），统一格式化避免丢失真实错误。
  const formatError = error => {
    if (!error) return String(error);
    const head = error.name && error.message ? `${error.name}: ${error.message}` : String(error && error.message || error);
    return error.stack ? `${head}\n${error.stack}` : head;
  };
  const mode = __config.mode;
  const targetUrl = __config.targetUrl;
  const method = __config.method || "GET";
  const body = __config.body || "";
  const userAgent = __config.userAgent;

  const binaryToBytes = value => {
    const text = String(value || "");
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
    return out;
  };
  const bytesToBinary = value => {
    const data = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    let output = "";
    for (let i = 0; i < data.length; i++) output += String.fromCharCode(data[i]);
    return output;
  };
  const nativeUint8ArrayFrom = Uint8Array.from.bind(Uint8Array);
  Uint8Array.from = (source, mapFn, thisArg) => {
    if (typeof source !== "string") return nativeUint8ArrayFrom(source, mapFn, thisArg);
    const out = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index++) {
      const value = source.charAt(index);
      out[index] = typeof mapFn === "function" ? mapFn.call(thisArg, value, index) : value;
    }
    return out;
  };

  class URLSearchParams {
    constructor(value = "", changed = null) {
      this.values = [];
      this.changed = changed;
      if (value instanceof URLSearchParams) {
        this.values = value.values.map(item => item.slice());
      } else if (Array.isArray(value)) {
        for (const item of value) this.append(item[0], item[1]);
      } else if (value && typeof value === "object") {
        for (const key of Object.keys(value)) this.append(key, value[key]);
      } else {
        const input = String(value || "").replace(/^\?/, "");
        if (input) {
          for (const part of input.split("&")) {
            const split = part.indexOf("=");
            const key = split < 0 ? part : part.slice(0, split);
            const val = split < 0 ? "" : part.slice(split + 1);
            this.values.push([decodeURIComponent(key.replace(/\+/g, " ")), decodeURIComponent(val.replace(/\+/g, " "))]);
          }
        }
      }
    }
    notify() { if (this.changed) this.changed(this.toString()); }
    append(key, value) { this.values.push([String(key), String(value)]); this.notify(); }
    delete(key) { key = String(key); this.values = this.values.filter(item => item[0] !== key); this.notify(); }
    get(key) { key = String(key); const item = this.values.find(value => value[0] === key); return item ? item[1] : null; }
    getAll(key) { key = String(key); return this.values.filter(value => value[0] === key).map(value => value[1]); }
    has(key) { key = String(key); return this.values.some(value => value[0] === key); }
    set(key, value) {
      key = String(key); value = String(value);
      let found = false;
      this.values = this.values.filter(item => {
        if (item[0] !== key) return true;
        if (!found) { item[1] = value; found = true; return true; }
        return false;
      });
      if (!found) this.values.push([key, value]);
      this.notify();
    }
    sort() { this.values.sort((a, b) => a[0].localeCompare(b[0])); this.notify(); }
    forEach(callback, thisArg) { for (const [key, value] of this.values) callback.call(thisArg, value, key, this); }
    *entries() { for (const item of this.values) yield item.slice(); }
    *keys() { for (const item of this.values) yield item[0]; }
    *valuesIterator() { for (const item of this.values) yield item[1]; }
    values() { return this.valuesIterator(); }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this.values.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&"); }
  }

  class URL {
    constructor(value, base) {
      this.parts = JSON.parse(__parseURL(String(value), base == null ? "" : String(base)));
      this.searchParams = new URLSearchParams(this.parts.search, query => {
        this.parts = JSON.parse(__setURLQuery(this.parts.href, query));
      });
    }
    get href() { return this.parts.href; }
    set href(value) { this.parts = JSON.parse(__parseURL(String(value), "")); this.searchParams = new URLSearchParams(this.parts.search, query => { this.parts = JSON.parse(__setURLQuery(this.parts.href, query)); }); }
    get origin() { return this.parts.origin; }
    get protocol() { return this.parts.protocol; }
    get username() { return this.parts.username; }
    get password() { return this.parts.password; }
    get host() { return this.parts.host; }
    get hostname() { return this.parts.hostname; }
    get port() { return this.parts.port; }
    get pathname() { return this.parts.pathname; }
    get search() { return this.parts.search ? `?${this.parts.search}` : ""; }
    set search(value) { const query = String(value || "").replace(/^\?/, ""); this.parts = JSON.parse(__setURLQuery(this.parts.href, query)); this.searchParams = new URLSearchParams(query, next => { this.parts = JSON.parse(__setURLQuery(this.parts.href, next)); }); }
    get hash() { return this.parts.hash ? `#${this.parts.hash}` : ""; }
    toString() { return this.parts.href; }
    toJSON() { return this.parts.href; }
  }

  class TextEncoder {
    encode(value) { return new Uint8Array(JSON.parse(__utf8Encode(String(value)))); }
  }
  class TextDecoder {
    decode(value) { return __utf8Decode(JSON.stringify(Array.from(new Uint8Array(value || 0)))); }
  }
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
    clear() { this.values.clear(); }
    key(index) { return [...this.values.keys()][index] ?? null; }
    get length() { return this.values.size; }
  }
  class FakeXHR {
    constructor() { this.headers = {}; this.readyState = 0; this.status = 200; }
    open(requestMethod, url) { this.method = requestMethod; this.url = String(url); this.readyState = 1; }
    setRequestHeader(name, value) { this.headers[String(name)] = String(value); }
    addEventListener() {}
    getAllResponseHeaders() { return ""; }
    send(value) {
      this.body = value;
      this.readyState = 4;
      if (typeof this.onreadystatechange === "function") this.onreadystatechange();
      if (typeof this.onloadend === "function") this.onloadend();
    }
  }
  class FakeImage {
    constructor() { this.width = 0; this.height = 0; this.complete = true; }
    set src(value) { this._src = String(value); setTimeout(() => { if (typeof this.onload === "function") this.onload(); }, 0); }
    get src() { return this._src || ""; }
  }
  class Blob { constructor(parts = [], options = {}) { this.parts = parts; this.type = options.type || ""; this.size = parts.reduce((n, part) => n + String(part).length, 0); } }
  class Headers { constructor(value = {}) { this.values = { ...value }; } get(key) { return this.values[key] ?? null; } set(key, value) { this.values[key] = String(value); } }
  class Request { constructor(url, options = {}) { this.url = String(url); Object.assign(this, options); } }
  class Response { constructor(value = "", options = {}) { this.body = value; this.status = options.status || 200; this.headers = new Headers(options.headers); } async text() { return String(this.body); } async json() { return JSON.parse(String(this.body)); } }
  class FormData { constructor() { this.values = []; } append(key, value) { this.values.push([String(key), value]); } }

  function element(tag) {
    const base = {
      tagName: String(tag).toUpperCase(), style: {}, children: [],
      appendChild(child) { this.children.push(child); return child; }, removeChild() {},
      setAttribute(name, value) { this[name] = String(value); }, getAttribute(name) { return this[name] ?? null; },
      addEventListener() {}, removeEventListener() {}, getContext() { return null; }, toDataURL() { return "data:,"; },
      getBoundingClientRect() { return { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }; },
    };
    return new Proxy(base, { get(target, key) { return key in target ? target[key] : ""; } });
  }

  const document = {
    cookie: "", referrer: "https://www.douyin.com/", visibilityState: "visible", readyState: "complete",
    documentElement: element("html"), body: element("body"), head: element("head"), createElement: element,
    createElementNS(_ns, tag) { return element(tag); }, createTextNode(text) { return { data: String(text), textContent: String(text) }; },
    getElementById() { return null; }, getElementsByTagName() { return []; }, querySelector() { return null; }, querySelectorAll() { return []; },
    hasFocus() { return true; }, getSelection() { return null; }, addEventListener() {}, removeEventListener() {},
  };
  const location = new URL("https://www.douyin.com/login_page");
  const navigator = new Proxy({
    userAgent, platform: "Win32", vendor: "Google Inc.", vendorSub: "", product: "Gecko", productSub: "20030107",
    appName: "Netscape", appCodeName: "Mozilla", appVersion: "5.0 (Windows)", oscpu: "", cpuClass: "x86",
    language: "zh-CN", languages: ["zh-CN", "zh"], cookieEnabled: true, hardwareConcurrency: 8, deviceMemory: 8,
    maxTouchPoints: 0, webdriver: false, doNotTrack: null, onLine: true, pdfViewerEnabled: true, plugins: [], mimeTypes: [],
    connection: { effectiveType: "4g", type: "wifi", rtt: 50, downlink: 10, saveData: false },
    userAgentData: { brands: [{ brand: "Chromium", version: "150" }, { brand: "Google Chrome", version: "150" }], mobile: false, platform: "Windows", getHighEntropyValues: async () => ({ architecture: "x86", bitness: "64", model: "", platformVersion: "19.0.0", uaFullVersion: "150.0.0.0" }) },
    mediaDevices: { enumerateDevices: async () => [] }, permissions: { query: async () => ({ state: "prompt" }) },
    storage: { estimate: async () => ({ quota: 0, usage: 0 }) }, getBattery: async () => ({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 }),
  }, { get(target, key) { return key in target ? target[key] : ""; } });
  const screen = new Proxy({ width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0, colorDepth: 24, pixelDepth: 24, orientation: { angle: 0, type: "landscape-primary" } }, { get(target, key) { return key in target ? target[key] : 0; } });
  const performance = { now: () => __performanceNow(), timeOrigin: Date.now() - 1000, memory: { jsHeapSizeLimit: 4294705152, totalJSHeapSize: 67108864, usedJSHeapSize: 33554432 }, timing: { navigationStart: Date.now() - 1000, domContentLoadedEventEnd: Date.now() - 500, loadEventEnd: Date.now() - 250 }, navigation: { type: 0, redirectCount: 0 }, getEntriesByType: () => [], getEntries: () => [] };

  Object.assign(globalThis, {
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob, Request, Response, Headers, FormData,
    performance, location, document, navigator, screen, localStorage: new Storage(), sessionStorage: new Storage(),
    XMLHttpRequest: FakeXHR, Image: FakeImage, fetch: async () => new Response("", { status: 200 }),
    queueMicrotask: callback => setTimeout(callback, 0), requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: clearTimeout, requestIdleCallback: callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
    cancelIdleCallback: clearTimeout, atob: value => bytesToBinary(new Uint8Array(JSON.parse(__base64Decode(String(value))))),
    btoa: value => __base64Encode(JSON.stringify(Array.from(binaryToBytes(value)))), addEventListener() {}, removeEventListener() {},
    innerWidth: 1920, innerHeight: 919, outerWidth: 1920, outerHeight: 1040, devicePixelRatio: 1,
    chrome: { runtime: {}, app: {}, csi() { return {}; }, loadTimes() { return {}; } }, history: { length: 2, state: null, scrollRestoration: "auto" },
    screenX: 0, screenY: 0, screenLeft: 0, screenTop: 0, pageXOffset: 0, pageYOffset: 0, scrollX: 0, scrollY: 0,
    orientation: 0, crossOriginIsolated: false, visualViewport: { width: 1920, height: 919, scale: 1, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0 },
  });
  globalThis.window = globalThis;
  globalThis.self = globalThis;

  const randomValues = value => {
    const bytes = JSON.parse(__randomBytes(value.byteLength));
    value.set(bytes);
    return value;
  };
  globalThis.crypto = {
    getRandomValues: randomValues,
    randomUUID: () => __randomUUID(),
    subtle: {
      digest: async (_algorithm, value) => new Uint8Array(JSON.parse(__sha256Bytes(JSON.stringify(Array.from(new Uint8Array(value)))))).buffer,
    },
  };
  globalThis.DTraitUcCryptoJSUtil = {
    base642buff(value) { return new Uint8Array(JSON.parse(__base64Decode(String(value)))); },
    buff2base64(value) { return __base64Encode(JSON.stringify(Array.from(new Uint8Array(value)))); },
    bufferConcat(values) { const size = values.reduce((n, value) => n + value.byteLength, 0); const out = new Uint8Array(size); let offset = 0; for (const value of values) { const bytes = new Uint8Array(value); out.set(bytes, offset); offset += bytes.length; } return out; },
    getQuery(url) { return Object.fromEntries(new URL(url || location.href, location.href).searchParams); },
    getRandomValues: randomValues,
    hexToUint8Array(value) { return new Uint8Array(JSON.parse(__hexDecode(String(value)))); },
    isSupportSystemCrypto() { return true; },
    parseQuery(value) { return Object.fromEntries(new URLSearchParams(String(value || "").replace(/^\?/, ""))); },
    uint8ArrayToHex(value) { return __hexEncode(JSON.stringify(Array.from(new Uint8Array(value)))); },
    unit8ArrayToString(value) { return bytesToBinary(new Uint8Array(value)); },
  };
  let lastAesKey = "";
  globalThis.DTraitUcAesEncrypt = {
    supportSystemCrypto: true, cryptoJS: null, initPromise: Promise.resolve(true),
    getAesKey() { lastAesKey = __randomHex(16); return lastAesKey; }, init() { return Promise.resolve(true); },
    async encryptData(keyHex, plaintext) {
      const key = String(keyHex || lastAesKey || (lastAesKey = __randomHex(16)));
      return JSON.parse(__aesEncrypt(key, String(plaintext)));
    },
    encryptDataWithLocal(keyHex, plaintext) { return this.encryptData(keyHex, plaintext); },
    encryptDataWithCryptoJS(keyHex, plaintext) { return this.encryptData(keyHex, plaintext); }, getTestResult() { return true; },
  };
  globalThis.DTraitUcRsaEncrypt = {
    supportSystemCrypto: true, JSEncrypt: null, initPromise: Promise.resolve(true), init() { return Promise.resolve(true); },
    async encryptData(publicKey, plaintext) { return __rsaEncrypt(String(publicKey || ""), String(plaintext)); },
  };

  __phase("bdms_eval");
  const bdmsCode = __bdmsSource.replace(
    "var e=function(t){for(var e=atob(t),r=0,n=4;n<8;++n)r+=e.charCodeAt(n);return{d:T(Uint8Array.from(e.slice(8),_,r%256)),i:0}}(t);",
    "var e={d:new Uint8Array(JSON.parse(__decodePacked(t))),i:0};",
  );
  (0, eval)(bdmsCode);
  if (!globalThis.bdms) throw new Error("BDMS did not initialize");
  __phase("bdms_init");
  globalThis.bdms.init({ aid: 6383, pageId: 41079, paths: ["/passport/", "/aweme/"] });

  const issueRequest = waitMs => {
    const request = new globalThis.XMLHttpRequest();
    request.open(method, targetUrl, true);
    request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    request.send(body);
    const inspect = () => {
      try {
        const signedUrl = new URL(request.url);
        const aBogus = signedUrl.searchParams.get("a_bogus") || "";
        if (aBogus.length < 180) throw new Error(`unexpected a_bogus length: ${aBogus.length}`);
        if (mode === "sign") return __emit(JSON.stringify({ a_bogus: aBogus }));
        const dtrait = request.headers["x-tt-session-dtrait"] || "";
        if (!dtrait.startsWith("d1_") || dtrait.length < 600) {
          throw new Error(`unexpected dtrait length: ${dtrait.length}; prefix=${dtrait.slice(0, 8)}; rejections=${__promiseRejections()}`);
        }
        __emit(JSON.stringify({
          "x-tt-session-dtrait": dtrait,
          "bd-ticket-guard-ree-public-key": __ecdhPublicKey(),
          "bd-ticket-guard-version": "2",
          "bd-ticket-guard-web-sign-type": "0",
          "bd-ticket-guard-web-version": "2",
        }));
      } catch (error) { __fail(formatError(error)); }
    };
    if (waitMs > 0) setTimeout(inspect, waitMs); else inspect();
  };

  if (mode === "sign") {
    __phase("sign_request");
    issueRequest(0);
    return;
  }
  let dtraitSource = __dtraitSource;
  dtraitSource = dtraitSource.replace(/\n\/\/# sourceMappingURL=.*$/, "");
  dtraitSource = dtraitSource.replace(
    "(r(3504),r(4216),r(4342),r(5517),r(5210),r(9392),r(748),r(1424),r(2149),r(9951),r(7526),r(1609),r(8254),r(187),r(6915),r(5481),r(4354),r(5789),r(901),r(5353),r(4310),r(8176),r(3985),r(7960),r(650),r(4168),[])",
    "[]",
  );
  dtraitSource = dtraitSource.replace(
    'var t=function(t){for(var e=atob(t),r=0,n=4;n<8;++n)r+=e.charCodeAt(n);return{d:(o=Uint8Array.from(e.slice(8),ct,r%256),X(o,{i:2},i&&i.out,i&&i.dictionary)),i:0};var o,i}("',
    'var t={d:new Uint8Array(JSON.parse(__decodePacked("',
  );
  dtraitSource = dtraitSource.replace(
    '");tt.length=0,et.length=0,rt.clear();',
    '"))),i:0};tt.length=0,et.length=0,rt.clear();',
  );
  dtraitSource = dtraitSource.replace("function it(t,e){var r=et[t];", "function it(t,e){var r=et[t];r.__id=t;");
  dtraitSource = dtraitSource.replace("function ut(t,e,r,n){var o,i,u,a,s,c,f,l,h=-1,v=[],p=[];", 'function ut(t,e,r,n){var qfn=t.__id;if(45===qfn&&r[0]&&r[0].str)Object.keys(r[0].str).forEach(function(k){void 0===r[0].str[k]&&(r[0].str[k]="")});var o,i,u,a,s,c,f,l,h=-1,v=[],p=[];');
  dtraitSource = dtraitSource.replace("et.push([c,o,i,u])", "et.push([c,o,i,u]),et[et.length-1].__id=et.length-1");
  const dtraitParams = JSON.parse(__dtraitParams);
  const server = __config.serverParams || {};
  Object.assign(dtraitParams, {
    centralRsaPub: server["x-tt-session-dtrait-pk1"] || dtraitParams.centralRsaPub,
    centralVersion: server["x-tt-session-dtrait-pk1-version"] || dtraitParams.centralVersion,
    edgeRsaPub: server["x-tt-session-dtrait-pk2"] || dtraitParams.edgeRsaPub,
    edgeVersion: server["x-tt-session-dtrait-pk2-version"] || dtraitParams.edgeVersion,
    urlVersion: server["x-tt-session-dtrait-fe-url-version"] || dtraitParams.urlVersion,
    dTraitVersion: server["x-tt-session-dtrait-version"] || dtraitParams.dTraitVersion,
  });
  __phase("dtrait_eval");
  (0, eval)(dtraitSource);
  const Dtrait = globalThis.DTraitSDK.default || globalThis.DTraitSDK;
  const noop = () => {};
  __phase("dtrait_init");
  Dtrait.getInstance(dtraitParams, { dTraitPath: ["/passport"], dTraitHost: [], urlRewriteRules: [], containerSdkVersion: "1.0.25", libraGroup: "", delayCollect: 0, monitor: { sendSlardarEvent: noop, sendSlardarLog: noop, sendTeaLog: noop } });
  setTimeout(() => issueRequest(1000), 3000);
})();
} catch (error) {
  const head = error && error.name && error.message ? `${error.name}: ${error.message}` : String(error);
  __fail(error && error.stack ? `${head}\n${error.stack}` : head);
}
