// Card script for "kit-project": where a video project stands, and the next step to take.
// Shown by open_video, get_project and doctor. Plain ES2017, no template strings, text-only DOM.
(function () {
  var DK = window.DK, h = DK.h;

  function stepRow(s) {
    var mark = h("span", { class: "stepmark " + s.state }, s.state === "done" ? DK.glyph("check") : s.state === "now" ? String(s.n) : String(s.n));
    var main = h("div", { class: "grow" },
      h("div", { class: "strong", text: s.title }),
      s.detail ? h("div", { class: "small muted", text: s.detail }) : null);
    return h("li", null, mark, main, s.action || null);
  }

  function statusRow(ok, title, detail, soft) {
    var kind = ok ? "ok" : soft ? "warn" : "bad";
    return h("li", null,
      h("span", { class: "pill " + kind, "aria-label": ok ? "OK" : soft ? "Optional" : "Needs attention" }, DK.glyph(ok ? "check" : soft ? "alert" : "stop")),
      h("div", { class: "grow" },
        h("div", { class: "strong", text: title }),
        detail ? h("div", { class: "small muted", text: detail }) : null));
  }

  function buildDoctor(d) {
    var dr = d.doctor || {};
    var ff = dr.ffmpeg || {};
    var disk = dr.disk || {};
    var models = dr.models || {};
    var dl = dr.dandelion || {};
    var rows = h("ul", { class: "rows" });
    var ffDetail = ff.found
      ? "Version " + (ff.version || "unknown") + ". Captions " + (ff.has_ass ? "yes" : "missing") + ", loudness " + (ff.has_loudnorm ? "yes" : "missing") + "."
      : "Not found on this computer yet.";
    var ffLi = statusRow(!!ff.found && ff.has_ass !== false, "ffmpeg", ffDetail);
    if (!ff.found && ff.install_hint) {
      ffLi.lastChild.appendChild(h("p", { class: "small mt-s", text: "Install it with this command, then ask me to check again:" }));
      ffLi.lastChild.appendChild(h("div", { class: "code", text: ff.install_hint }));
    }
    rows.appendChild(ffLi);
    rows.appendChild(statusRow(!(dr.node && dr.node.ok === false), "Node", dr.node && dr.node.version ? "Version " + dr.node.version : "Running"));
    var gb = typeof disk.free_bytes === "number" ? (disk.free_bytes / 1073741824).toFixed(1) + " GB free" : "";
    rows.appendChild(statusRow(disk.ok !== false, "Disk space", gb ? gb + (disk.ok === false ? ". Reels need at least 3 GB." : "") : "Not checked"));
    rows.appendChild(statusRow(!!(models.whisper && models.yunet), "Speech and face models",
      (models.whisper ? "Speech model ready. " : "Speech model downloads on first use. ") + (models.yunet ? "Face model ready." : "Face model downloads on first use."), true));
    rows.appendChild(statusRow(!!dl.connected, "Dandelion",
      dl.connected ? "Signed in" + (dl.workspace && dl.workspace.name ? " as " + dl.workspace.name : "") + (dl.plan ? " (" + dl.plan + " plan)" : "") : "Not signed in. Optional: you only need it to post.", true));
    var steps = Array.isArray(dr.next_steps) ? dr.next_steps : [];
    var nodes = [
      DK.head("Kit check", { pill: DK.pill(dr.ok ? "Ready" : "Needs setup", dr.ok ? "ok" : "warn", dr.ok ? "check" : "alert") }),
      h("section", { class: "card" }, rows)
    ];
    if (steps.length) {
      nodes.push(h("section", { class: "card" },
        h("p", { class: "sec-title", text: "What to do next" }),
        h("ol", { class: "stack-s" }, steps.map(function (t, i) { return h("li", { class: "small", text: (i + 1) + ". " + t }); }))));
    }
    return nodes;
  }

  function build(d) {
    if (d.mode === "status" || (d.doctor && !d.project)) return buildDoctor(d);
    var p = d.project || {};
    var st = { busy: "", error: "" };
    var body = h("div");
    var pid = p.id;

    var steps = [
      { id: "transcript", title: "Transcript", done: !!p.transcript_ready,
        detail: p.transcript_ready ? DK.num(p.word_count || 0) + " words" + (p.face_found === true ? ", face found" : p.face_found === false ? ", no face found" : "") : "Listening to the audio. This can take a minute." },
      { id: "cut", title: "Rough cut", done: !!p.cut_applied, needs: "transcript",
        detail: p.cut_applied ? (p.cut_before_ms ? DK.clock(p.cut_before_ms) + " to " + DK.clock(p.cut_after_ms) : "Applied") : "Take out the ums, restarts and long pauses." },
      { id: "look", title: "Look", done: !!p.look_id, needs: "transcript",
        detail: p.look_id ? (p.look_name || p.look_id) : "Captions, pace, camera and sound." },
      { id: "plan", title: "Shot plan", done: !!p.has_shot_plan, needs: "transcript",
        detail: p.has_shot_plan ? "Ready to build" : "The hook, the beats and what shows on screen." },
      { id: "draft", title: "Draft preview", done: !!p.has_draft, needs: "plan",
        detail: p.has_draft ? "Built" : "A small, quick version to check." },
      { id: "final", title: "Final reel", done: !!p.has_final, needs: "draft",
        detail: p.has_final ? "Rendered and checked" : "1080 by 1920, ready to post." }
    ];
    var doneMap = {};
    steps.forEach(function (s) { doneMap[s.id] = s.done; });
    var nextId = null;
    steps.forEach(function (s) { if (!nextId && !s.done) nextId = s.id; });
    // the shot plan needs a look first
    if (nextId === "plan" && !doneMap.look) nextId = "look";

    var ACTIONS = {
      cut: { label: "Rough cut", icon: "scissors", run: function () { return DK.call("rough_cut", { project_id: pid }).then(function (r) { return { tool: "rough_cut", data: r }; }); }, busy: "Finding the cuts...", tell: "In the Dandelion Kit card the person tapped Rough cut. The cut review is on screen." },
      look: { label: "Pick a look", icon: "palette", run: function () { return DK.call("pick_look", { project_id: pid }).then(function (r) { return { tool: "pick_look", data: r }; }); }, busy: "Getting the looks...", tell: "In the Dandelion Kit card the person tapped Pick a look. The look picker is on screen." },
      plan: { label: "Plan shots", icon: "film", run: function () { return DK.call("plan_shots", { project_id: pid }).then(function (r) { return { tool: "plan_shots", data: r }; }); }, busy: "Planning the shots...", tell: "In the Dandelion Kit card the person tapped Plan shots. The shot plan is on screen." },
      draft: { label: "Build draft", icon: "play", run: function () { return DK.call("render_reel", { project_id: pid, quality: "draft" }).then(function (r) { return { tool: "render_reel", data: r }; }); }, busy: "Building the draft. This can take a minute...", tell: "In the Dandelion Kit card the person tapped Build draft. The draft preview is on screen.", tellPending: "In the Dandelion Kit card the person tapped Build draft. It is still being built, and a progress bar is on screen." },
      final: { label: "Render final", icon: "film", run: function () { return DK.call("render_reel", { project_id: pid, quality: "final" }).then(function (r) { return { tool: "render_reel", data: r }; }); }, busy: "Rendering the final reel. This can take a few minutes...", tell: "In the Dandelion Kit card the person tapped Render final. The finished reel and its checks are on screen.", tellPending: "In the Dandelion Kit card the person tapped Render final. It is still being built, and a progress bar is on screen." }
    };

    function go(id) {
      var a = ACTIONS[id];
      st.busy = a.busy; st.error = ""; render();
      a.run().then(function (res) {
        // A long build answers "still building": the preview card draws the progress bar and its Check again button.
        DK.tellModel(res.data && res.data.pending && a.tellPending ? a.tellPending : a.tell);
        DK.go(res.tool, res.data);
      }, function (e) { st.busy = ""; st.error = e.message; render(); });
    }

    function render() {
      body.textContent = "";
      var ready = !!p.transcript_ready;
      var list = h("ul", { class: "steps" });
      steps.forEach(function (s, i) {
        var state = s.done ? "done" : s.id === nextId ? "now" : "wait";
        var action = null;
        if (s.id === "transcript") {
          if (!s.done) action = DK.btn("Check again", { small: true, disabled: !!st.busy, onclick: function () {
            st.busy = "Checking..."; st.error = ""; render();
            DK.call("get_project", { project_id: pid }).then(function (r) { DK.go("get_project", r); }, function (e) { st.busy = ""; st.error = e.message; render(); });
          } });
        } else if (ACTIONS[s.id]) {
          var blocked = !ready || (s.id === "plan" && !doneMap.look) || (s.id === "draft" && !doneMap.plan) || (s.id === "final" && !doneMap.draft);
          if (s.id === "final" && s.done) action = null;
          else action = DK.btn(s.done ? "Redo" : ACTIONS[s.id].label, {
            kind: s.id === nextId && !s.done ? "gold" : s.done ? "quiet" : "", small: true, icon: s.done ? null : ACTIONS[s.id].icon,
            disabled: !!st.busy || blocked, aria: (s.done ? "Redo " : "") + ACTIONS[s.id].label,
            onclick: function () { go(s.id); }
          });
        }
        list.appendChild(stepRow({ n: i + 1, title: s.title, detail: s.detail, state: state, action: action }));
      });
      body.appendChild(list);
      if (d.rendering) {
        var what = d.rendering.tool === "make_variants" ? "the variants" : d.rendering.quality === "final" ? "the final reel" : "the draft";
        body.appendChild(h("div", { class: "mt" },
          h("p", { class: "small strong", text: "Building " + what + " now" }),
          DK.progress(d.rendering.progress, "Build progress"),
          h("div", { class: "actions" }, DK.btn("Check again", { small: true, kind: "gold", icon: "film", disabled: !!st.busy, onclick: function () {
            st.busy = "Checking..."; st.error = ""; render();
            DK.call("get_project", { project_id: pid }).then(function (r) {
              DK.tellModel("In the Dandelion Kit card the person tapped Check again while " + what + " was being built.");
              DK.go("get_project", r);
            }, function (e) { st.busy = ""; st.error = e.message; render(); });
          } }))));
      }
      if (st.busy) body.appendChild(DK.busy(st.busy));
      if (st.error) body.appendChild(DK.err(st.error));
      if (p.has_final) {
        body.appendChild(h("div", { class: "actions" },
          DK.btn("Export", { kind: "gold", icon: "folder", disabled: !!st.busy, onclick: function () {
            st.busy = "Copying the files..."; render();
            DK.call("export", { project_id: pid }).then(function (r) {
              DK.tellModel("In the Dandelion Kit card the person tapped Export. The files are listed on screen.");
              DK.go("export", r);
            }, function (e) { st.busy = ""; st.error = e.message; render(); });
          } })));
      }
    }

    var meta = [];
    if (p.duration_ms) meta.push(DK.clock(p.duration_ms));
    if (p.width && p.height) meta.push(p.width + " by " + p.height);
    if (p.fps) meta.push(Math.round(p.fps) + " fps");
    var top = h("div", { class: "row top" },
      p.poster_asset_id ? DK.img(p.poster_asset_id, { ratio: "9 / 16", width: "64px", alt: "A frame from the video" }) : null,
      h("div", { class: "grow" },
        h("div", { class: "strong", text: p.source_name || p.title || "Your video" }),
        h("div", { class: "small muted num", text: meta.join(", ") }),
        !p.transcript_ready ? h("div", { class: "mt-s" }, DK.pill("Listening", "gold", "mic")) : null));
    render();
    return [
      DK.head(p.title || "Video project", { sub: "Pick up where you left off." }),
      h("section", { class: "card" }, top, h("div", { class: "mt" }, body))
    ];
  }

  DK.view("kit-project", { tools: ["open_video", "get_project", "doctor"], build: build });
})();
