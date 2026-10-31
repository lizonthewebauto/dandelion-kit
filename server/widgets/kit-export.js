// Card script for "kit-export": the files that were written, with a button to open the folder or post them.
// Shown by export. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;
  var ICON = { video: "film", image: "photo", caption: "doc", doc: "doc" };
  var KIND = { video: "Video", image: "Image", caption: "Captions", doc: "Notes" };

  function build(d) {
    var files = Array.isArray(d.files) ? d.files : [];
    var st = { busy: "", error: "" };
    var body = h("div");
    var media = files.filter(function (f) { return f.kind === "video" || f.kind === "image"; });
    var videos = media.filter(function (f) { return f.kind === "video"; });
    var total = files.reduce(function (n, f) { return n + (Number(f.bytes) || 0); }, 0);

    function open(path, label) {
      st.error = "";
      DK.call("open_path", { path: path }).then(function () {
        DK.tellModel("In the Dandelion Kit card the person tapped " + label + " for " + path + ".");
      }, function (e) { st.error = e.message; render(); });
    }
    function post() {
      var picked = videos.length ? videos : media;
      var kind = videos.length ? "video" : picked.length === 1 ? "image" : "carousel";
      st.busy = "Getting the channel versions ready..."; st.error = ""; render();
      var args = { kind: kind, files: picked.map(function (f) { return f.path; }) };
      if (d.project_id) args.project_id = d.project_id;
      DK.call("offer_post", args).then(function (r) {
        DK.tellModel("In the Dandelion Kit card the person tapped Post with Dandelion for the exported files. The channel versions are on screen. Nothing has been sent.");
        DK.go("offer_post", r);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function fileRow(f) {
      return h("li", { class: "file" },
        h("span", { class: "fileico", "aria-hidden": "true" }, DK.glyph(ICON[f.kind] || "doc")),
        h("div", { class: "grow" },
          h("div", { class: "fname", text: DK.base(f.path) }),
          h("div", { class: "small muted num", text: (KIND[f.kind] || "File") + ", " + DK.bytes(f.bytes) })),
        DK.btn("Show", { kind: "quiet", small: true, icon: "folder", aria: "Show " + DK.base(f.path) + " in the folder", onclick: function () { open(f.path, "Show"); } }));
    }

    function render() {
      body.textContent = "";
      body.appendChild(h("div", { class: "row wrap" }, DK.pill(DK.plural(files.length, "file"), "ok", "check"), h("span", { class: "small muted num", text: DK.bytes(total) + " in all" })));
      body.appendChild(h("p", { class: "small muted mt-s", text: "Saved to this folder on your computer:" }));
      body.appendChild(h("div", { class: "code", text: d.dir || "" }));
      var ul = h("ul", { class: "mt" });
      files.forEach(function (f) { ul.appendChild(fileRow(f)); });
      body.appendChild(ul);
      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      var actions = h("div", { class: "actions" });
      if (media.length) actions.appendChild(DK.btn("Post with Dandelion", { kind: "gold", icon: "send", disabled: !!st.busy, onclick: post }));
      actions.appendChild(DK.btn("Open folder", { icon: "folder", disabled: !!st.busy, onclick: function () { open(d.dir, "Open folder"); } }));
      body.appendChild(actions);
      body.appendChild(h("p", { class: "tiny muted mt-s", text: "summary.md lists every file in plain words. source-map.json ties each file to the plan that made it." }));
    }

    render();
    return [
      DK.head("Exported", { sub: "Your files are ready." }),
      h("section", { class: "card" }, body)
    ];
  }

  DK.view("kit-export", { tools: ["export"], build: build });
})();
