// Card script for "kit-cut-review": what the rough cut would remove, with a switch on each piece.
// Shown by rough_cut and update_cut. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var FIRST = 8;
  var KINDS = { filler: "Filler", stutter: "Stutter", silence: "Pause", restart: "Restart", "phrase-filler": "Filler phrase" };
  var PRESETS = [{ id: "gentle", label: "Gentle" }, { id: "standard", label: "Standard" }, { id: "punchy", label: "Punchy" }];

  function build(d) {
    var pid = d.project_id;
    var spans = Array.isArray(d.removed) ? d.removed : [];
    var orig = {}, now = {};
    spans.forEach(function (s) { orig[s.id] = !!s.keep; now[s.id] = !!s.keep; });
    var st = { busy: "", error: "", saved: !!d.saved, showAll: false, preset: d.preset || "standard" };
    var body = h("div");

    function dur(s) { return Math.max(0, (s.src_end_ms || 0) - (s.src_start_ms || 0)); }
    function dirty() { return spans.some(function (s) { return now[s.id] !== orig[s.id]; }); }
    function estimate() {
      var ms = Number(d.after_ms) || 0;
      spans.forEach(function (s) {
        if (now[s.id] !== orig[s.id]) ms += now[s.id] ? dur(s) : -dur(s);
      });
      return ms;
    }
    function counts() {
      var cut = spans.filter(function (s) { return !now[s.id]; });
      return { cut: cut.length, total: spans.length };
    }

    function apply() {
      var keep = [], drop = [];
      spans.forEach(function (s) { (now[s.id] ? keep : drop).push(s.id); });
      st.busy = "Applying your changes..."; st.error = ""; render();
      DK.call("update_cut", { project_id: pid, keep_ids: keep, drop_ids: drop }).then(function (r) {
        var c = counts();
        DK.tellModel("In the Dandelion Kit card the person changed the rough cut and tapped Apply. " + c.cut + " of " + c.total + " pieces are cut. The reel is now about " + DK.clock(estimate()) + " long.");
        r.saved = true;
        DK.go("update_cut", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function setPreset(id) {
      st.preset = id; st.busy = "Finding the cuts for " + id + "..."; st.error = ""; render();
      DK.call("rough_cut", { project_id: pid, preset: id }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person chose the " + id + " rough cut preset. The list of cuts was rebuilt.");
        DK.go("rough_cut", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function next() {
      st.busy = "Getting the looks..."; st.error = ""; render();
      DK.call("pick_look", { project_id: pid }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person moved on from the rough cut to Pick a look. The look picker is on screen.");
        DK.go("pick_look", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function row(s) {
      var say = s.text ? h("span", { class: "say" }, h("q", { text: s.text })) : h("span", { class: "say muted", text: "A pause of " + DK.sec(dur(s)) });
      var tog = DK.toggle({
        checked: !now[s.id], onText: "Cut", offText: "Kept", label: (KINDS[s.kind] || "Piece") + " at " + DK.clock(s.src_start_ms) + ": " + (now[s.id] ? "keep" : "cut"),
        disabled: !!st.busy,
        onChange: function (on) { now[s.id] = !on; st.focus = s.id; render(); }
      });
      tog.querySelector("input").setAttribute("data-id", s.id);
      return h("li", { class: "span" },
        h("div", { class: "grow" },
          h("div", { class: "row wrap" }, h("span", { class: "kind", text: KINDS[s.kind] || "Cut" }), h("span", { class: "small muted num", text: DK.clock(s.src_start_ms) + ", " + DK.sec(dur(s)) })),
          h("div", { class: "mt-s" }, say)),
        tog);
    }

    function render() {
      body.textContent = "";
      var c = counts();
      var isDirty = dirty();
      var after = isDirty ? estimate() : Number(d.after_ms) || 0;
      var before = Number(d.before_ms) || 0;
      body.appendChild(h("div", { class: "bigtime", "aria-label": "From " + DK.clock(before) + " to " + DK.clock(after) },
        h("span", { class: "a num", text: DK.clock(before) }),
        h("span", { class: "arrow", "aria-hidden": "true", text: "to" }),
        h("span", { class: "b num", text: (isDirty ? "about " : "") + DK.clock(after) })));
      var saved = Math.max(0, before - after);
      body.appendChild(h("p", { class: "sub", text: saved > 0 ? "That takes out " + DK.sec(saved) + ". " + c.cut + " of " + DK.plural(c.total, "piece") + " will be cut." : "Nothing would be cut." }));

      body.appendChild(h("p", { class: "sec-title", text: "How tight" }));
      body.appendChild(DK.seg({ label: "Cut style", options: PRESETS, value: st.preset, disabled: !!st.busy, onPick: setPreset }));
      body.appendChild(h("p", { class: "tiny muted mt-s", text: "Changing this starts the list over." }));

      if (!spans.length) {
        body.appendChild(h("div", { class: "mt" }, DK.note("This one is already tight. There is nothing to take out.", "ok", "check")));
      } else {
        body.appendChild(h("p", { class: "sec-title", text: "What would be cut" }));
        var ul = h("ul");
        var shown = st.showAll ? spans : spans.slice(0, FIRST);
        shown.forEach(function (s) { ul.appendChild(row(s)); });
        body.appendChild(ul);
        if (spans.length > FIRST && !st.showAll) {
          body.appendChild(h("div", { class: "mt-s" }, DK.btn("Show " + (spans.length - FIRST) + " more", { kind: "quiet", small: true, onclick: function () { st.showAll = true; render(); } })));
        }
      }

      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      if (st.saved && !isDirty && !st.busy) body.appendChild(h("p", { class: "ok-line", role: "status" }, DK.glyph("check"), "Saved. The cut is set."));

      var actions = h("div", { class: "actions" });
      if (isDirty) {
        actions.appendChild(DK.btn("Apply changes", { kind: "gold", icon: "check", disabled: !!st.busy, onclick: apply }));
        actions.appendChild(DK.btn("Undo", { icon: "undo", disabled: !!st.busy, onclick: function () { spans.forEach(function (s) { now[s.id] = orig[s.id]; }); render(); } }));
      } else {
        actions.appendChild(DK.btn("Pick a look", { kind: "gold", icon: "palette", disabled: !!st.busy, onclick: next }));
      }
      body.appendChild(actions);
      if (st.focus) {
        var f = body.querySelector('input[data-id="' + st.focus + '"]');
        st.focus = "";
        if (f) f.focus();
      }
    }

    render();
    return [
      DK.head("Rough cut", { sub: "Flip a switch to keep a piece in." }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-cut-review", { tools: ["rough_cut", "update_cut"], build: build });
})();
