// Card script for "kit-carousel": slide strip, a fields editor for the chosen slide, layout picker, brand colors.
// Shown by make_carousel, make_image and update_slides. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;

  var LAYOUTS = [
    { id: "cover", label: "Cover", fields: { kicker: "", title: "", subtitle: "" } },
    { id: "list", label: "List", fields: { title: "", items: ["", ""] } },
    { id: "steps", label: "Steps", fields: { title: "", steps: [{ n: 1, text: "" }, { n: 2, text: "" }] } },
    { id: "stat", label: "Big number", fields: { number: "", label: "", note: "" } },
    { id: "comparison", label: "Comparison", fields: { title: "", left: { h: "", items: ["", ""] }, right: { h: "", items: ["", ""] } } },
    { id: "quote", label: "Quote", fields: { quote: "", who: "" } },
    { id: "checklist", label: "Checklist", fields: { title: "", items: ["", ""] } },
    { id: "myth-fact", label: "Myth and fact", fields: { myth: "", fact: "" } },
    { id: "before-after", label: "Before and after", fields: { title: "", before: "", after: "" } },
    { id: "cta", label: "Call to action", fields: { title: "", line: "", handle: "" } },
    { id: "photo-hero", label: "Photo", fields: { image: "", title: "", overlay: "" } },
    { id: "framework", label: "Framework", fields: { title: "", cells: [{ h: "", text: "" }, { h: "", text: "" }] } }
  ];
  // Character budgets from the plan. "name#" is how many items a list can hold; "name[]" is the length of each item.
  var BUDGET = {
    cover: { title: 60, subtitle: 90 },
    list: { "items#": 6, "items[]": 48 },
    steps: { "steps#": 5, "steps[].text": 70 },
    quote: { quote: 140 },
    checklist: { "items#": 7 },
    framework: { "cells#": 4 }
  };
  var LABELS = { h: "Heading", who: "Who said it", image: "Image file path", overlay: "Text over the photo", cta: "Call to action", handle: "Handle", line: "Line", text: "Text", number: "Number", kicker: "Small line on top" };
  var LONG = { quote: 1, subtitle: 1, fact: 1, myth: 1, note: 1, text: 1, overlay: 1, line: 1 };
  var SIZES = { portrait: "Portrait, 1080 by 1350", square: "Square, 1080 by 1080", story: "Story, 1080 by 1920" };

  function nice(id) {
    if (LABELS[id]) return LABELS[id];
    var t = String(id || "").replace(/-/g, " ").replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function layoutDef(id) { for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i].id === id) return LAYOUTS[i]; return null; }
  function layoutLabel(id) { var l = layoutDef(id); return l ? l.label : nice(id); }

  /** Template fields for a layout, keeping values whose key exists in both the old and new layout. */
  function switchFields(newId, oldFields) {
    var def = layoutDef(newId);
    var next = def ? clone(def.fields) : {};
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(oldFields || {}, k) && typeof next[k] === "string" && typeof oldFields[k] === "string") next[k] = oldFields[k];
    }
    return next;
  }
  /** What we send to update_slides: no blank list items, steps numbered in order. */
  function normalize(v, key) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "string") return v.filter(function (s) { return String(s).trim() !== ""; });
      return v.map(function (item, i) {
        var o = normalize(item);
        if (o && typeof o === "object" && typeof o.n === "number") o.n = i + 1;
        return o;
      });
    }
    if (v && typeof v === "object") {
      var out = {};
      for (var k in v) out[k] = normalize(v[k], k);
      return out;
    }
    return v;
  }

  function build(d) {
    var pid = d.project_id;
    var rendered = Array.isArray(d.slides) ? d.slides : [];
    var userBudget = d.budgets && typeof d.budgets === "object" ? d.budgets : {};
    var slides = rendered.map(function (s, i) { return { layout: s.layout, fields: clone(s.fields || {}), orig: i, snap: JSON.stringify([s.layout, s.fields || {}]) }; });
    var st = { sel: 0, dirty: false, busy: "", error: "", saved: !!d.saved };
    var body = h("div");
    var fieldRegistry = [];
    var actionsHost = h("div");

    function budget(layoutId, path) {
      var key = layoutId + ":" + path;
      if (userBudget[key] !== undefined) return userBudget[key];
      var t = BUDGET[layoutId];
      return t && t[path] !== undefined ? t[path] : 0;
    }
    function anyOver() { return fieldRegistry.some(function (f) { return f.over(); }); }
    function changed() { st.dirty = true; st.saved = false; paintActions(); }

    /* ---- the generic fields editor ---- */
    function editString(obj, key, label, path, layoutId, host) {
      var max = budget(layoutId, path);
      var f = DK.textField({
        label: label, value: obj[key], max: max || 0, area: !!LONG[key] || max >= 70, rows: 2,
        onInput: function (v) { obj[key] = v; changed(); }
      });
      fieldRegistry.push(f);
      host.appendChild(f.el);
    }
    function editStringList(arr, label, path, layoutId, host, rebuild) {
      var maxItems = budget(layoutId, path + "#");
      var maxLen = budget(layoutId, path + "[]");
      var box = h("div", { class: "group" }, h("p", { class: "label", text: label + (maxItems ? " (up to " + maxItems + ")" : "") }));
      arr.forEach(function (item, i) {
        var f = DK.textField({ label: label + " " + (i + 1), hideLabel: true, value: item, max: maxLen || 0, placeholder: label + " " + (i + 1), onInput: function (v) { arr[i] = v; changed(); } });
        fieldRegistry.push(f);
        var row = h("div", { class: "row top", style: "margin-top:8px" }, h("div", { class: "grow" }, f.el),
          arr.length > 1 ? DK.btn("", { kind: "quiet", tiny: true, icon: "x", aria: "Remove " + label + " " + (i + 1), onclick: function () { arr.splice(i, 1); changed(); rebuild(); } }) : null);
        box.appendChild(row);
      });
      if (!maxItems || arr.length < maxItems) box.appendChild(h("div", { class: "mt-s" }, DK.btn("Add one", { kind: "quiet", tiny: true, icon: "plus", onclick: function () { arr.push(""); changed(); rebuild(); } })));
      host.appendChild(box);
    }
    function editObjectList(arr, label, path, layoutId, host, rebuild) {
      var maxItems = budget(layoutId, path + "#");
      var box = h("div", { class: "group" }, h("p", { class: "label", text: label + (maxItems ? " (up to " + maxItems + ")" : "") }));
      arr.forEach(function (item, i) {
        var inner = h("div", { class: "group" });
        var head = h("div", { class: "row between" }, h("span", { class: "strong small", text: label.replace(/s$/, "") + " " + (i + 1) }),
          arr.length > 1 ? DK.btn("Remove", { kind: "quiet", tiny: true, icon: "x", onclick: function () { arr.splice(i, 1); changed(); rebuild(); } }) : null);
        inner.appendChild(head);
        for (var k in item) {
          if (k === "n" && typeof item[k] === "number") continue;
          if (typeof item[k] === "string") editString(item, k, nice(k), path + "[]." + k, layoutId, inner);
        }
        box.appendChild(inner);
      });
      if (!maxItems || arr.length < maxItems) {
        box.appendChild(h("div", { class: "mt-s" }, DK.btn("Add one", { kind: "quiet", tiny: true, icon: "plus", onclick: function () {
          var blank = {};
          for (var k in (arr[0] || {})) blank[k] = typeof arr[0][k] === "number" ? arr.length + 1 : "";
          arr.push(blank); changed(); rebuild();
        } })));
      }
      host.appendChild(box);
    }
    function editFields(obj, layoutId, host, prefix, rebuild) {
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var v = obj[k];
        var path = prefix + k;
        if (typeof v === "string") editString(obj, k, nice(k), path, layoutId, host);
        else if (Array.isArray(v) && (!v.length || typeof v[0] === "string")) editStringList(v, nice(k), path, layoutId, host, rebuild);
        else if (Array.isArray(v)) editObjectList(v, nice(k), path, layoutId, host, rebuild);
        else if (v && typeof v === "object") {
          var g = h("div", { class: "group" }, h("p", { class: "label", text: nice(k) }));
          editFields(v, layoutId, g, path + ".", rebuild);
          host.appendChild(g);
        }
      }
    }

    /* ---- actions ---- */
    function rerender() {
      if (anyOver()) { st.error = "A field is too long. Shorten it and try again."; render(); return; }
      var payload = slides.map(function (s) { return { layout: s.layout, fields: normalize(s.fields) }; });
      st.busy = "Rendering your slides..."; st.error = ""; render();
      DK.call("update_slides", { project_id: pid, slides: payload }).then(function (r) {
        var old = [];
        rendered.forEach(function (s) { if (s.asset_id) old.push(s.asset_id); if (s.thumb_asset_id) old.push(s.thumb_asset_id); });
        DK.forget(old);
        DK.tellModel("In the Dandelion Kit card the person edited the slides and tapped Re-render. " + payload.length + " slides were rendered again.");
        r.saved = true;
        DK.go("update_slides", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function post() {
      var files = rendered.map(function (s) { return s.file; }).filter(Boolean);
      st.busy = "Getting the channel versions ready..."; st.error = ""; render();
      DK.call("offer_post", { kind: files.length === 1 ? "image" : "carousel", project_id: pid, files: files }).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Post with Dandelion for " + (files.length === 1 ? "the image" : "the " + files.length + " slide carousel") + ". The channel versions are on screen. Nothing has been sent.");
        DK.go("offer_post", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }
    function move(from, to) {
      if (to < 0 || to >= slides.length) return;
      var s = slides.splice(from, 1)[0];
      slides.splice(to, 0, s);
      st.sel = to; changed(); render();
    }

    function paintActions() {
      actionsHost.textContent = "";
      var row = h("div", { class: "actions" });
      var over = anyOver();
      row.appendChild(DK.btn("Re-render", { kind: st.dirty ? "gold" : "", icon: "check", disabled: !!st.busy || !st.dirty || over, onclick: rerender }));
      row.appendChild(DK.btn("Post with Dandelion", { kind: st.dirty ? "" : "gold", icon: "send", disabled: !!st.busy || st.dirty || !rendered.length, onclick: post }));
      actionsHost.appendChild(row);
      if (st.dirty && !st.busy) actionsHost.appendChild(h("p", { class: "small muted mt-s", text: over ? "A field is over its limit. Shorten it to render." : "You changed something. Re-render to update the pictures, then post." }));
    }

    function render() {
      body.textContent = "";
      fieldRegistry = [];
      var cur = slides[st.sel];
      var strip = h("div", { class: "strip", role: "tablist", "aria-label": "Slides" });
      slides.forEach(function (s, i) {
        var r = s.orig !== null && s.orig !== undefined ? rendered[s.orig] : null;
        var ratio = (r && r.width && r.height ? r.width + " / " + r.height : (d.width && d.height ? d.width + " / " + d.height : "4 / 5"));
        var b = h("button", { type: "button", class: "slidebtn", role: "tab", "aria-selected": i === st.sel ? "true" : "false", "aria-label": "Slide " + (i + 1) + ", " + layoutLabel(s.layout), disabled: !!st.busy },
          DK.img(r && (r.thumb_asset_id || r.asset_id), { ratio: ratio, alt: "Slide " + (i + 1) }),
          h("span", { class: "n", text: String(i + 1) }));
        b.addEventListener("click", function () { st.sel = i; render(); });
        strip.appendChild(b);
      });
      body.appendChild(strip);

      if (cur) {
        var r0 = cur.orig !== null && cur.orig !== undefined ? rendered[cur.orig] : null;
        var changedSlide = !r0 || JSON.stringify([cur.layout, cur.fields]) !== cur.snap;
        var ratio0 = r0 && r0.width && r0.height ? r0.width + " / " + r0.height : (d.width && d.height ? d.width + " / " + d.height : "4 / 5");
        var big = h("div", { class: "bigslide" }, DK.img(r0 && r0.asset_id, { ratio: ratio0, alt: "Slide " + (st.sel + 1) + " preview" }));
        body.appendChild(big);
        if (changedSlide) body.appendChild(h("div", { class: "mt-s", style: "text-align:center" }, DK.pill(r0 ? "Picture not updated yet" : "New slide, not drawn yet", "warn", "alert")));

        body.appendChild(h("div", { class: "row between wrap mt" },
          h("span", { class: "strong", text: "Slide " + (st.sel + 1) + " of " + slides.length }),
          h("div", { class: "row wrap", style: "gap:2px" },
            DK.btn("Earlier", { kind: "quiet", tiny: true, disabled: !!st.busy || st.sel === 0, onclick: function () { move(st.sel, st.sel - 1); } }),
            DK.btn("Later", { kind: "quiet", tiny: true, disabled: !!st.busy || st.sel === slides.length - 1, onclick: function () { move(st.sel, st.sel + 1); } }),
            DK.btn("Duplicate", { kind: "quiet", tiny: true, disabled: !!st.busy, onclick: function () { slides.splice(st.sel + 1, 0, { layout: cur.layout, fields: clone(cur.fields), orig: null, snap: "" }); st.sel += 1; changed(); render(); } }),
            DK.btn("Add", { kind: "quiet", tiny: true, icon: "plus", disabled: !!st.busy, onclick: function () { var def = layoutDef(cur.layout); slides.splice(st.sel + 1, 0, { layout: cur.layout, fields: def ? clone(def.fields) : {}, orig: null, snap: "" }); st.sel += 1; changed(); render(); } }),
            DK.btn("Remove", { kind: "quiet", tiny: true, disabled: !!st.busy || slides.length < 2, onclick: function () { slides.splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); changed(); render(); } }))));

        var sel = h("select", { class: "field", id: DK.uid("l"), disabled: !!st.busy });
        var known = LAYOUTS.some(function (l) { return l.id === cur.layout; });
        (known ? LAYOUTS : LAYOUTS.concat([{ id: cur.layout, label: nice(cur.layout) }])).forEach(function (l) {
          var o = h("option", { value: l.id, text: l.label });
          if (l.id === cur.layout) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () { cur.layout = sel.value; cur.fields = switchFields(sel.value, cur.fields); changed(); render(); });
        body.appendChild(h("label", { class: "label", for: sel.id, text: "Layout" }));
        body.appendChild(sel);
        body.appendChild(h("p", { class: "tiny muted mt-s", text: "Switching layout keeps matching text and clears the rest." }));

        var editor = h("div", { class: "mt-s" });
        editFields(cur.fields, cur.layout, editor, "", function () { render(); });
        body.appendChild(editor);
      }

      var brand = d.brand || {};
      var colors = brand.colors || {};
      body.appendChild(h("p", { class: "sec-title", text: "Brand" }));
      var br = h("div", { class: "brandrow" },
        h("span", { class: "strong small", text: brand.name || "Default brand" }),
        brand.handle ? h("span", { class: "small muted", text: brand.handle }) : null);
      ["bg", "fg", "accent", "muted"].forEach(function (k) {
        if (!colors[k]) return;
        var chip = h("span", { class: "chip-color", role: "img", "aria-label": k + " " + colors[k] });
        chip.style.background = colors[k];
        br.appendChild(h("span", { class: "row small", style: "gap:5px" }, chip, h("span", { class: "muted num", text: colors[k] })));
      });
      body.appendChild(br);
      body.appendChild(h("p", { class: "tiny muted mt-s", text: "Colors and fonts come from your brand.json. Change that file to restyle every slide." }));

      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      if (st.saved && !st.dirty && !st.busy) body.appendChild(h("p", { class: "ok-line", role: "status" }, DK.glyph("check"), "Rendered again. The pictures are up to date."));
      paintActions();
      body.appendChild(actionsHost);
    }

    render();
    var isOne = rendered.length === 1;
    return [
      DK.head(d.title || (isOne ? "Image" : "Carousel"), { sub: DK.plural(rendered.length, "slide") + ", " + (SIZES[d.size] || (d.width && d.height ? d.width + " by " + d.height : "JPEG")) + ", JPEG" }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-carousel", { tools: ["make_carousel", "make_image", "update_slides"], build: build });
})();
