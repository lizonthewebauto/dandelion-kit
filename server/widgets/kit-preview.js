// Card script for "kit-preview": play the reel, see 8 frames and every check, then render final, make variants or post.
// Shown by render_reel, check_reel and make_variants. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var OPENING = { "hook-card": "Hook card first", "cold-open": "Straight into speech" };

  function nice(id) {
    var t = String(id || "").replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // The build is still running: a progress bar and a button that asks again with the same arguments.
  function buildPending(d) {
    var pid = d.project_id;
    var variants = d.tool === "make_variants";
    var tool = variants ? "make_variants" : "render_reel";
    var what = variants ? "variants" : d.quality === "draft" ? "draft" : "final reel";
    var st = { busy: false, error: "" };
    var body = h("div");

    function again() {
      st.busy = true; st.error = ""; render();
      var asked = variants
        ? DK.call("make_variants", { project_id: pid, count: d.count || 2 })
        : DK.call("render_reel", { project_id: pid, quality: d.quality === "draft" ? "draft" : "final" });
      asked.then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Check again for the " + what + ". " + (r && r.pending ? "It is still being built, and a progress bar is on screen." : "It is finished and on screen."));
        DK.go(tool, r);
      }, function (e) { st.busy = false; st.error = e.message; render(); });
    }

    function render() {
      body.textContent = "";
      body.appendChild(h("p", { class: "strong", text: variants ? "Making your variants" : d.quality === "draft" ? "Building your draft" : "Building your final reel" }));
      body.appendChild(DK.progress(d.progress, "Build progress"));
      if (d.message) body.appendChild(h("p", { class: "small muted mt-s", text: d.message }));
      body.appendChild(h("p", { class: "small mt-s", text: "This is still working. It keeps going if you leave this open, and nothing is lost." }));
      if (st.busy) body.appendChild(DK.busy("Checking..."));
      if (st.error) body.appendChild(DK.err(st.error));
      body.appendChild(h("div", { class: "actions" },
        DK.btn("Check again", { kind: "gold", icon: "film", disabled: st.busy, onclick: again })));
    }

    render();
    return [
      DK.head(variants ? "Making variants" : "Building your reel", { pill: DK.pill("Building", "gold", "film"), sub: "Still working. It can take a few minutes." }),
      h("section", { class: "card" }, body)
    ];
  }

  function build(d) {
    if (d.pending) return buildPending(d);
    var pid = d.project_id;
    var renders = Array.isArray(d.renders) ? d.renders : [];
    var st = { active: d.active || (renders[renders.length - 1] && renders[renders.length - 1].id) || "", busy: "", error: "" };
    var body = h("div");
    function byId(id) { for (var i = 0; i < renders.length; i++) if (renders[i].id === id) return renders[i]; return renders[0] || null; }
    function hasFinal() { return renders.some(function (r) { return r.quality === "final"; }); }

    function doFinal() {
      st.busy = "Rendering the final reel. This can take a few minutes..."; st.error = ""; render();
      DK.call("render_reel", { project_id: pid, quality: "final" }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Render final. " + (r && r.pending ? "It is still being built, and a progress bar is on screen." : "The finished reel and its checks are on screen."));
        DK.go("render_reel", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function doVariants() {
      st.busy = "Making 2 variants. The speech stays the same..."; st.error = ""; render();
      DK.call("make_variants", { project_id: pid, count: 2 }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Make variants. " + (r && r.pending ? "They are still being built, and a progress bar is on screen." : "Two versions with the same speech are on screen as tabs."));
        DK.go("make_variants", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function doCheck(rr) {
      st.busy = "Checking the file..."; st.error = ""; render();
      DK.call("check_reel", { project_id: pid, file: rr.file }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person ran the checks again on " + DK.base(rr.file) + ".");
        DK.go("check_reel", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function doPost(rr) {
      st.busy = "Getting the channel versions ready..."; st.error = ""; render();
      DK.call("offer_post", { kind: "video", project_id: pid, files: [rr.file] }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Post with Dandelion for " + DK.base(rr.file) + ". The channel versions are on screen. Nothing has been sent.");
        DK.go("offer_post", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function panel(rr) {
      var wrap = h("div");
      var tally = DK.checkTally(rr.checks);
      var verdict = tally.stop ? DK.pill(DK.plural(tally.stop, "stop"), "bad", "stop")
        : tally.warn ? DK.pill(DK.plural(tally.warn, "warning"), "warn", "alert")
        : DK.pill(rr.checks && rr.checks.length ? "All checks pass" : "No checks yet", rr.checks && rr.checks.length ? "ok" : "off", rr.checks && rr.checks.length ? "check" : null);
      wrap.appendChild(h("div", { class: "row", style: "justify-content:center" }, DK.video(rr.video_asset_id, { posterId: (rr.frame_asset_ids || [])[0], width: "250px", alt: "Preview of " + (rr.label || "the reel") })));
      wrap.appendChild(h("div", { class: "row wrap mt", style: "justify-content:space-between" },
        h("div", null,
          h("div", { class: "strong", text: rr.quality === "draft" ? "Draft preview" : rr.variant_id ? (rr.label || "Variant") : "Final reel" }),
          h("div", { class: "small muted num", text: [DK.clock(rr.duration_ms), DK.bytes(rr.bytes), rr.quality === "draft" ? "540 by 960" : "1080 by 1920"].join(", ") })),
        verdict));
      var frames = Array.isArray(rr.frame_asset_ids) ? rr.frame_asset_ids.slice(0, 8) : [];
      if (frames.length) {
        var film = h("div", { class: "film", role: "list", "aria-label": "Frames from the reel" });
        frames.forEach(function (f, i) {
          var cell = DK.img(f, { alt: "Frame " + (i + 1) + " of " + frames.length });
          cell.setAttribute("role", "listitem");
          film.appendChild(cell);
        });
        wrap.appendChild(h("div", { class: "mt" }, film));
      }
      if (rr.axes) {
        var a = rr.axes;
        wrap.appendChild(h("p", { class: "sec-title", text: "What is different" }));
        wrap.appendChild(h("dl", { class: "facts" },
          h("div", null, h("dt", { text: "Hook" }), h("dd", { text: a.hook_text || "" })),
          h("div", null, h("dt", { text: "Opening" }), h("dd", { text: OPENING[a.opening] || nice(a.opening) })),
          h("div", null, h("dt", { text: "Captions" }), h("dd", { text: nice(a.caption_theme) })),
          h("div", null, h("dt", { text: "Pace" }), h("dd", { text: nice(a.pace) }))));
      }
      wrap.appendChild(h("p", { class: "sec-title", text: "Checks" }));
      if (rr.checks && rr.checks.length) wrap.appendChild(DK.checks(rr.checks));
      else wrap.appendChild(h("p", { class: "small muted", text: "No checks have run on this file yet." }));
      wrap.appendChild(h("p", { class: "tiny muted mt", text: "File: " + rr.file }));
      return wrap;
    }

    function render() {
      body.textContent = "";
      var rr = byId(st.active);
      if (!rr) { body.appendChild(DK.note("There is nothing to show yet. Build a draft first.", "warn")); return; }
      if (renders.length > 1) {
        var tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Versions" });
        renders.forEach(function (r) {
          var b = h("button", { type: "button", class: "tab", role: "tab", "aria-selected": r.id === rr.id ? "true" : "false", disabled: !!st.busy }, r.label || nice(r.id));
          b.addEventListener("click", function () { st.active = r.id; render(); });
          tabs.appendChild(b);
        });
        body.appendChild(tabs);
      }
      body.appendChild(panel(rr));
      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));

      var tally = DK.checkTally(rr.checks);
      var isFinal = rr.quality === "final";
      var actions = h("div", { class: "actions" });
      if (!hasFinal()) actions.appendChild(DK.btn("Render final", { kind: "gold", icon: "film", disabled: !!st.busy, onclick: doFinal }));
      if (isFinal) actions.appendChild(DK.btn("Post with Dandelion", { kind: "gold", icon: "send", disabled: !!st.busy || tally.stop > 0, onclick: function () { doPost(rr); } }));
      actions.appendChild(DK.btn("Make 2 variants", { icon: "layers", disabled: !!st.busy, onclick: doVariants }));
      actions.appendChild(DK.btn("Run checks again", { kind: "quiet", small: true, disabled: !!st.busy, onclick: function () { doCheck(rr); } }));
      body.appendChild(actions);
      if (!isFinal) body.appendChild(h("p", { class: "small muted mt-s", text: "Drafts are small and stamped DRAFT. Render the final reel before you post." }));
      if (isFinal && tally.stop > 0) body.appendChild(h("div", { class: "mt-s" }, DK.note("A check says stop, so posting is off. Fix it and render again.", "bad")));
    }

    render();
    var rr0 = byId(st.active);
    return [
      DK.head(rr0 && rr0.quality === "final" ? "Your reel" : "Draft preview", { sub: renders.length > 1 ? DK.plural(renders.length, "version") + ", same speech" : "Play it, then check the list." }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-preview", { tools: ["render_reel", "check_reel", "make_variants"], build: build });
})();
