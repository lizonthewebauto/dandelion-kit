// Card script for "kit-look-picker": five looks with a caption sample, an accent color and a caption style.
// Shown by pick_look. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var CAMERA = { calm: "Calm", standard: "Standard", bold: "Bold", chaos: "Wild" };
  var THEMES = ["karaoke-highlight", "karaoke-pill", "one-word-pop", "bold-stroke", "clean-minimal", "editorial-serif", "box-caption", "mono-terminal"];
  var ACCENTS = [
    { hex: "#FFD93D", name: "Marigold" }, { hex: "#FF8A3D", name: "Orange" }, { hex: "#FF5C7A", name: "Rose" },
    { hex: "#8B7CFF", name: "Violet" }, { hex: "#3DB8FF", name: "Sky" }, { hex: "#34D399", name: "Mint" }
  ];

  function nice(id) {
    var t = String(id || "").replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function accentName(hex, list) {
    var up = String(hex).toUpperCase();
    for (var i = 0; i < list.length; i++) if (list[i].hex.toUpperCase() === up) return list[i].name;
    return up;
  }
  function cadence(l) {
    var a = Number(l.cut_every_ms_min) || 0, b = Number(l.cut_every_ms_max) || 0;
    if (!a && !b) return "Steady";
    return "Every " + (a / 1000).toFixed(1).replace(/\.0$/, "") + " to " + (b / 1000).toFixed(1).replace(/\.0$/, "") + " s";
  }
  function sfx(l) {
    var n = Number(l.sfx_per_minute) || 0;
    return n === 0 ? "None" : n + " a minute";
  }

  function build(d) {
    var pid = d.project_id;
    var looks = Array.isArray(d.looks) ? d.looks : [];
    var cur = d.current || {};
    var st = {
      look: cur.look_id || (looks[0] && looks[0].id) || "",
      theme: cur.caption_theme || "",
      accent: cur.accent || "",
      touchedAccent: !!cur.accent, touchedTheme: !!cur.caption_theme,
      busy: "", error: "", saved: !!d.saved
    };
    var body = h("div");
    function lookById(id) { for (var i = 0; i < looks.length; i++) if (looks[i].id === id) return looks[i]; return null; }
    function chosen() { return lookById(st.look) || looks[0] || {}; }

    var accentList = ACCENTS.slice();
    (Array.isArray(d.accents) ? d.accents : []).forEach(function (hex) {
      if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) && !accentList.some(function (a) { return a.hex.toUpperCase() === hex.toUpperCase(); })) accentList.push({ hex: hex, name: hex.toUpperCase() });
    });
    looks.forEach(function (l) {
      if (l.accent && !accentList.some(function (a) { return a.hex.toUpperCase() === String(l.accent).toUpperCase(); })) accentList.push({ hex: l.accent, name: String(l.accent).toUpperCase() });
    });

    function pick(id) {
      st.look = id; st.saved = false;
      var l = lookById(id) || {};
      if (!st.touchedAccent && l.accent) st.accent = l.accent;
      if (!st.touchedTheme && l.caption_theme) st.theme = l.caption_theme;
      render();
    }
    function save() {
      var l = chosen();
      var theme = st.theme || l.caption_theme;
      var accent = st.accent || l.accent;
      st.busy = "Saving the look..."; st.error = ""; render();
      DK.call("pick_look", { project_id: pid, look: st.look, caption_theme: theme, accent: accent }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person picked the " + (l.name || st.look) + " look with " + nice(theme) + " captions and the accent " + accent + ".");
        r.saved = true;
        if (!r.current) r.current = { look_id: st.look, caption_theme: theme, accent: accent };
        DK.go("pick_look", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function plan() {
      st.busy = "Planning the shots..."; st.error = ""; render();
      DK.call("plan_shots", { project_id: pid }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person moved on to Plan shots. The shot plan is on screen.");
        DK.go("plan_shots", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function lookCard(l) {
      var on = l.id === st.look;
      var facts = h("dl", { class: "facts" },
        h("div", null, h("dt", { text: "Captions" }), h("dd", { text: nice(l.caption_theme) })),
        h("div", null, h("dt", { text: "Cuts" }), h("dd", { text: cadence(l) })),
        h("div", null, h("dt", { text: "Camera" }), h("dd", { text: CAMERA[l.camera_aggression] || "Standard" })),
        h("div", null, h("dt", { text: "Sound effects" }), h("dd", { text: sfx(l) })));
      var btn = h("button", { type: "button", class: "pick", role: "radio", "aria-checked": on ? "true" : "false", disabled: !!st.busy },
        DK.img(l.sample_asset_id, { alt: "A caption sample for " + l.name }),
        h("div", { class: "body" },
          h("div", { class: "row wrap" }, h("span", { class: "strong", text: l.name || nice(l.id) }), on ? DK.pill("Chosen", "gold", "check") : null),
          h("p", { class: "small muted mt-s", text: l.summary || "" }),
          facts));
      btn.addEventListener("click", function () { pick(l.id); });
      return btn;
    }

    function render() {
      body.textContent = "";
      var l = chosen();
      var group = h("div", { role: "radiogroup", "aria-label": "Looks" });
      looks.forEach(function (x) { group.appendChild(lookCard(x)); });
      body.appendChild(group);

      body.appendChild(h("p", { class: "sec-title", text: "Accent color" }));
      var sw = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Accent color" });
      var curAccent = (st.accent || l.accent || "").toUpperCase();
      accentList.forEach(function (a) {
        var b = h("button", { type: "button", class: "swatch", role: "radio", "aria-checked": a.hex.toUpperCase() === curAccent ? "true" : "false", "aria-label": a.name, title: a.name, disabled: !!st.busy });
        b.style.background = a.hex;
        b.addEventListener("click", function () { st.accent = a.hex; st.touchedAccent = true; st.saved = false; render(); });
        sw.appendChild(b);
      });
      body.appendChild(sw);
      body.appendChild(h("p", { class: "tiny muted mt-s", text: "Used for the word being spoken. Now: " + accentName(curAccent, accentList) + "." }));

      body.appendChild(h("p", { class: "sec-title", text: "Caption style" }));
      var sel = h("select", { class: "field", "aria-label": "Caption style", disabled: !!st.busy });
      var curTheme = st.theme || l.caption_theme;
      THEMES.forEach(function (t) {
        var o = h("option", { value: t, text: nice(t) });
        if (t === curTheme) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { st.theme = sel.value; st.touchedTheme = true; if (st.saved) { st.saved = false; render(); } });
      body.appendChild(sel);

      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      if (st.saved && !st.busy) body.appendChild(h("p", { class: "ok-line", role: "status" }, DK.glyph("check"), "Look saved: " + (l.name || nice(st.look)) + "."));
      var actions = h("div", { class: "actions" });
      if (st.saved) {
        actions.appendChild(DK.btn("Plan shots", { kind: "gold", icon: "film", disabled: !!st.busy, onclick: plan }));
        actions.appendChild(DK.btn("Change the look", { disabled: !!st.busy, onclick: function () { st.saved = false; render(); } }));
      } else {
        actions.appendChild(DK.btn("Use this look", { kind: "gold", icon: "check", disabled: !!st.busy || !looks.length, onclick: save }));
      }
      body.appendChild(actions);
    }

    render();
    return [
      DK.head("Pick a look", { sub: "A look sets the pace, captions, camera and sound." }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-look-picker", { tools: ["pick_look"], build: build });
})();
