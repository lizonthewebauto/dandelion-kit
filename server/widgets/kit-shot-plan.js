// Card script for "kit-shot-plan": the hook, then each beat with how it is shown. Edit, then build a draft.
// Shown by plan_shots and update_shot_plan. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var FIRST = 6;
  var KINDS = {
    "number-stat": "Number", "list-step": "List step", contrast: "Contrast", instruction: "Instruction", question: "Question",
    story: "Story", emotional: "Emotional", cta: "Call to action", claim: "Claim", "default": "Talking"
  };
  var TREATMENTS = [
    ["face", "Face"], ["punch-in", "Punch in"], ["hold-wide", "Hold wide"],
    ["text-emphasis", "Emphasis word"], ["hook-card", "Hook card"], ["cta-end", "Call to action"]
  ];
  var DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");

  function nice(id) {
    var t = String(id || "").replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function treatmentName(id) {
    for (var i = 0; i < TREATMENTS.length; i++) if (TREATMENTS[i][0] === id) return TREATMENTS[i][1];
    return nice(id);
  }

  function build(d) {
    var pid = d.project_id;
    var beats = Array.isArray(d.beats) ? d.beats : [];
    var hook = d.hook || {};
    var cands = Array.isArray(hook.candidates) ? hook.candidates : [];
    var edits = {};
    var auto = hook.source === "auto";
    var st = { hook: hook.text || "", hookOrig: hook.text || "", busy: "", error: "", saved: !!d.saved, showAll: false };
    var body = h("div");

    function dirtyBeat(b) {
      var e = edits[b.id];
      if (!e) return false;
      return (e.treatment !== undefined && e.treatment !== b.treatment) || (e.text !== undefined && e.text !== (b.screen_text || ""));
    }
    function dirty() { return st.hook !== st.hookOrig || beats.some(dirtyBeat); }
    function payload() {
      var changed = [];
      beats.forEach(function (b) {
        if (!dirtyBeat(b)) return;
        var e = edits[b.id], item = { id: b.id };
        if (e.treatment !== undefined && e.treatment !== b.treatment) item.treatment = e.treatment;
        if (e.text !== undefined && e.text !== (b.screen_text || "")) item.text = e.text;
        changed.push(item);
      });
      var args = { project_id: pid, beats: changed };
      if (st.hook !== st.hookOrig) args.hook_text = st.hook;
      return args;
    }
    function hookProblem() {
      var n = DK.wordCount(st.hook);
      if (DASH.test(st.hook)) return "Take the dash out of the hook.";
      if (n > 9) return "The hook can be 9 words at most. This one is " + n + ".";
      if (!n) return "The hook needs some words.";
      return "";
    }

    function save(thenBuild) {
      var bad = hookProblem();
      if (bad) { st.error = bad; render(); return; }
      var work = dirty() ? DK.call("update_shot_plan", payload()) : Promise.resolve(null);
      st.busy = thenBuild ? "Saving your edits..." : "Saving your edits..."; st.error = ""; render();
      work.then(function (r) {
        if (r) DK.tellModel("In the Dandelion Kit card the person edited the shot plan and saved it" + (st.hook !== st.hookOrig ? ". The hook is now: " + st.hook : "") + ".");
        if (!thenBuild) {
          if (r) { r.saved = true; DK.go("update_shot_plan", r); } else { st.busy = ""; render(); }
          return null;
        }
        st.busy = "Building the draft. This can take a minute..."; render();
        return DK.call("render_reel", { project_id: pid, quality: "draft" }).then(function (rr) {
          DK.tellModel("In the Dandelion Kit card the person tapped Build draft. The draft preview is on screen.");
          DK.go("render_reel", rr);
        });
      }).catch(function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function hookSection() {
      var wrap = h("div");
      wrap.appendChild(h("p", { class: "sec-title", text: "The hook (first 2 seconds)" }));
      if (auto && st.hook === st.hookOrig) wrap.appendChild(h("p", { class: "small mt-s", text: "Made from the words in the video. Write your own below; the kit's suggestions are fallbacks." }));
      var group = h("div", { role: "radiogroup", "aria-label": "Hook choices" });
      cands.forEach(function (c) {
        var on = st.hook === c.text;
        var good = Number(c.score) >= 70 && !auto;
        var b = h("button", { type: "button", class: "hookopt", role: "radio", "aria-checked": on ? "true" : "false", disabled: !!st.busy },
          h("span", { class: "radio", "aria-hidden": "true" }),
          h("span", { class: "grow", text: c.text }),
          auto ? DK.pill(String(Math.round(Number(c.score) || 0)), "off", null) : DK.pill(String(Math.round(Number(c.score) || 0)), good ? "ok" : "warn", good ? "check" : "alert"));
        b.setAttribute("aria-label", c.text + ". Score " + Math.round(Number(c.score) || 0) + (auto ? "" : good ? ", good" : ", weak"));
        b.addEventListener("click", function () { st.hook = c.text; st.saved = false; render(); });
        group.appendChild(b);
      });
      if (cands.length) wrap.appendChild(group);
      var f = DK.textField({ label: "Or write your own", value: st.hook, hint: "Up to 9 words. The kit scores it when you save.", onInput: function (v) {
        st.hook = v; st.saved = false;
        var bad = hookProblem();
        wc.textContent = DK.wordCount(v) + " / 9 words";
        wc.className = "tiny num " + (bad ? "strong" : "muted");
        wc.style.color = bad ? "var(--dk-danger)" : "";
      } });
      var wc = h("p", { class: "tiny num muted", text: DK.wordCount(st.hook) + " / 9 words" });
      wrap.appendChild(h("div", { class: "mt" }, f.el, wc));
      if (st.hook === st.hookOrig && hook.score) {
        wrap.appendChild(h("p", { class: "small muted mt-s", text: (auto ? "Auto-made, scored " : "Score ") + Math.round(hook.score) + " of 100" + (hook.formula ? ", from the " + nice(hook.formula) + " pattern" : "") + "." }));
      }
      return wrap;
    }

    function beatRow(b, i) {
      var e = edits[b.id] || (edits[b.id] = {});
      var curT = e.treatment !== undefined ? e.treatment : b.treatment;
      var curText = e.text !== undefined ? e.text : b.screen_text || "";
      var sel = h("select", { class: "field", id: DK.uid("t"), "aria-label": "How beat " + (i + 1) + " is shown", disabled: !!st.busy });
      var opts = TREATMENTS.slice();
      if (!opts.some(function (t) { return t[0] === curT; })) opts.push([curT, nice(curT)]);
      opts.forEach(function (t) {
        var o = h("option", { value: t[0], text: t[1] });
        if (t[0] === curT) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { e.treatment = sel.value; st.saved = false; refresh(); });
      var words = DK.wordCount(curText);
      var tip = h("p", { class: "tiny muted mt-s" });
      function check() {
        var n = DK.wordCount(inp.input.value);
        tip.textContent = n === 0 ? "On-screen text is optional. 3 to 7 words works best." : n < 3 || n > 7 ? n + " words. 3 to 7 reads best." : n + " words.";
      }
      var inp = DK.textField({ label: "On-screen text", value: curText, placeholder: "Optional, 3 to 7 words", onInput: function (v) { e.text = v; st.saved = false; check(); refresh(); } });
      check();
      var later = b.wanted_treatment && b.wanted_treatment !== b.treatment
        ? h("p", { class: "tiny muted mt-s", text: "Later: " + treatmentName(b.wanted_treatment) + " (drawn as " + treatmentName(b.rendered_as || "face") + " for now)." }) : null;
      return h("li", { class: "beat" },
        h("div", { class: "row" },
          h("span", { class: "beatn num", text: String(i + 1) }),
          h("span", { class: "kind", text: KINDS[b.kind] || nice(b.kind) }),
          h("span", { class: "small muted num grow", text: DK.clock(b.out_start_ms) + " to " + DK.clock(b.out_end_ms) })),
        h("p", { class: "words", text: b.text }),
        h("div", { class: "two" },
          h("div", null, h("label", { class: "label", for: sel.id, text: "How it is shown" }), sel),
          h("div", null, inp.el, tip)),
        later);
    }

    var actionsHost = h("div");
    function paintActions() {
      actionsHost.textContent = "";
      var isDirty = dirty();
      var row = h("div", { class: "actions" });
      row.appendChild(DK.btn("Build draft", { kind: "gold", icon: "play", disabled: !!st.busy, onclick: function () { save(true); } }));
      if (isDirty) row.appendChild(DK.btn("Save edits", { icon: "check", disabled: !!st.busy, onclick: function () { save(false); } }));
      actionsHost.appendChild(row);
    }
    function refresh() { paintActions(); }

    function render() {
      body.textContent = "";
      body.appendChild(hookSection());
      body.appendChild(h("p", { class: "sec-title", text: DK.plural(beats.length, "beat") }));
      var ul = h("ul");
      (st.showAll ? beats : beats.slice(0, FIRST)).forEach(function (b, i) { ul.appendChild(beatRow(b, i)); });
      body.appendChild(ul);
      if (beats.length > FIRST && !st.showAll) {
        body.appendChild(h("div", { class: "mt-s" }, DK.btn("Show " + (beats.length - FIRST) + " more beats", { kind: "quiet", small: true, onclick: function () { st.showAll = true; render(); } })));
      }
      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      if (st.saved && !st.busy && !dirty()) body.appendChild(h("p", { class: "ok-line", role: "status" }, DK.glyph("check"), "Saved."));
      paintActions();
      body.appendChild(actionsHost);
    }

    var stats = d.stats || {};
    var bits = [];
    if (d.duration_ms) bits.push(DK.clock(d.duration_ms) + " long");
    if (stats.captions) bits.push(DK.plural(stats.captions, "caption"));
    if (stats.camera) bits.push(DK.plural(stats.camera, "camera move"));
    if (stats.sfx !== undefined) bits.push(DK.plural(stats.sfx, "sound effect"));
    render();
    return [
      DK.head("Shot plan", { sub: (d.look_name || (d.look_id ? nice(d.look_id) : "")) + (bits.length ? ", " + bits.join(", ") : "") }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-shot-plan", { tools: ["plan_shots", "update_shot_plan"], build: build });
})();
