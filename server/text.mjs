// Plain text versions of every tool result, for hosts that do not draw cards (Claude Code CLI, Codex CLI) and as the
// readable half of every result in hosts that do. The text is written from the same data the cards read (structuredContent),
// so it always matches the card. It lists exact file paths and says what to do next.
// No stack traces, no dashes used as punctuation, no hype.

/** @typedef {Record<string, any>} Data */

const CHANNEL_NAMES = /** @type {Record<string, string>} */ ({
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X',
  threads: 'Threads',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
});

/** @param {string} id */
export const channelName = (id) => CHANNEL_NAMES[id] ?? id;

/** Minutes and seconds: 113000 becomes "1:53". @param {number} ms */
export function clock(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Seconds with one decimal: 380 becomes "0.4 s". @param {number} ms */
export function secs(ms) {
  return `${((Number(ms) || 0) / 1000).toFixed(1)} s`;
}

/** @param {number} bytes */
export function sizeText(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} bytes`;
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A markdown table. @param {string[]} head @param {string[][]} rows */
function table(head, rows) {
  const esc = (/** @type {any} */ v) => String(v ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

/** Cap a long list of lines. @param {string[]} lines @param {number} max */
function capped(lines, max) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `...and ${lines.length - max} more.`];
}

// ---------------------------------------------------------------------------
// Kit check and project
// ---------------------------------------------------------------------------

/** @param {Data} d */
function textDoctor(d) {
  const r = d.doctor ?? {};
  const ff = r.ffmpeg ?? {};
  const lines = [r.ok ? 'The kit is ready to edit video.' : 'The kit needs a little setup before it can edit video.', ''];
  lines.push(
    ff.found
      ? `ffmpeg: found, version ${ff.version ?? 'unknown'} at ${ff.path ?? 'unknown path'}. Captions ${ff.has_ass ? 'yes' : 'MISSING'}, loudness ${ff.has_loudnorm ? 'yes' : 'MISSING'}, speech filter ${ff.has_whisper ? 'yes' : 'no (optional)'}.`
      : `ffmpeg: not found on this computer.${ff.install_hint ? ` Install it with: ${ff.install_hint}` : ''}`,
  );
  lines.push(`Node: ${r.node?.version ?? 'unknown'} (${r.node?.ok ? 'ok' : 'too old, Node 20 or newer is needed'})`);
  lines.push(`Disk: ${sizeText(r.disk?.free_bytes)} free (${r.disk?.ok ? 'ok' : 'reels need at least 3 GB'})`);
  lines.push(`Speech model: ${r.models?.whisper ? 'ready' : 'downloads on first use (about 80 MB)'}. Face model: ${r.models?.yunet ? 'ready' : 'downloads on first use'}.`);
  lines.push(`Kit folder: ${r.home ?? 'unknown'}`);
  const dl = r.dandelion ?? {};
  lines.push(
    dl.connected
      ? `Dandelion: signed in${dl.workspace?.name ? ` as ${dl.workspace.name}` : ''}${dl.plan ? ` (${dl.plan} plan)` : ''}.`
      : 'Dandelion: not signed in. That is fine; you only need it to post.',
  );
  const steps = Array.isArray(r.next_steps) ? r.next_steps : [];
  if (steps.length) lines.push('', 'What to do next:', ...steps.map((s, i) => `${i + 1}. ${s}`));
  return lines.join('\n');
}

/** @param {Data} d */
function textProject(d) {
  if (d.mode === 'status' || (d.doctor && !d.project)) return textDoctor(d);
  const p = d.project ?? {};
  const lines = [`Project "${p.title}" (${p.id})`];
  lines.push(
    `Video: ${p.source_name ?? 'unknown'}, ${clock(p.duration_ms)}, ${p.width} by ${p.height}, ${Math.round(p.fps || 0)} fps`,
  );
  if (p.transcript_ready) {
    lines.push(`Words: ready, ${p.word_count} words${p.language ? ` in ${p.language}` : ''}${p.face_found === true ? ', face found' : p.face_found === false ? ', no face found' : ''}.`);
  } else if (p.transcript_error) {
    lines.push(`Words: could not be read. ${p.transcript_error}`);
  } else {
    const pct = p.transcribing ? ` (${Math.round((p.transcribing.fraction || 0) * 100)}%)` : '';
    lines.push(`Words: still being read from the sound${pct}. rough_cut waits for them, or call get_project to check.`);
  }
  const mark = (/** @type {any} */ v) => (v ? '[x]' : '[ ]');
  lines.push(
    '',
    `${mark(p.transcript_ready)} Transcript`,
    `${mark(p.cut_applied)} Rough cut${p.cut_before_ms ? ` (${clock(p.cut_before_ms)} to ${clock(p.cut_after_ms)})` : ''}`,
    `${mark(p.look_id)} Look${p.look_id ? `: ${p.look_name ?? p.look_id}` : ''}`,
    `${mark(p.has_shot_plan)} Shot plan`,
    `${mark(p.has_draft)} Draft preview`,
    `${mark(p.has_final)} Final reel`,
  );
  if (d.next) lines.push('', `Next: ${d.next}${d.next === 'render_reel' ? (p.has_draft ? ' with quality final' : ' with quality draft') : ''}.`);
  return lines.join('\n');
}

/** @param {Data} d */
function textProjects(d) {
  const list = Array.isArray(d.projects) ? d.projects : [];
  if (!list.length) return 'No projects yet. Give me a video path (open_video) or tell me what carousel to make.';
  const rows = list.map((p) => [
    p.id,
    p.type,
    p.title,
    p.duration_ms ? clock(p.duration_ms) : p.slides ? plural(p.slides, 'slide') : '',
    p.type === 'carousel' ? 'rendered' : p.has_final ? 'final done' : p.look_name ? `look ${p.look_name}` : p.transcript_ready ? 'words ready' : 'started',
  ]);
  return [`${plural(list.length, 'project')}, newest first:`, '', table(['id', 'type', 'title', 'length', 'state'], rows)].join('\n');
}

// ---------------------------------------------------------------------------
// Cut, looks, shot plan
// ---------------------------------------------------------------------------

/** @param {Data} d */
function textCut(d) {
  const removed = Array.isArray(d.removed) ? d.removed : [];
  const out = removed.filter((r) => !r.keep);
  const saved = Math.max(0, (d.before_ms || 0) - (d.after_ms || 0));
  const lines = [
    `Rough cut (${d.preset}): ${clock(d.before_ms)} down to ${clock(d.after_ms)}, ${secs(saved)} saved. ${plural(out.length, 'piece')} come${out.length === 1 ? 's' : ''} out, ${removed.length - out.length} kept.`,
    'Nothing is rendered yet.',
    '',
  ];
  if (removed.length) {
    const rows = removed.slice(0, 60).map((r) => [
      r.id,
      r.kind,
      `${clock(r.src_start_ms)} (${secs(r.src_end_ms - r.src_start_ms)})`,
      r.text ? `"${r.text}"` : 'a pause',
      r.keep ? 'kept' : 'comes out',
    ]);
    lines.push(table(['id', 'kind', 'at', 'words', 'result'], rows));
    if (removed.length > 60) lines.push(`...and ${removed.length - 60} more.`);
  } else {
    lines.push('Nothing needed cutting.');
  }
  lines.push('', 'To keep a piece, call update_cut with its id in keep_ids. Next: pick_look.');
  return lines.join('\n');
}

/** @param {Data} d */
function textLooks(d) {
  const cur = d.current ?? {};
  const looks = Array.isArray(d.looks) ? d.looks : [];
  const lines = [`Five looks. Current: ${cur.look_id} (${cur.caption_theme} captions, accent ${cur.accent}).`, ''];
  for (const l of looks) {
    const here = l.id === cur.look_id ? ' [current]' : '';
    lines.push(
      `- ${l.id} (${l.name})${here}: ${l.summary} Captions ${l.caption_theme}, camera ${l.camera_aggression}, a change every ${(l.cut_every_ms_min / 1000).toFixed(1)} to ${(l.cut_every_ms_max / 1000).toFixed(1)} s, about ${l.sfx_per_minute} sound effects a minute, accent ${l.accent}.`,
    );
  }
  lines.push('', 'Caption styles: karaoke-highlight, karaoke-pill, one-word-pop, bold-stroke, clean-minimal, editorial-serif, box-caption, mono-terminal.');
  lines.push('To choose, call pick_look with look (and optionally caption_theme and accent). Next: plan_shots.');
  return lines.join('\n');
}

/** @param {Data} d */
function textShotPlan(d) {
  const hook = d.hook ?? {};
  const good = Number(hook.score) >= 70;
  const lines = [
    `Shot plan for ${d.look_name ?? d.look_id} (${d.caption_theme} captions, accent ${d.accent}), ${clock(d.duration_ms)} long.`,
    `Hook (${Math.round(hook.score || 0)} out of 100, ${good ? 'good' : 'weak, think about another'}): "${hook.text}"`,
  ];
  const others = (hook.candidates ?? []).filter((/** @type {any} */ c) => c.text !== hook.text).slice(0, 4);
  if (others.length) {
    lines.push('Other hooks:', ...others.map((/** @type {any} */ c) => `- "${c.text}" (${Math.round(c.score)})`));
  }
  lines.push('', 'Beats:');
  const beats = Array.isArray(d.beats) ? d.beats : [];
  const rows = beats.map((/** @type {any} */ b, /** @type {number} */ i) => {
    const shown = b.wanted_treatment && b.rendered_as ? `${b.treatment} (wanted ${b.wanted_treatment}, drawn as ${b.rendered_as})` : b.treatment;
    return `${i + 1}. [${b.id}] ${clock(b.out_start_ms)} to ${clock(b.out_end_ms)}, ${b.kind}, ${shown}: "${b.text}"${b.screen_text ? ` On screen: "${b.screen_text}"` : ''}`;
  });
  lines.push(...capped(rows, 80));
  const s = d.stats ?? {};
  lines.push('', `${plural(s.captions ?? 0, 'caption cue')}, ${plural(s.camera ?? 0, 'camera move')}, ${plural(s.sfx ?? 0, 'sound cue')}.`);
  lines.push('Show the person the hook and beats and get a yes. To change one, call update_shot_plan. Next: render_reel with quality draft.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Preview, carousel, export
// ---------------------------------------------------------------------------

/** @param {Data[]} checks */
function checksTable(checks) {
  const rows = checks.map((c) => [c.label ?? c.id, c.status, c.measured === null || c.measured === undefined ? '' : String(c.measured), c.limit === null || c.limit === undefined ? '' : String(c.limit)]);
  const fixes = checks.filter((c) => c.status !== 'pass' && c.fix).map((c) => `- ${c.label ?? c.id}: ${c.fix}`);
  return [table(['check', 'result', 'measured', 'limit'], rows), ...(fixes.length ? ['', 'What to change:', ...fixes] : [])].join('\n');
}

/** @param {Data[]} checks */
function checkCounts(checks) {
  const n = (/** @type {string} */ s) => checks.filter((c) => c.status === s).length;
  return `${n('pass')} pass, ${n('warn')} warn, ${n('stop')} stop`;
}

/** @param {Data} d */
function textPreview(d) {
  const renders = Array.isArray(d.renders) ? d.renders : [];
  const active = renders.find((r) => r.id === d.active) ?? renders[renders.length - 1];
  if (!active) return 'There is no render yet.';
  const checks = Array.isArray(active.checks) ? active.checks : [];
  const stops = checks.filter((c) => c.status === 'stop').length;
  const lines = [
    `${active.label} is ready${active.stale ? ' (the shot plan changed since, so this one is out of date)' : ''}: ${active.file}`,
    `Length ${clock(active.duration_ms)}, ${sizeText(active.bytes)}${active.quality === 'draft' ? ', small preview size' : ', 1080 by 1920'}.`,
  ];
  if (active.axes) {
    lines.push(`This variant: hook "${active.axes.hook_text}", opens ${active.axes.opening === 'cold-open' ? 'straight in' : 'with the hook card'}, ${active.axes.caption_theme} captions, ${active.axes.pace} pace.`);
  }
  if (renders.length > 1) {
    lines.push('', 'All renders:');
    for (const r of renders) lines.push(`- ${r.label}: ${r.file} (${clock(r.duration_ms)}, ${sizeText(r.bytes)}; checks: ${checkCounts(r.checks ?? [])})`);
  }
  lines.push('', `Checks (${checkCounts(checks)}):`, checks.length ? checksTable(checks) : 'No checks have run on this file yet. Call check_reel.');
  lines.push('');
  if (stops) lines.push('One or more checks say stop. Fix those before posting, then build again.');
  if (active.quality === 'draft') lines.push('Look at the draft file. If the person says yes, next: render_reel with quality final.');
  else if (!active.axes) lines.push('Optional: make_variants for different hooks and openings. Next: export, then offer_post to post it.');
  else lines.push('Next: export, then offer_post for the version the person likes best.');
  return lines.join('\n');
}

/** @param {Data} d */
function textCarousel(d) {
  const slides = Array.isArray(d.slides) ? d.slides : [];
  const lines = [
    `${slides.length === 1 ? 'Image' : `Carousel "${d.title}"`}: ${plural(slides.length, 'JPEG slide')}, ${d.width} by ${d.height} (${d.size}). Project ${d.project_id}.`,
    '',
    ...slides.map((s, i) => `${i + 1}. ${s.layout}: ${s.file}`),
  ];
  if (Array.isArray(d.warnings) && d.warnings.length) lines.push('', 'Notes:', ...d.warnings.map((/** @type {string} */ w) => `- ${w}`));
  lines.push('', 'To change a slide, call update_slides with all the slides. Next: offer_post so the person can post it.');
  return lines.join('\n');
}

/** @param {Data} d */
function textExport(d) {
  const files = Array.isArray(d.files) ? d.files : [];
  const lines = [`Exported ${plural(files.length, 'file')} to ${d.dir}`, '', ...files.map((f) => `- ${f.path} (${sizeText(f.bytes)}, ${f.kind})`)];
  lines.push('', `Summary: ${d.summary_path}`, 'To show the folder, call open_path with the folder. Next: offer_post to post it.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Post offer and Dandelion
// ---------------------------------------------------------------------------

/** @param {Data} copy */
function copyLines(copy) {
  const out = [];
  if (copy.title) out.push(`Title: ${copy.title}`);
  if (copy.caption) out.push(`Caption: ${copy.caption}`);
  if (copy.description) out.push(`Description: ${copy.description}`);
  if (copy.hashtags?.length) out.push(`Hashtags: ${copy.hashtags.join(' ')}`);
  return out.length ? out : ['(no words yet)'];
}

/** The length of the main text field and its limit. @param {Data} entry */
function meter(entry) {
  const c = entry.copy ?? {};
  const l = entry.limits ?? {};
  const parts = [];
  const count = (/** @type {string|undefined} */ t) => [...(t ?? '')].length;
  if (c.caption !== undefined && l.caption_max) parts.push(`caption ${count(c.caption)} of ${l.caption_max}`);
  if (c.title !== undefined && l.title_max) parts.push(`title ${count(c.title)} of ${l.title_max}`);
  if (c.description !== undefined && l.description_max) parts.push(`description ${count(c.description)} of ${l.description_max}`);
  if (l.hashtags_max !== undefined) parts.push(`${plural((c.hashtags ?? []).length, 'hashtag')} of ${l.hashtags_max}`);
  return parts.join(', ');
}

/** @param {Data} dl */
function textDandelion(dl) {
  if (!dl || !dl.connected) {
    return 'Dandelion is not signed in. The versions above work without it. To post them, say "connect Dandelion": it is free and the sign-in happens in your browser (call connect_dandelion). You can also sign up at https://dandelionapp.io/go/kit';
  }
  const lines = [`Dandelion: signed in${dl.workspace?.name ? ` as ${dl.workspace.name}` : ''}${dl.plan ? `, ${dl.plan} plan` : ''}${dl.usage ? `, ${dl.usage.used} of ${dl.usage.limit} AI actions used this month` : ''}.`];
  const brands = Array.isArray(dl.brands) ? dl.brands : [];
  if (brands.length) lines.push(`Brands: ${brands.map((/** @type {Data} */ b) => `${b.name} (${b.id})`).join(', ')}`);
  const channels = Array.isArray(dl.channels) ? dl.channels : [];
  if (channels.length) {
    lines.push('Connected apps:', ...channels.map((/** @type {Data} */ c) => `- ${channelName(c.platform)} @${String(c.handle).replace(/^@/, '')}${c.can_post ? '' : ' (cannot post yet, reconnect it)'}`));
  } else {
    lines.push('No social app is connected to the brand yet.');
    const links = Array.isArray(dl.connect_links) ? dl.connect_links : [];
    if (links.length) lines.push('Connect one:', ...links.map((/** @type {Data} */ l) => `- ${channelName(l.platform)}: ${l.url}`));
  }
  return lines.join('\n');
}

/** @param {Data} sent */
function textSent(sent) {
  const jobs = Array.isArray(sent.jobs) ? sent.jobs : [];
  if (!jobs.length) {
    return sent.mode === 'review'
      ? `Sent to Dandelion (content ${sent.content_id}). No post was created because no connected app can post yet. The files are in the library. Nothing went out.`
      : `Saved to the Dandelion library (content ${sent.content_id}). Nothing went out.`;
  }
  const lines = [`Sent to Dandelion (content ${sent.content_id}). ${plural(jobs.length, 'post')} waiting. Nothing has gone out yet.`, ''];
  for (const j of jobs) {
    lines.push(`- ${channelName(j.platform)} @${String(j.handle).replace(/^@/, '')} [${j.id}]: ${j.status}${j.post_at ? ` for ${j.post_at}` : ''}`);
    for (const c of j.checks ?? []) lines.push(`    fix first: ${c}`);
  }
  lines.push('', 'Only approve with approve_post after the person says yes to that post. skip_post drops one.');
  return lines.join('\n');
}

/** @param {Data} d */
function textPost(d) {
  if (d.bundle) {
    const b = d.bundle;
    const kinds = /** @type {Record<string, string>} */ ({ text: 'text post', image: 'image post', carousel: 'carousel post', video: 'video post', thread: 'thread' });
    const lines = [`Post ${b.id}: ${kinds[b.kind] ?? b.kind}${b.files?.length ? `, ${plural(b.files.length, 'file')}` : ''}.`];
    for (const f of b.files ?? []) lines.push(`  File: ${f}`);
    if (b.rules_source === 'snapshot') lines.push('Limits come from the saved copy of Dandelion\'s rules.');
    lines.push('');
    for (const [id, entry] of Object.entries(b.channels ?? {})) {
      const e = /** @type {Data} */ (entry);
      lines.push(`${channelName(id)}${e.format ? ` (${e.format})` : ''}: ${meter(e)}`);
      for (const l of copyLines(e.copy ?? {})) lines.push(`  ${l.replace(/\n/g, '\n  ')}`);
      for (const w of e.warnings ?? []) lines.push(`  ! ${w}`);
    }
    lines.push('');
    if (b.sent) lines.push(textSent(b.sent), '');
    lines.push(textDandelion(d.dandelion));
    if (!b.sent) lines.push('', 'Change any version with set_channel_copy or by calling offer_post again with copies. Never post without a clear yes from the person.');
    return lines.join('\n');
  }
  if (d.channel && d.copy) {
    const lines = [`Saved the ${channelName(d.channel)} version.`, ...copyLines(d.copy).map((l) => `  ${l}`)];
    for (const w of d.warnings ?? []) lines.push(`  ! ${w}`);
    return lines.join('\n');
  }
  if (d.sent) return textSent(d.sent);
  if (d.dandelion) {
    const lines = [textDandelion(d.dandelion)];
    if (d.connect_url) lines.push(`If the browser did not open, go to: ${d.connect_url}`);
    return lines.join('\n');
  }
  return 'Done.';
}

/** @param {Data} d */
function textJob(d) {
  const j = d.job ?? {};
  if (j.status === 'skipped') return `Skipped post ${j.id}. It will not go out. The files stay in the library.`;
  if (j.status === 'scheduled') return `Post ${j.id} is scheduled for ${j.post_at}.`;
  if (j.status === 'posted') return `Post ${j.id} is posted.`;
  if (j.status === 'posting') return `Post ${j.id} is going out now.`;
  return `Post ${j.id}: ${j.status}.`;
}

/** @type {Record<string, (d: Data) => string>} */
const RENDERERS = {
  doctor: textDoctor,
  open_video: (d) => (d.reused ? 'Opened again. The earlier work on this video is still here.\n' : '') + textProject(d),
  get_project: textProject,
  list_projects: textProjects,
  rough_cut: textCut,
  update_cut: textCut,
  pick_look: textLooks,
  plan_shots: textShotPlan,
  update_shot_plan: textShotPlan,
  render_reel: textPreview,
  check_reel: textPreview,
  make_variants: textPreview,
  make_carousel: textCarousel,
  make_image: textCarousel,
  update_slides: textCarousel,
  export: textExport,
  offer_post: textPost,
  set_channel_copy: textPost,
  connect_dandelion: textPost,
  dandelion_status: textPost,
  send_to_dandelion: textPost,
  approve_post: textJob,
  skip_post: textJob,
  open_path: (d) => `Showing ${d.path ?? 'the folder'} in the file manager.`,
  read_asset: (d) => `${d.mime ?? 'file'}, ${d.total ?? 0} bytes.`,
};

/**
 * The text for a tool result.
 * @param {string} tool
 * @param {Data} data
 * @returns {string}
 */
export function renderText(tool, data) {
  const fn = RENDERERS[tool];
  if (!fn) return 'Done.';
  const text = fn(data ?? {});
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}
