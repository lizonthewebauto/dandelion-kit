/*
 * The in-card runtime for the Dandelion Kit widgets, inlined into every card page as a plain script.
 *
 * 1. A small MCP Apps bridge (spec 2026-01-26, the same wire messages as the ext-apps App class):
 *    JSON-RPC 2.0 over postMessage with the host (window.parent). ui/initialize, then ui/notifications/initialized,
 *    then the host sends tool-input and tool-result. The card can call tools/call, ui/open-link and
 *    ui/update-model-context, reports its height with ui/notifications/size-changed, and answers ping and
 *    ui/resource-teardown. Written by hand (a few KB) instead of inlining the large ext-apps bundle.
 * 2. Views: every card page carries all eight views so a tap can move on to the next step inside the same card
 *    (a widget cannot make the host draw a second card). DK.go(tool, data) shows the view that tool belongs to.
 * 3. Asset loaders: DK.asset, DK.img and DK.video build pictures and video from read_asset chunks as data: URLs
 *    (the default CSP allows no network, only data:).
 * 4. DOM helpers (text nodes only, user words are never parsed as markup), buttons, pills, meters, the two-tap confirm.
 *
 * Exposed as window.DK. Plain ES2017, no backticks.
 */
(function () {
  "use strict";
  var dataEl = document.getElementById("dk-data");
  var DATA = {};
  try { DATA = JSON.parse((dataEl && dataEl.textContent) || "{}") || {}; } catch (e) { DATA = {}; }
  var PLAT = DATA.platforms || {};
  var APP_URL = typeof DATA.appUrl === "string" ? DATA.appUrl : "";
  var DK = (window.DK = {});

  /* ------------------------------------------------------------------ */
  /* MCP Apps bridge                                                     */
  /* ------------------------------------------------------------------ */
  var PROTOCOL = "2026-01-26";
  var nextId = 1;
  var pending = {};
  var handlers = {};
  var hostCaps = {};
  var ctx = {};
  var sizing = false;
  var notes = [];

  function post(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* no host */ }
  }
  function rpc(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }
  function emit(name, arg) {
    var list = handlers[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](arg); } catch (e) { if (window.console) console.error(e); }
    }
  }
  DK.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); };

  var EVENTS = {
    "ui/notifications/tool-input": "input",
    "ui/notifications/tool-input-partial": "partial",
    "ui/notifications/tool-result": "result",
    "ui/notifications/tool-cancelled": "cancelled"
  };

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return; // only the host may talk to us
    var m = ev.data;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;
    var hasId = m.id !== undefined && m.id !== null;
    if (typeof m.method === "string") {
      if (hasId) {
        if (m.method === "ping") { post({ jsonrpc: "2.0", id: m.id, result: {} }); return; }
        if (m.method === "ui/resource-teardown") {
          emit("teardown", m.params || {});
          post({ jsonrpc: "2.0", id: m.id, result: {} });
          return;
        }
        post({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
        return;
      }
      if (m.method === "ui/notifications/host-context-changed") { applyContext(m.params || {}); return; }
      if (EVENTS[m.method]) emit(EVENTS[m.method], m.params || {});
      return;
    }
    if (hasId && pending[m.id]) {
      var p = pending[m.id];
      delete pending[m.id];
      if (m.error) p.reject(new Error((m.error && m.error.message) || "Something went wrong."));
      else p.resolve(m.result || {});
    }
  });

  function applyContext(c) {
    if (!c || typeof c !== "object") return;
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) ctx[k] = c[k];
    var root = document.documentElement;
    if (c.theme === "light" || c.theme === "dark") {
      root.setAttribute("data-theme", c.theme);
      root.style.colorScheme = c.theme;
    }
    var ins = c.safeAreaInsets;
    if (ins && typeof ins === "object") {
      ["top", "right", "bottom", "left"].forEach(function (side) {
        root.style.setProperty("--dk-safe-" + side, Math.max(0, Number(ins[side]) || 0) + "px");
      });
    }
    emit("context", ctx);
  }

  // Tell the host how tall we are (hosts size inline cards to their content).
  function watchSize() {
    if (sizing) return;
    sizing = true;
    var lastW = 0, lastH = 0, queued = false;
    function measure() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var root = document.documentElement;
        var prev = root.style.height;
        root.style.height = "max-content";
        var h2 = Math.ceil(root.getBoundingClientRect().height);
        root.style.height = prev;
        var w = Math.ceil(window.innerWidth);
        if (w === lastW && h2 === lastH) return;
        lastW = w; lastH = h2;
        notify("ui/notifications/size-changed", { width: w, height: h2 });
      });
    }
    measure();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(measure);
      ro.observe(document.documentElement);
      ro.observe(document.body);
    } else {
      window.addEventListener("resize", measure);
    }
    document.addEventListener("load", measure, true); // pictures finishing changes the height
  }

  function startBridge(appName) {
    rpc("ui/initialize", {
      appInfo: { name: appName, version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] },
      protocolVersion: PROTOCOL
    }).then(function (r) {
      hostCaps = (r && r.hostCapabilities) || {};
      applyContext((r && r.hostContext) || {});
      notify("ui/notifications/initialized", {});
      watchSize();
    }, function () { watchSize(); });
  }
  DK.ctx = function () { return ctx; };

  /* ------------------------------------------------------------------ */
  /* tools, links, and telling the model what happened                   */
  /* ------------------------------------------------------------------ */
  function textOf(r) {
    var c = r && r.content;
    return c && c.length && c[0] && typeof c[0].text === "string" ? c[0].text : "";
  }
  /** A tool result -> { ok: true, data } or { ok: false, message } (plain words from the server). */
  DK.read = function (r) {
    if (!r || typeof r !== "object") return { ok: false, message: "Something went wrong. Please try again." };
    if (r.isError) {
      var t = textOf(r);
      return { ok: false, message: t && t.length < 400 ? t : "Something went wrong. Please try again." };
    }
    if (r.structuredContent && typeof r.structuredContent === "object") return { ok: true, data: r.structuredContent };
    try {
      var d = JSON.parse(textOf(r));
      if (d && typeof d === "object") return { ok: true, data: Array.isArray(d) ? { items: d } : d };
    } catch (e) { /* no data */ }
    return { ok: true, data: {} };
  };
  /** Call a kit tool. Resolves with structuredContent; rejects with an Error in plain words. */
  DK.call = function (name, args) {
    return rpc("tools/call", { name: name, arguments: args || {} }).then(function (r) {
      var res = DK.read(r);
      if (!res.ok) throw new Error(res.message);
      return res.data;
    }, function () {
      throw new Error("The kit could not be reached just now. Please try again.");
    });
  };
  DK.openLink = function (url) {
    return rpc("ui/open-link", { url: url }).then(function (r) {
      if (r && r.isError) throw new Error("blocked");
    });
  };
  /** Keep the AI in the loop about taps in the card (each update replaces the last, so we send the whole list). */
  DK.tellModel = function (text) {
    notes.push(text);
    if (!hostCaps.updateModelContext) return;
    rpc("ui/update-model-context", { content: [{ type: "text", text: notes.join("\n") }] }).catch(function () {});
  };
  DK.appUrl = function (path) { return APP_URL + path; };

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) add(el, c[i]); return; }
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  DK.h = h;
  DK.add = add;
  var uid = 0;
  DK.uid = function (p) { uid += 1; return (p || "dk") + uid; };

  var NS = "http://www.w3.org/2000/svg";
  var GLYPHS = {
    check: "M20 6 9 17l-5-5",
    x: "M18 6 6 18M6 6l12 12",
    plus: "M12 5v14M5 12h14",
    alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
    stop: "M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM15 9l-6 6M9 9l6 6",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    out: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    pencil: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5zM15 5l4 4",
    photo: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM21 15l-5-5L5 21M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
    film: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM7 3v18M17 3v18M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4",
    folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
    doc: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6",
    back: "M19 12H5M12 19l-7-7 7-7",
    undo: "M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8",
    link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z",
    palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 3.6 10 8 0 3-2.5 5-5.5 5H15a2 2 0 0 0-1.5 3.3c.6.8.6 1.9-.1 2.7-.3.4-.8.6-1.4.6zM7.5 12.5h.01M9.5 7.5h.01M15 7.5h.01",
    layers: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    mic: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4"
  };
  DK.glyph = function (name, cls) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (name === "play") {
      s.setAttribute("class", "g fill" + (cls ? " " + cls : ""));
      var tri = document.createElementNS(NS, "path");
      tri.setAttribute("d", "M7 4v16l13-8z");
      s.appendChild(tri);
      return s;
    }
    s.setAttribute("class", "g" + (cls ? " " + cls : ""));
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", GLYPHS[name] || GLYPHS.check);
    s.appendChild(p);
    return s;
  };

  /* ------------------------------------------------------------------ */
  /* apps (channels)                                                     */
  /* ------------------------------------------------------------------ */
  DK.plat = function (id) {
    return PLAT[id] || { n: String(id || "App"), c: "#8a8a8a" };
  };
  DK.platDot = function (id) {
    var d = h("span", { class: "platdot", "aria-hidden": "true" });
    d.style.background = DK.plat(id).c;
    return d;
  };

  /* ------------------------------------------------------------------ */
  /* words, numbers and times                                            */
  /* ------------------------------------------------------------------ */
  function tz() { return typeof ctx.timeZone === "string" ? ctx.timeZone : undefined; }
  function loc() { return typeof ctx.locale === "string" ? ctx.locale : undefined; }
  function fmt(d, opts, locale) {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    if (tz()) o.timeZone = tz();
    try { return new Intl.DateTimeFormat(locale || loc(), o).format(d); } catch (e) {
      try { return new Intl.DateTimeFormat(undefined, opts).format(d); } catch (e2) { return ""; }
    }
  }
  function toDate(v) { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  DK.dayKey = function (v) { var d = toDate(v); return d ? fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA") : ""; };
  DK.dayLabel = function (v) {
    var d = toDate(v);
    if (!d) return "";
    var key = DK.dayKey(d), now = Date.now();
    if (key === DK.dayKey(now)) return "Today";
    if (key === DK.dayKey(now + 864e5)) return "Tomorrow";
    return fmt(d, { weekday: "short", month: "short", day: "numeric" });
  };
  DK.time = function (v) { var d = toDate(v); return d ? fmt(d, { hour: "numeric", minute: "2-digit" }) : ""; };
  DK.when = function (v) { var day = DK.dayLabel(v); return day ? day + " at " + DK.time(v) : ""; };
  /** Milliseconds as m:ss. */
  DK.clock = function (ms) {
    var n = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    var m = Math.floor(n / 60), r = n % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  };
  /** Milliseconds as seconds with one decimal, like 0.4 s. */
  DK.sec = function (ms) { return (Math.round((Number(ms) || 0) / 100) / 10).toFixed(1) + " s"; };
  DK.bytes = function (n) {
    var x = Number(n) || 0;
    if (x >= 1048576) return (x / 1048576).toFixed(x >= 10485760 ? 0 : 1) + " MB";
    if (x >= 1024) return Math.round(x / 1024) + " KB";
    return x + " B";
  };
  DK.num = function (n) { var x = Number(n) || 0; try { return x.toLocaleString("en-US"); } catch (e) { return String(x); } };
  DK.short = function (text, n) { text = String(text || ""); return text.length > n ? text.slice(0, n - 3).replace(/\s+\S*$/, "") + "..." : text; };
  DK.https = function (url) { return typeof url === "string" && /^https:\/\//i.test(url) ? url : null; };
  DK.wordCount = function (s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; };
  DK.base = function (p) { var parts = String(p || "").split(/[\\/]/); return parts[parts.length - 1] || String(p || ""); };
  DK.plural = function (n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hostZone() {
    if (tz()) return tz();
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  }
  DK.zone = hostZone;
  function wallParts(utcMs, zone) {
    var dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var o = {};
    dtf.formatToParts(new Date(utcMs)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function offsetMinutes(utcMs, zone) {
    var p = wallParts(utcMs, zone);
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  }
  /** The host's wall clock now (plus some minutes) as a datetime-local value, like 2026-11-05T09:00. */
  DK.localNow = function (plusMin) {
    var p = wallParts(Date.now() + (plusMin || 0) * 60000, hostZone());
    return p.year + "-" + p.month + "-" + p.day + "T" + pad2(+p.hour % 24) + ":" + p.minute;
  };
  /**
   * A datetime-local value (wall time in the host's time zone) -> { iso, ms } where iso carries the offset,
   * like 2026-11-05T09:00:00-05:00. null when the value is empty or odd.
   */
  DK.zonedIso = function (local) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local || ""));
    if (!m) return null;
    var zone = hostZone();
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
    var off = offsetMinutes(wall, zone);
    off = offsetMinutes(wall - off * 60000, zone);
    var sign = off < 0 ? "-" : "+";
    var abs = Math.abs(off);
    return {
      iso: m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":00" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60),
      ms: wall - off * 60000
    };
  };

  /* ------------------------------------------------------------------ */
  /* small UI pieces                                                     */
  /* ------------------------------------------------------------------ */
  DK.btn = function (label, o) {
    o = o || {};
    var b = h("button", {
      type: "button",
      class: "btn" + (o.kind ? " " + o.kind : "") + (o.small ? " small" : "") + (o.tiny ? " tiny" : "") + (o.wide ? " wide" : ""),
      disabled: !!o.disabled,
      "aria-label": o.aria || null
    });
    if (o.icon) b.appendChild(DK.glyph(o.icon));
    if (label) b.appendChild(document.createTextNode(label));
    if (o.onclick) b.addEventListener("click", o.onclick);
    return b;
  };
  /** A button that opens an https link through the host. */
  DK.linkBtn = function (label, url, o) {
    var safe = DK.https(url);
    if (!safe) return null;
    o = o || {};
    var hint = null;
    var b = DK.btn(label, {
      kind: o.kind || "quiet", small: o.small !== false, icon: o.icon === undefined ? "out" : o.icon, aria: o.aria,
      onclick: function () {
        DK.openLink(safe).catch(function () {
          if (!hint) { hint = h("p", { class: "tiny muted mt-s" }); b.parentNode && b.parentNode.appendChild(hint); }
          hint.textContent = "Open this link in your browser: " + safe.replace(/^https?:\/\//, "");
        });
      }
    });
    return b;
  };
  DK.pill = function (text, kind, icon) {
    return h("span", { class: "pill" + (kind ? " " + kind : "") }, icon ? DK.glyph(icon) : null, text);
  };
  DK.note = function (text, kind, icon) {
    return h("p", { class: "note" + (kind ? " " + kind : ""), role: kind === "bad" ? "alert" : null }, DK.glyph(icon || (kind === "bad" ? "stop" : kind === "ok" ? "check" : "alert")), h("span", { text: text }));
  };
  DK.err = function (text) {
    return h("p", { class: "err", role: "alert" }, DK.glyph("alert"), h("span", { text: text }));
  };
  DK.problem = function (message) {
    return h("div", { class: "card" }, DK.err(message || "Something went wrong. Please try again."));
  };

  /** Busy bar for long jobs (rendering, waiting for a sign-in). */
  DK.busy = function (text) {
    return h("div", { role: "status", "aria-live": "polite" }, h("p", { class: "small strong", text: text }), h("div", { class: "busybar" }, h("i")));
  };

  /** The card header: a small kit label, the title, and a Back button when we moved here from another step. */
  DK.head = function (title, o) {
    o = o || {};
    var top = h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "Dandelion Kit");
    var row = h("div", { class: "hl-row" });
    if (DK.canGoBack()) {
      row.appendChild(DK.btn("Back", { kind: "quiet", tiny: true, icon: "back", aria: "Back to the last step", onclick: function () { DK.back(); } }));
    }
    row.appendChild(h("h1", { class: "hl", text: title }));
    if (o.pill) row.appendChild(o.pill);
    var head = h("header", { class: "head" }, top, row);
    if (o.sub) head.appendChild(h("p", { class: "sub", text: o.sub }));
    return head;
  };

  /** Placeholder while we wait for the first tool result. */
  DK.skeleton = function () {
    return [
      h("header", { class: "head" }, h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "Dandelion Kit")),
      h("div", { class: "card", "aria-busy": "true" },
        h("div", { class: "sk", style: "height:18px;width:55%;border-radius:8px" }),
        h("div", { class: "sk", style: "height:12px;width:90%;border-radius:8px;margin-top:12px" }),
        h("div", { class: "sk", style: "height:12px;width:70%;border-radius:8px;margin-top:8px" }))
    ];
  };

  /** Checks list shared by the preview card: pass, warn or stop with the measured value. */
  DK.checks = function (list) {
    var ul = h("ul", { class: "checklist" });
    (list || []).forEach(function (c) {
      var st = c.status === "stop" ? "stop" : c.status === "warn" ? "warn" : "pass";
      var detail = "";
      if (c.measured !== null && c.measured !== undefined && c.measured !== "") detail = String(c.measured);
      if (c.limit !== null && c.limit !== undefined && c.limit !== "" && String(c.limit) !== String(c.measured)) detail += (detail ? ", limit " : "Limit ") + String(c.limit);
      var word = st === "pass" ? "Pass" : st === "warn" ? "Warning" : "Stop";
      ul.appendChild(h("li", { class: st },
        DK.glyph(st === "pass" ? "check" : st === "warn" ? "alert" : "stop"),
        h("div", { class: "grow" },
          h("div", null, h("span", { class: "strong", text: c.label || c.id || "Check" }), h("span", { class: "tiny muted", text: " (" + word + ")" })),
          detail ? h("div", { class: "small muted num", text: detail }) : null,
          st !== "pass" && c.fix ? h("div", { class: "fix", text: "To fix: " + c.fix }) : null)));
    });
    return ul;
  };
  /** Counts like "6 pass, 1 warning". */
  DK.checkTally = function (list) {
    var t = { pass: 0, warn: 0, stop: 0 };
    (list || []).forEach(function (c) { t[c.status === "stop" ? "stop" : c.status === "warn" ? "warn" : "pass"] += 1; });
    return t;
  };

  /** A meter line under a field: count / max with a bar. ideal is optional. */
  DK.meter = function (len, max) {
    var line = h("div", { class: "meter-line" });
    var bar = h("div", { class: "meter", "aria-hidden": "true" }, h("i"));
    var count = h("span", { class: "count" });
    line.appendChild(bar);
    line.appendChild(count);
    line.update = function (n) {
      var pct = max > 0 ? Math.min(100, Math.round((n / max) * 100)) : 0;
      bar.firstChild.style.width = pct + "%";
      bar.className = "meter" + (max > 0 && n > max ? " over" : max > 0 && n > max * 0.9 ? " near" : "");
      line.className = "meter-line" + (max > 0 && n > max ? " over" : "");
      count.textContent = max > 0 ? DK.num(n) + " / " + DK.num(max) + (line.note ? " " + line.note : "") + (n > max ? " (too long)" : "") : DK.num(n);
    };
    line.update(len);
    return line;
  };

  /**
   * A labelled text field with an optional length meter.
   * o: { label, value, max, area, rows, placeholder, onInput(value), hint, hideLabel }
   * Returns { el, input, value(), set(v), over() }.
   */
  DK.textField = function (o) {
    var id = DK.uid("f");
    var input = o.area
      ? h("textarea", { class: "field", id: id, rows: o.rows || 3, placeholder: o.placeholder || null })
      : h("input", { class: "field", id: id, type: "text", placeholder: o.placeholder || null, autocomplete: "off" });
    input.value = o.value === undefined || o.value === null ? "" : String(o.value);
    var wrap = h("div", { class: "fwrap" });
    if (o.label) wrap.appendChild(h("label", { class: o.hideLabel ? "label sr" : "label", for: id, text: o.label }));
    wrap.appendChild(input);
    var meter = null;
    /* o.count(value) gives the length the app counts (hashtags, links); o.note() is a short tag shown beside it. */
    function lenOf(v) { return o.count ? o.count(v) : v.length; }
    if (o.max) { meter = DK.meter(lenOf(input.value), o.max); wrap.appendChild(meter); }
    if (o.hint) wrap.appendChild(h("p", { class: "tiny muted mt-s", text: o.hint }));
    function check() {
      var over = !!(o.max && lenOf(input.value) > o.max);
      if (over) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      if (meter) { meter.note = o.note ? o.note() : ""; meter.update(lenOf(input.value)); }
    }
    input.addEventListener("input", function () { check(); if (o.onInput) o.onInput(input.value); });
    check();
    return {
      el: wrap, input: input,
      value: function () { return input.value; },
      set: function (v) { input.value = v; check(); },
      refresh: check,
      over: function () { return !!(o.max && lenOf(input.value) > o.max); }
    };
  };

  /** A segmented control: o.options [{id, label}], o.value, o.onPick(id). */
  DK.seg = function (o) {
    var box = h("div", { class: "seg", role: "group", "aria-label": o.label || null });
    var cur = o.value;
    function paint() {
      Array.prototype.forEach.call(box.children, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-id") === cur ? "true" : "false"); });
    }
    o.options.forEach(function (opt) {
      var b = h("button", { type: "button", "data-id": opt.id, text: opt.label, disabled: !!o.disabled });
      b.addEventListener("click", function () { if (cur === opt.id) return; cur = opt.id; paint(); if (o.onPick) o.onPick(opt.id); });
      box.appendChild(b);
    });
    paint();
    return box;
  };

  /** An on/off switch with a visible word. o: { checked, onText, offText, onChange(checked), label }. */
  DK.toggle = function (o) {
    var input = h("input", { type: "checkbox", role: "switch", "aria-label": o.label || null, disabled: !!o.disabled });
    input.checked = !!o.checked;
    var word = h("span", { class: "sw-text", text: input.checked ? o.onText : o.offText });
    input.addEventListener("change", function () {
      word.textContent = input.checked ? o.onText : o.offText;
      if (o.onChange) o.onChange(input.checked);
    });
    return h("label", { class: "sw" }, input, h("span", { class: "sw-box" }), word);
  };

  /**
   * Two taps for anything that goes out or cannot be taken back. First tap shows the question, second tap does it.
   * o: { label, icon, kind, small, disabled, question, detail, yes, onConfirm() -> Promise }
   * The first button never does the thing itself. Cancel gets the focus so a stray Enter is safe.
   */
  DK.twoTap = function (o) {
    var wrap = h("div", { class: "tt" });
    var st = { open: false, busy: false, error: "" };
    function render() {
      wrap.textContent = "";
      wrap.className = "tt" + (st.open ? " open" : "");
      if (!st.open) {
        wrap.appendChild(DK.btn(o.label, { kind: o.kind, icon: o.icon, small: o.small, disabled: o.disabled, onclick: function () { st.open = true; st.error = ""; render(); } }));
        return;
      }
      var no = DK.btn("Cancel", { disabled: st.busy, onclick: function () { st.open = false; st.error = ""; render(); } });
      var yes = DK.btn(st.busy ? "Working..." : o.yes || "Yes", {
        kind: "gold", icon: o.icon, disabled: st.busy,
        onclick: function () {
          st.busy = true; st.error = ""; render();
          Promise.resolve().then(o.onConfirm).then(function () {
            st.busy = false; st.open = false;
            if (document.body.contains(wrap)) render();
          }, function (e) {
            st.busy = false; st.error = (e && e.message) || "Something went wrong. Please try again."; render();
          });
        }
      });
      wrap.appendChild(h("div", { class: "confirm", role: "group", "aria-label": o.question },
        h("p", { class: "q", text: o.question }),
        o.detail ? h("p", { class: "small muted mt-s", text: o.detail }) : null,
        st.error ? DK.err(st.error) : null,
        h("div", { class: "actions" }, yes, no)));
      setTimeout(function () { if (!st.busy && document.body.contains(no)) no.focus(); }, 0);
    }
    render();
    return wrap;
  };

  /* ------------------------------------------------------------------ */
  /* media from read_asset                                               */
  /* ------------------------------------------------------------------ */
  // 199998 is a multiple of 3 and under the 200000 limit, so every full chunk is whole base64 groups.
  var CHUNK = 199998;
  var assets = {};
  var active = 0;
  var waiting = [];
  function slot(fn) {
    if (active < 3) { active += 1; fn(); } else waiting.push(fn);
  }
  function release() {
    active -= 1;
    var next = waiting.shift();
    if (next) { active += 1; next(); }
  }
  function b64bytes(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function loadAsset(id, entry, queued) {
    var parts = [], offset = 0, mime = "application/octet-stream", total = 0;
    function finish(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve({ url: String(reader.result), mime: mime, bytes: total }); };
      reader.onerror = function () { reject(new Error("Could not read the file.")); };
      reader.readAsDataURL(new Blob(parts, { type: mime }));
    }
    return new Promise(function (resolve, reject) {
      function done(fn, arg) { if (queued) release(); fn(arg); }
      function step() {
        DK.call("read_asset", { asset_id: id, offset: offset, bytes: CHUNK }).then(function (d) {
          if (!d || typeof d.data !== "string") { done(reject, new Error("No data came back.")); return; }
          if (d.mime) mime = d.mime;
          total = Number(d.total) || total;
          var u8 = b64bytes(d.data);
          parts.push(u8);
          offset += u8.length;
          entry.loaded = offset; entry.total = total;
          entry.listeners.forEach(function (fn) { try { fn(offset, total); } catch (e) { /* ignore */ } });
          if (d.has_more && u8.length > 0) step();
          else finish(function (v) { done(resolve, v); }, function (e) { done(reject, e); });
        }, function (e) { done(reject, e); });
      }
      if (queued) slot(step); else step();
    });
  }
  /**
   * Load a registered file as a data: URL, chunk by chunk through read_asset. Cached per page.
   * o: { onProgress(loaded, total), queue: true to share three connections with other pictures }
   * Resolves { url, mime, bytes }.
   */
  DK.asset = function (id, o) {
    o = o || {};
    var entry = assets[id];
    if (!entry) {
      entry = { loaded: 0, total: 0, listeners: [], promise: null };
      assets[id] = entry;
      entry.promise = loadAsset(id, entry, !!o.queue);
      entry.promise.catch(function () { if (assets[id] === entry) delete assets[id]; });
    }
    if (o.onProgress) {
      entry.listeners.push(o.onProgress);
      if (entry.total) o.onProgress(entry.loaded, entry.total);
    }
    return entry.promise;
  };
  /** Forget cached files (call after a re-render that changed them). */
  DK.forget = function (ids) {
    (ids || []).forEach(function (id) { delete assets[id]; });
  };
  /** A picture box that fills in when its file has loaded. o: { ratio: "4 / 5", alt, cls, width } */
  DK.img = function (id, o) {
    o = o || {};
    var box = h("div", { class: "imgbox" + (id ? " sk" : "") + (o.cls ? " " + o.cls : ""), role: "img", "aria-label": o.alt || "Picture" });
    if (o.ratio) box.style.aspectRatio = o.ratio;
    if (o.width) box.style.width = o.width;
    if (!id) { box.appendChild(DK.glyph("photo")); return box; }
    DK.asset(id, { queue: true }).then(function (a) {
      box.classList.remove("sk");
      box.appendChild(h("img", { alt: "", src: a.url, decoding: "async" }));
    }, function () {
      box.classList.remove("sk");
      box.appendChild(DK.glyph("photo"));
    });
    return box;
  };
  /** A video player that fills in when the file has loaded. o: { ratio: "9 / 16", width: "260px" } */
  DK.video = function (id, o) {
    o = o || {};
    var box = h("div", { class: "vidbox" });
    box.style.aspectRatio = o.ratio || "9 / 16";
    box.style.width = "min(100%, " + (o.width || "260px") + ")";
    if (!id) { box.appendChild(h("div", { class: "vidwait" }, h("p", { text: "No preview yet." }))); return box; }
    var label = h("p", { text: "Loading the preview..." });
    var bar = h("i");
    bar.style.width = "0%";
    var wait = h("div", { class: "vidwait", role: "status" }, label, h("div", { class: "bar" }, bar));
    box.appendChild(wait);
    DK.asset(id, {
      onProgress: function (loaded, total) {
        var pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        bar.style.width = pct + "%";
        label.textContent = "Loading the preview... " + pct + "%";
      }
    }).then(function (a) {
      var v = h("video", { controls: true, playsinline: true, preload: "metadata", "aria-label": o.alt || "Reel preview" });
      v.src = a.url;
      if (o.posterId) DK.asset(o.posterId, { queue: true }).then(function (p) { v.poster = p.url; }, function () {});
      wait.remove();
      box.appendChild(v);
    }, function (e) {
      wait.textContent = "";
      wait.appendChild(h("p", { text: (e && e.message) || "The preview could not load." }));
    });
    return box;
  };

  /* ------------------------------------------------------------------ */
  /* views: one card page carries all of them                            */
  /* ------------------------------------------------------------------ */
  var views = {};
  var toolView = {};
  var cur = null;
  var stack = [];
  var lastData = {};
  var primary = null;

  /** Register a view. def: { tools: [tool names whose result it shows], build(data) -> node or array of nodes } */
  DK.view = function (id, def) {
    views[id] = def;
    (def.tools || []).forEach(function (t) { if (!toolView[t]) toolView[t] = id; });
  };
  DK.canGoBack = function () { return stack.length > 0; };
  function mountNodes(nodes) {
    var app = document.getElementById("app");
    app.textContent = "";
    add(app, nodes);
  }
  /** Show a view with data. opts.replace: keep the same history slot. */
  DK.show = function (id, data, opts) {
    opts = opts || {};
    var v = views[id];
    if (!v) { mountNodes(DK.problem("This card cannot show that step.")); return; }
    if (opts.reset) stack = [];
    else if (cur && cur !== id && !opts.replace) stack.push({ id: cur, data: lastData[cur] });
    cur = id;
    lastData[id] = data;
    var nodes;
    try { nodes = v.build(data || {}); } catch (e) {
      if (window.console) console.error(e);
      nodes = [DK.head("Something went wrong"), DK.problem("This card could not draw itself. The details are in the chat.")];
    }
    mountNodes(nodes);
    try { window.scrollTo(0, 0); } catch (e2) { /* ignore */ }
  };
  /** A tool we called returned data: show the view that tool belongs to (same view = replace). */
  DK.go = function (tool, data) {
    var id = toolView[tool];
    if (!id) return;
    DK.show(id, data, { replace: id === cur });
  };
  DK.back = function () {
    var prev = stack.pop();
    if (!prev) return;
    cur = prev.id;
    var v = views[prev.id];
    mountNodes(v.build(prev.data || {}));
  };
  /** The data the current view was last given (merge helper for small updates). */
  DK.data = function (id) { return lastData[id || cur] || {}; };

  /** Start the card: primary is the view the host's first tool result belongs to. */
  DK.boot = function (primaryId, appName) {
    primary = primaryId;
    mountNodes(DK.skeleton());
    DK.on("result", function (r) {
      var res = DK.read(r);
      if (!res.ok) { mountNodes([DK.head("Dandelion Kit"), DK.problem(res.message)]); return; }
      DK.show(primary, res.data, { reset: true });
    });
    DK.on("cancelled", function () {
      mountNodes([DK.head("Dandelion Kit"), DK.problem("This was stopped before it finished.")]);
    });
    startBridge(appName || "Dandelion Kit");
  };
})();
