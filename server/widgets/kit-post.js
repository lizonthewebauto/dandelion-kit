// Card script for "kit-post": the offer to post anything through Dandelion, in three states.
//   1. Not connected: a version for each app, editable, with limit meters. Works before any sign-up.
//   2. Connected: pick a brand and apps, connect missing apps by link, send to the library or for review.
//   3. After a send: one card per app with Approve now (two taps), Schedule (two taps) and Skip.
// Shown by offer_post, set_channel_copy, connect_dandelion, dandelion_status and send_to_dandelion.
// Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var ORDER = ["instagram", "tiktok", "youtube", "linkedin", "x", "threads", "facebook", "pinterest"];
  var KIND = { text: "Text post", image: "Image post", carousel: "Carousel", video: "Video", thread: "Thread" };
  var STATUS = {
    review: ["Needs your OK", "gold", "alert"], scheduled: ["Scheduled", "gold", "clock"], posting: ["Posting now", "gold", "clock"],
    posted: ["Posted", "ok", "check"], skipped: ["Skipped", "off", null], failed: ["Failed", "bad", "stop"]
  };

  function nice(id) { var t = String(id || ""); return t.charAt(0).toUpperCase() + t.slice(1); }
  function clone(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }
  function mainText(copy) { copy = copy || {}; return copy.caption || copy.description || copy.title || ""; }

  function build(d0) {
    var bundle = d0.bundle || (d0.channels ? d0 : { id: "", kind: "text", files: [], channels: {} });
    if (!bundle.channels) bundle.channels = {};
    var dl = d0.dandelion || (typeof d0.connected === "boolean" ? d0 : { connected: false });
    if (d0.sent && !bundle.sent) bundle.sent = d0.sent;
    var st = {
      tab: "", edits: {}, brand: "", mode: "", include: {}, busy: "", error: "", notice: d0.notice || "",
      connectUrl: d0.connect_url || "", polling: false, pollEnd: 0, jobMsg: {}
    };
    var plats = ORDER.filter(function (p) { return bundle.channels[p]; });
    Object.keys(bundle.channels).forEach(function (p) { if (plats.indexOf(p) < 0) plats.push(p); });
    st.tab = plats[0] || "";

    var previewHost = h("div"), tabsHost = h("div"), panelHost = h("div"), actionHost = h("div"), jobsHost = h("div"), noticeHost = h("div");
    var saveHost = h("div");
    var fieldRegistry = [];

    /* ---------------- helpers ---------------- */
    function copyOf(p) { return st.edits[p] || (bundle.channels[p] && bundle.channels[p].copy) || {}; }
    /* The length an app counts: hashtags live in the post text on these apps, and X counts every link as 23. */
    var INLINE_TAGS = { x: 1, threads: 1, tiktok: 1, instagram: 1 };
    function counted(p, text, tags) {
      var t = String(text || "");
      if (p === "x") t = t.replace(/https?:\/\/\S+/g,new Array(24).join("x"));
      var n = Array.from(t).length;
      var tg = (tags || []).map(function (x) { var s = String(x).trim(); return s && s.charAt(0) !== "#" ? "#" + s : s; }).filter(Boolean).join(" ");
      var inline = !!(INLINE_TAGS[p] && tg);
      if (inline) n += 1 + Array.from(tg).length;
      return { n: n, inline: inline };
    }
    function limitsOf(p) { return (bundle.channels[p] && bundle.channels[p].limits) || {}; }
    function isDirty(p) { return !!st.edits[p]; }
    function absorb(r) {
      if (!r || typeof r !== "object") return;
      if (r.bundle && typeof r.bundle === "object") {
        bundle = r.bundle;
        if (!bundle.channels) bundle.channels = {};
      }
      if (r.sent && typeof r.sent === "object") bundle.sent = r.sent;
      if (r.dandelion && typeof r.dandelion === "object") dl = r.dandelion;
      else if (typeof r.connected === "boolean") dl = r;
      if (typeof r.connect_url === "string") st.connectUrl = r.connect_url;
    }
    function brands() { return Array.isArray(dl.brands) ? dl.brands : []; }
    function curBrand() {
      if (st.brand) return st.brand;
      var sentBrand = bundle.sent && bundle.sent.brand_id;
      if (sentBrand) return sentBrand;
      return brands()[0] ? brands()[0].id : "";
    }
    function chanFor(p) {
      var list = Array.isArray(dl.channels) ? dl.channels : [];
      var b = curBrand();
      for (var i = 0; i < list.length; i++) if (list[i].platform === p && (!b || !list[i].brand_id || list[i].brand_id === b)) return list[i];
      return null;
    }
    function connectUrlFor(p) {
      var list = Array.isArray(dl.connect_links) ? dl.connect_links : [];
      for (var i = 0; i < list.length; i++) if (list[i].platform === p) return list[i].url;
      return null;
    }
    function postable() { return plats.filter(function (p) { var c = chanFor(p); return c && c.can_post; }); }

    /* ---------------- what is being posted ---------------- */
    function paintPreview() {
      previewHost.textContent = "";
      var ids = Array.isArray(bundle.preview_asset_ids) ? bundle.preview_asset_ids.slice(0, 10) : [];
      var files = Array.isArray(bundle.files) ? bundle.files : [];
      var box = h("section", { class: "card" });
      box.appendChild(h("div", { class: "row wrap" },
        DK.pill(KIND[bundle.kind] || "Post", "gold", bundle.kind === "video" ? "film" : bundle.kind === "text" || bundle.kind === "thread" ? "doc" : "photo"),
        files.length ? h("span", { class: "small muted", text: DK.plural(files.length, "file") }) : null,
        bundle.rules_source === "snapshot" ? h("span", { class: "tiny muted", text: "Limits from the saved copy of Dandelion's rules" }) : null));
      if (ids.length) {
        var strip = h("div", { class: "thumbs mt" });
        ids.forEach(function (id, i) { strip.appendChild(DK.img(id, { alt: "Preview " + (i + 1) })); });
        box.appendChild(strip);
      }
      if (bundle.text) box.appendChild(h("p", { class: "excerpt mt-s", text: bundle.text }));
      if (!bundle.sent) box.appendChild(h("p", { class: "small muted mt-s", text: "Nothing has been posted. Check the words for each app, then decide." }));
      previewHost.appendChild(box);
    }

    /* ---------------- tabs and one app's words ---------------- */
    function hasWarning(p) { var c = bundle.channels[p]; return !!(c && c.warnings && c.warnings.length); }
    function paintTabs() {
      tabsHost.textContent = "";
      var tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Apps" });
      plats.forEach(function (p) {
        var c = chanFor(p);
        var b = h("button", { type: "button", class: "tab", role: "tab", "aria-selected": p === st.tab ? "true" : "false" },
          DK.platDot(p), DK.plat(p).n,
          isDirty(p) ? h("span", { class: "dotmark", role: "img", "aria-label": "Unsaved changes" }) : null,
          hasWarning(p) ? h("span", { class: "warnmark", role: "img", "aria-label": "Needs a look" }) : null,
          dl.connected && c && c.can_post ? h("span", { class: "tick", role: "img", "aria-label": "Connected" }, DK.glyph("check", "sm")) : null);
        b.addEventListener("click", function () { st.tab = p; paintTabs(); paintPanel(); });
        tabs.appendChild(b);
      });
      tabsHost.appendChild(tabs);
    }

    function tagsToText(arr, prefix) {
      return (arr || []).map(function (t) { var s = String(t); return prefix ? (s.charAt(0) === "#" ? s : "#" + s) : s.replace(/^#/, ""); }).join(" ");
    }
    function textToTags(text, keepHash) {
      return String(text || "").split(/[\s,]+/).map(function (t) { return t.trim(); }).filter(Boolean).map(function (t) { var bare = t.replace(/^#+/, ""); return keepHash ? "#" + bare : bare; }).filter(function (t) { return t.replace(/^#/, ""); });
    }

    function paintPanel() {
      panelHost.textContent = "";
      fieldRegistry = [];
      var p = st.tab;
      if (!p) return;
      var ch = bundle.channels[p] || {};
      var lim = limitsOf(p);
      var copy = copyOf(p);
      var box = h("div");
      var name = DK.plat(p).n;
      box.appendChild(h("div", { class: "row between wrap" },
        h("div", { class: "row" }, DK.platDot(p), h("span", { class: "strong", text: name }), ch.format ? h("span", { class: "small muted", text: ch.format }) : null)));
      (ch.warnings || []).forEach(function (w) { box.appendChild(h("div", { class: "mt-s" }, DK.note(w, "warn"))); });
      var local = st.edits[p] || null;
      function ensure() { if (!local) { local = clone(copyOf(p)); st.edits[p] = local; paintTabs(); } return local; }

      var wantTitle = lim.title_max || copy.title;
      var wantDesc = lim.description_max || copy.description;
      var wantCaption = lim.caption_max || copy.caption || (!wantTitle && !wantDesc);
      var fields = h("div", { class: "stack-s mt" });
      var captionField = null;
      function tagsNow() { return (st.edits[p] || copyOf(p)).hashtags || []; }
      function textField(key, label, max, area) {
        var isCaption = key === "caption";
        var f = DK.textField({
          label: label, value: copy[key] || "", max: max || 0, area: area, rows: area ? 5 : 2,
          count: isCaption ? function (v) { return counted(p, v, tagsNow()).n; } : null,
          note: isCaption ? function () { return counted(p, (st.edits[p] || copyOf(p)).caption, tagsNow()).inline ? "with hashtags" : ""; } : null,
          onInput: function (v) { ensure()[key] = v; paintSave(); }
        });
        if (isCaption) captionField = f;
        fieldRegistry.push(f);
        fields.appendChild(f.el);
      }
      if (wantTitle) textField("title", "Title", lim.title_max, false);
      if (wantCaption) textField("caption", "Caption", lim.caption_max, true);
      if (wantDesc) textField("description", "Description", lim.description_max, true);
      var hadHash = (copy.hashtags || []).some(function (t) { return String(t).charAt(0) === "#"; });
      if (lim.hashtags_max || (copy.hashtags && copy.hashtags.length)) {
        var tagText = tagsToText(copy.hashtags, true);
        var tf = DK.textField({
          label: "Hashtags", value: tagText, area: false, placeholder: "#one #two",
          hint: lim.hashtags_ideal ? "Around " + lim.hashtags_ideal + " works best" + (lim.hashtags_max ? ", " + lim.hashtags_max + " at most." : ".") : lim.hashtags_max ? lim.hashtags_max + " at most." : "",
          onInput: function (v) { ensure().hashtags = textToTags(v, hadHash); tagCount(); if (captionField) captionField.refresh(); paintSave(); }
        });
        var tagLine = h("p", { class: "tiny num muted mt-s" });
        var tagCount = function () {
          var n = textToTags(tf.value(), false).length;
          var over = lim.hashtags_max && n > lim.hashtags_max;
          tagLine.textContent = n + (lim.hashtags_max ? " / " + lim.hashtags_max : "") + (n === 1 ? " hashtag" : " hashtags") + (over ? " (too many)" : "");
          tagLine.style.color = over ? "var(--dk-danger)" : "";
          tagLine.style.fontWeight = over ? "700" : "";
          tagOver = !!over;
        };
        var tagOver = false;
        tagCount();
        fieldRegistry.push({ over: function () { return tagOver; } });
        fields.appendChild(tf.el);
        fields.appendChild(tagLine);
      }
      box.appendChild(fields);
      box.appendChild(saveHost);
      panelHost.appendChild(box);
      paintSave();
    }

    function paintSave() {
      saveHost.textContent = "";
      var p = st.tab;
      if (!p) return;
      var dirty = isDirty(p);
      var over = fieldRegistry.some(function (f) { return f.over(); });
      var row = h("div", { class: "actions" });
      if (dirty) {
        row.appendChild(DK.btn("Save this version", { kind: "gold", small: true, icon: "check", disabled: !!st.busy || over, onclick: function () { saveCopy(p); } }));
        row.appendChild(DK.btn("Undo", { small: true, kind: "quiet", icon: "undo", disabled: !!st.busy, onclick: function () { delete st.edits[p]; paintTabs(); paintPanel(); } }));
        if (over) row.appendChild(h("span", { class: "small", style: "color:var(--dk-danger);font-weight:600", text: "Over the limit. Shorten it to save." }));
      } else if (st.savedTab === p) {
        row.appendChild(h("span", { class: "ok-line", style: "margin-top:0", role: "status" }, DK.glyph("check"), "Saved."));
      }
      if (row.childNodes.length) saveHost.appendChild(row);
    }

    function saveCopy(p) {
      var copy = clone(st.edits[p]);
      st.busy = "Saving..."; st.error = ""; paintSave(); paintAction();
      DK.call("set_channel_copy", { bundle_id: bundle.id, channel: p, copy: copy }).then(function (r) {
        st.busy = "";
        if (r && r.bundle) absorb(r);
        else {
          if (!bundle.channels[p]) bundle.channels[p] = { copy: {}, limits: {}, warnings: [] };
          bundle.channels[p].copy = copy;
          if (r && Array.isArray(r.warnings)) bundle.channels[p].warnings = r.warnings;
        }
        delete st.edits[p];
        st.savedTab = p;
        DK.tellModel("In the Dandelion Kit card the person edited the " + DK.plat(p).n + " version and saved it. New words: " + DK.short(mainText(copy), 400));
        paintTabs(); paintPanel(); paintAction();
      }, function (e) { st.busy = ""; st.error = e.message; paintSave(); paintAction(); });
    }

    /* ---------------- the action area ---------------- */
    function startPolling() {
      if (st.polling) return;
      st.polling = true;
      st.pollEnd = Date.now() + 180000;
      function tick() {
        if (!st.polling) return;
        if (Date.now() > st.pollEnd) { st.polling = false; st.busy = ""; st.error = "Sign-in did not finish in time. Tap Connect Dandelion to try again."; paintAction(); return; }
        DK.call("dandelion_status", {}).then(function (r) {
          absorb(r);
          if (dl.connected) {
            st.polling = false; st.busy = "";
            DK.tellModel("In the Dandelion Kit card the person finished signing in to Dandelion" + (dl.workspace && dl.workspace.name ? " (" + dl.workspace.name + ")" : "") + ". Nothing has been sent yet.");
            paintTabs(); paintAction();
          } else setTimeout(tick, 3000);
        }, function () { setTimeout(tick, 3000); });
      }
      setTimeout(tick, 3000);
    }
    function connect() {
      st.busy = "Waiting for you in the browser. This stops after 3 minutes."; st.error = ""; paintAction();
      DK.call("connect_dandelion", {}).then(function (r) {
        absorb(r);
        if (dl.connected) {
          st.busy = "";
          DK.tellModel("In the Dandelion Kit card the person signed in to Dandelion" + (dl.workspace && dl.workspace.name ? " (" + dl.workspace.name + ")" : "") + ". Nothing has been sent yet.");
          paintTabs(); paintAction();
        } else startPolling();
      }, function (e) { st.busy = ""; st.error = e.message; paintAction(); });
    }

    function repaint() { if (bundle.sent) paintJobs(); else paintAction(); }

    function send(mode) {
      var chans = mode === "review" ? postable().filter(function (p) { return st.include[p] !== false; }) : [];
      st.busy = "Sending your files to Dandelion. Big videos can take a minute..."; st.error = ""; repaint();
      var args = { bundle_id: bundle.id, brand_id: curBrand(), mode: mode };
      if (chans.length) args.channels = chans;
      DK.call("send_to_dandelion", args).then(function (r) {
        st.busy = "";
        absorb(r);
        if (!bundle.sent) bundle.sent = { brand_id: curBrand(), content_id: "", mode: mode, jobs: [], sent_at: Date.now() };
        var jobs = (bundle.sent.jobs || []).length;
        DK.tellModel("In the Dandelion Kit card the person tapped Send to Dandelion (" + (mode === "review" ? "send for review" : "save to library") + "). " + (jobs ? jobs + " posts are waiting for their OK in the card. Nothing has gone out." : "The files are in their Dandelion library. Nothing has gone out."));
        paintAll();
      }, function (e) { st.busy = ""; st.error = e.message; repaint(); });
    }

    function channelRows() {
      var ul = h("ul", { class: "rows" });
      plats.forEach(function (p) {
        var c = chanFor(p);
        var main = h("div", { class: "main" }, h("div", { class: "row" }, DK.platDot(p), h("span", { class: "strong", text: DK.plat(p).n })));
        var side = null;
        if (c && c.can_post) {
          main.appendChild(h("div", { class: "small muted", text: "@" + String(c.handle || "").replace(/^@/, "") }));
          var cb = h("input", { type: "checkbox", "aria-label": "Include " + DK.plat(p).n });
          cb.checked = st.include[p] !== false;
          cb.addEventListener("change", function () { st.include[p] = cb.checked; paintAction(); });
          side = h("label", { class: "cb" }, cb, "Include");
        } else if (c) {
          main.appendChild(h("div", { class: "small muted", text: "Needs to be connected again" }));
          side = DK.linkBtn("Reconnect", connectUrlFor(p) || DK.appUrl("/app/settings"), { small: true });
        } else {
          main.appendChild(h("div", { class: "small muted", text: "Not connected yet" }));
          side = DK.linkBtn("Connect " + DK.plat(p).n, connectUrlFor(p) || DK.appUrl("/app/settings"), { kind: "", small: true, aria: "Connect " + DK.plat(p).n + " in Dandelion" });
        }
        ul.appendChild(h("li", null, main, side));
      });
      return ul;
    }

    function paintAction() {
      actionHost.textContent = "";
      if (bundle.sent) return; // the jobs area takes over
      var box = h("section", { class: "card" });
      if (!dl.connected) {
        box.appendChild(h("h2", { class: "hl", style: "font-size:18px", text: "Post these for free with Dandelion" }));
        box.appendChild(h("p", { class: "small muted mt-s", text: "Dandelion posts to your apps and keeps your files. Sign-in opens in your browser. The free plan is enough." }));
        if (st.busy) {
          box.appendChild(h("div", { class: "mt" }, DK.busy(st.busy)));
          if (st.connectUrl) {
            var again = DK.linkBtn("Open the sign-in page again", st.connectUrl, { small: true });
            if (again) box.appendChild(h("div", { class: "mt-s" }, again));
          }
        }
        if (st.error) box.appendChild(DK.err(st.error));
        var actions = h("div", { class: "actions" });
        actions.appendChild(DK.btn("Connect Dandelion (free)", { kind: "gold", icon: "link", disabled: !!st.busy, onclick: connect }));
        var what = DK.linkBtn("What is Dandelion?", DK.appUrl("/go/kit"), { small: true });
        if (what) actions.appendChild(what);
        box.appendChild(actions);
        actionHost.appendChild(box);
        return;
      }
      var who = (dl.workspace && dl.workspace.name) || "Dandelion";
      box.appendChild(h("div", { class: "row wrap" }, DK.pill("Signed in", "ok", "check"), h("span", { class: "small muted", text: who + (dl.plan ? ", " + dl.plan + " plan" : "") })));
      var bs = brands();
      if (bs.length > 1) {
        var sel = h("select", { class: "field", id: DK.uid("b"), disabled: !!st.busy });
        bs.forEach(function (b) { var o = h("option", { value: b.id, text: b.name }); if (b.id === curBrand()) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", function () { st.brand = sel.value; paintTabs(); paintAction(); });
        box.appendChild(h("label", { class: "label mt", for: sel.id, text: "Which brand" }));
        box.appendChild(sel);
      } else if (bs.length === 1) {
        box.appendChild(h("p", { class: "small mt-s", text: "Brand: " + bs[0].name }));
      }
      box.appendChild(h("p", { class: "sec-title", text: "Your apps" }));
      box.appendChild(channelRows());
      var ready = postable().filter(function (p) { return st.include[p] !== false; });
      var mode = st.mode || (postable().length ? "review" : "library");
      box.appendChild(h("p", { class: "sec-title", text: "What to do" }));
      box.appendChild(DK.seg({
        label: "What to do", value: mode, options: [{ id: "library", label: "Save to library" }, { id: "review", label: "Send for review" }],
        disabled: !!st.busy, onPick: function (id) { st.mode = id; paintAction(); }
      }));
      box.appendChild(h("p", { class: "small muted mt-s", text: mode === "review"
        ? (ready.length ? "Dandelion makes a post for " + ready.length + (ready.length === 1 ? " app" : " apps") + " and waits for your OK. Nothing goes out yet." : "Connect an app above to make posts. Until then this saves to your library.")
        : "Saves the files to your Dandelion library as Not shared yet. Nothing goes out." }));
      if (dl.usage && dl.usage.limit) box.appendChild(h("p", { class: "tiny muted mt-s num", text: "AI actions this month: " + DK.num(dl.usage.used) + " of " + DK.num(dl.usage.limit) }));
      if (st.busy) box.appendChild(h("div", { class: "mt" }, DK.busy(st.busy)));
      if (st.error) box.appendChild(DK.err(st.error));
      var go = mode === "review" && ready.length ? "review" : "library";
      var actions2 = h("div", { class: "actions" });
      actions2.appendChild(DK.btn(go === "review" ? "Send for review" : "Save to library", { kind: "gold", icon: "send", disabled: !!st.busy || !curBrand(), onclick: function () { send(go); } }));
      box.appendChild(actions2);
      actionHost.appendChild(box);
    }

    /* ---------------- after a send: one card per post ---------------- */
    function jobCard(job) {
      var card = h("article", { class: "jobcard" });
      var local = { open: false, when: "", msg: "", err: "" };
      var name = DK.plat(job.platform).n;
      var label = name + " post" + (job.handle ? " to @" + String(job.handle).replace(/^@/, "") : "");
      var host = h("div");
      function setStatus(r, fallback) {
        var s = r && r.job && r.job.status ? r.job.status : fallback;
        job.status = s;
        if (r && r.job && r.job.post_at) job.post_at = r.job.post_at;
      }
      function approveNow() {
        return DK.call("approve_post", { job_id: job.id }).then(function (r) {
          setStatus(r, "posting");
          local.msg = "On its way. It goes out in a minute or two.";
          DK.tellModel("In the Dandelion Kit card the person tapped Approve now on the " + label + " (job " + job.id + "). It is approved and goes out now. Do not approve it again.");
          paint();
        });
      }
      function schedule(iso, ms) {
        return DK.call("approve_post", { job_id: job.id, post_at: iso }).then(function (r) {
          setStatus(r, "scheduled");
          job.post_at = (r && r.job && r.job.post_at) || iso;
          local.msg = "Scheduled for " + DK.when(ms) + ".";
          local.open = false;
          DK.tellModel("In the Dandelion Kit card the person scheduled the " + label + " (job " + job.id + ") for " + iso + ". It is approved. Do not approve it again.");
          paint();
        });
      }
      function skip() {
        local.err = "";
        DK.call("skip_post", { job_id: job.id }).then(function (r) {
          setStatus(r, "skipped");
          local.msg = "Skipped. It will not post.";
          DK.tellModel("In the Dandelion Kit card the person skipped the " + label + " (job " + job.id + "). It will not post.");
          paint();
        }, function (e) { local.err = e.message; paint(); });
      }
      function schedBox() {
        var wrap = h("div", { class: "mt" });
        var input = h("input", { type: "datetime-local", class: "field", id: DK.uid("dt"), min: DK.localNow(5), step: "300" });
        input.value = local.when;
        var twoHost = h("div", { class: "mt-s" });
        function paintTwo() {
          twoHost.textContent = "";
          var z = DK.zonedIso(input.value);
          if (!z) { twoHost.appendChild(h("p", { class: "small muted", text: "Pick a date and time to continue." })); return; }
          if (z.ms < Date.now() + 60000) { twoHost.appendChild(DK.err("Pick a time in the future.")); return; }
          twoHost.appendChild(DK.twoTap({
            label: "Schedule it", icon: "clock", kind: "gold", small: true,
            question: "Schedule this post?",
            detail: DK.when(z.ms) + " (" + DK.zone() + "). It goes out on " + name + " then." + (job.checks && job.checks.length ? " Dandelion found things to fix above." : ""),
            yes: "Yes, schedule it",
            onConfirm: function () { return schedule(z.iso, z.ms); }
          }));
        }
        input.addEventListener("input", function () { local.when = input.value; paintTwo(); });
        wrap.appendChild(h("label", { class: "label", for: input.id, text: "Date and time (" + DK.zone() + ")" }));
        wrap.appendChild(input);
        wrap.appendChild(twoHost);
        paintTwo();
        return wrap;
      }
      function paint() {
        host.textContent = "";
        var stt = STATUS[job.status] || STATUS.review;
        var pillText = job.status === "scheduled" && job.post_at ? "Planned " + DK.when(job.post_at) : stt[0];
        host.appendChild(h("div", { class: "row between wrap" },
          h("div", { class: "row" }, DK.platDot(job.platform), h("div", null, h("div", { class: "strong", text: name }), job.handle ? h("div", { class: "small muted", text: "@" + String(job.handle).replace(/^@/, "") }) : null)),
          DK.pill(pillText, stt[1], stt[2])));
        var words = mainText(job.copy);
        if (words) host.appendChild(h("p", { class: "cap", text: words }));
        var checks = Array.isArray(job.checks) ? job.checks : [];
        if (checks.length && job.status === "review") {
          var ul = h("div", { class: "stack-s mt-s" });
          checks.slice(0, 2).forEach(function (c) { ul.appendChild(DK.note(c, "warn")); });
          if (checks.length > 2) ul.appendChild(h("p", { class: "tiny muted", text: "And " + (checks.length - 2) + " more in Dandelion." }));
          host.appendChild(ul);
        }
        if (local.msg) host.appendChild(h("p", { class: "ok-line", role: "status" }, DK.glyph("check"), local.msg));
        if (local.err) host.appendChild(DK.err(local.err));
        if (job.status === "review") {
          var actions = h("div", { class: "actions" });
          actions.appendChild(DK.twoTap({
            label: "Approve now", icon: "send", kind: "gold", small: true,
            question: "Post this now?",
            detail: "It goes out on " + name + " right away." + (checks.length ? " Dandelion found things to fix above." : ""),
            yes: "Yes, post it",
            onConfirm: approveNow
          }));
          actions.appendChild(DK.btn("Schedule", { small: true, icon: "clock", onclick: function () { local.open = !local.open; paint(); } }));
          actions.appendChild(DK.btn("Skip", { small: true, kind: "quiet", icon: "x", onclick: skip }));
          host.appendChild(actions);
          if (local.open) host.appendChild(schedBox());
        }
      }
      paint();
      card.appendChild(host);
      return card;
    }

    function paintJobs() {
      jobsHost.textContent = "";
      var sent = bundle.sent;
      if (!sent) return;
      var jobs = Array.isArray(sent.jobs) ? sent.jobs : [];
      var box = h("section", { class: "card" });
      box.appendChild(h("div", { class: "row wrap" }, DK.pill(sent.mode === "review" ? "Sent for review" : "Saved to library", "ok", "check"),
        h("span", { class: "small muted", text: "Nothing has gone out yet." })));
      if (!jobs.length) {
        if (sent.mode === "library") box.appendChild(h("p", { class: "small mt-s", text: "Your files are in your Dandelion library as Not shared yet." }));
        var ready = postable();
        if (!ready.length) {
          box.appendChild(h("div", { class: "mt" }, DK.note("No app is connected to this brand yet, so there is nothing to approve. Connect one to post:", "warn")));
          box.appendChild(h("div", { class: "mt-s" }, channelRows()));
        } else if (sent.mode === "library") {
          var row = h("div", { class: "actions" }, DK.btn("Send for review", { kind: "gold", icon: "send", disabled: !!st.busy, onclick: function () { send("review"); } }));
          box.appendChild(row);
        }
        if (st.busy) box.appendChild(h("div", { class: "mt" }, DK.busy(st.busy)));
        if (st.error) box.appendChild(DK.err(st.error));
      } else {
        var list = h("div", { class: "mt" });
        jobs.forEach(function (j) { list.appendChild(jobCard(j)); });
        box.appendChild(list);
        var open = DK.linkBtn("Open in Dandelion", DK.appUrl("/app"), { small: true });
        if (open) box.appendChild(h("div", { class: "mt-s" }, open));
      }
      jobsHost.appendChild(box);
    }

    function paintAll() {
      paintPreview();
      noticeHost.textContent = "";
      if (st.notice) noticeHost.appendChild(DK.note(st.notice, "warn"));
      wordsCard.hidden = !!bundle.sent;
      if (bundle.sent) {
        tabsHost.textContent = ""; panelHost.textContent = ""; actionHost.textContent = "";
        paintJobs();
      } else {
        jobsHost.textContent = "";
        paintTabs(); paintPanel(); paintAction();
      }
    }

    var wordsCard = h("section", { class: "card" }, h("p", { class: "sec-title", text: "Words for each app" }), tabsHost, panelHost);
    paintAll();
    if (!dl.connected && d0.pending) startPolling();
    var sub = bundle.sent ? "Check each post, then approve it." : plats.length ? "A version for each app, ready to check." : "Words for each app.";
    return [
      DK.head("Post it with Dandelion", { sub: sub }),
      noticeHost, previewHost,
      wordsCard,
      actionHost, jobsHost
    ];
  }

  DK.view("kit-post", { tools: ["offer_post", "set_channel_copy", "connect_dandelion", "dandelion_status", "send_to_dandelion"], build: build });
})();
