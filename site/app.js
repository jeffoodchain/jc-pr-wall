const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'merged', label: 'Merged' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];
const STATE_LABEL = { merged: 'merged', open: 'open', draft: 'draft', closed: 'closed' };
const REPO_PREVIEW = 8;
const DAY = 86_400_000;

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function img(src) {
  return h('img', { src: src || null, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => (e.target.style.visibility = 'hidden') });
}

const fmtShort = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtMonthShort = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtFull = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const statusOf = (pr) => (pr.state === 'draft' ? 'open' : pr.state);
const eventDate = (pr) => pr.mergedAt ?? pr.closedAt ?? pr.createdAt;
const monthKey = (iso) => iso.slice(0, 7);
const monthDate = (key) => new Date(`${key}-01T00:00:00Z`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- view state, kept in the URL hash ---------- */

const view = { status: 'all', repo: null, q: '' };

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = p.get('status');
  if (STATUSES.some((x) => x.key === s)) view.status = s;
  view.repo = p.get('repo');
  view.q = p.get('q') ?? '';
}

function writeHash() {
  const p = new URLSearchParams();
  if (view.status !== 'all') p.set('status', view.status);
  if (view.repo) p.set('repo', view.repo);
  if (view.q) p.set('q', view.q);
  const s = p.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
}

/* ---------- data ---------- */

let data;
let repoByName;
let all;

function prepare(raw) {
  data = raw;
  repoByName = new Map(data.repos.map((r) => [r.fullName, r]));
  all = [...data.prs].sort((a, b) => eventDate(b).localeCompare(eventDate(a)));
}

function matches(pr, { status = view.status, repo = view.repo, q = view.q } = {}) {
  if (status !== 'all' && statusOf(pr) !== status) return false;
  if (repo && pr.repo !== repo) return false;
  const needle = q.trim().toLowerCase();
  return !needle || pr.title.toLowerCase().includes(needle) || pr.repo.toLowerCase().includes(needle);
}

/* ---------- sidebar ---------- */

function renderProfile() {
  const { user } = data;
  const name = user.name || user.login;
  document.title = `${name} · PR Wall`;
  $('#me').href = user.url;
  $('#me-avatar').src = user.avatarUrl;
  $('#me-name').textContent = name;
  $('#me-login').textContent = `@${user.login}`;
  $('#tagline').textContent = data.tagline || 'Open-source contributions, newest first';
  $('#updated').replaceChildren(
    `Updated ${fmtFull.format(new Date(data.generatedAt))} from the `,
    h('a', { href: `https://github.com/pulls?q=${encodeURIComponent(`is:pr author:${user.login}`)}` }, 'GitHub API'),
  );
}

function marker(key) {
  if (key === 'all') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M8 1.5v13"/><circle cx="8" cy="4.5" r="2" fill="var(--side)"/><circle cx="8" cy="11.5" r="2" fill="var(--side)"/>';
    return svg;
  }
  return h('i', { class: `node ${key}`, 'aria-hidden': 'true' });
}

function renderStatus() {
  const counts = { all: 0, merged: 0, open: 0, closed: 0 };
  for (const pr of all) {
    if (!matches(pr, { status: 'all' })) continue;
    counts.all++;
    counts[statusOf(pr)]++;
  }
  $('#status').replaceChildren(
    ...STATUSES.map((s) =>
      h('button', {
        type: 'button',
        'aria-current': String(view.status === s.key),
        onclick: () => { view.status = s.key; update(); },
      }, marker(s.key), h('span', {}, s.label), h('span', { class: 'n' }, String(counts[s.key]))),
    ),
  );
}

let showAllRepos = false;

function renderRepos() {
  const counts = new Map();
  for (const pr of all) {
    if (!matches(pr, { repo: null })) continue;
    counts.set(pr.repo, (counts.get(pr.repo) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) =>
    b[1] - a[1] || (repoByName.get(b[0])?.stars ?? 0) - (repoByName.get(a[0])?.stars ?? 0));
  const max = ranked[0]?.[1] ?? 1;
  const selectedIdx = ranked.findIndex(([name]) => name === view.repo);
  const limit = showAllRepos ? ranked.length : Math.max(REPO_PREVIEW, selectedIdx + 1);

  $('#repo-count').textContent = String(ranked.length);
  $('#repos').replaceChildren(
    ...ranked.slice(0, limit).map(([name, n]) => {
      const repo = repoByName.get(name);
      const [owner, short] = name.split('/');
      return h('li', {},
        h('button', {
          type: 'button',
          class: 'repo-btn',
          'aria-pressed': String(view.repo === name),
          title: `${name} · ${plural(n, 'PR')}`,
          onclick: () => { view.repo = view.repo === name ? null : name; update(); },
        },
        img(repo?.avatarUrl),
        h('span', { class: 'name' }, `${owner}/`, h('b', {}, short)),
        h('span', { class: 'n' }, String(n)),
        h('span', { class: 'track' }, h('i', { style: `width:${(n / max) * 100}%` })),
        ),
      );
    }),
  );

  const more = $('#repos-more');
  more.hidden = ranked.length <= REPO_PREVIEW;
  more.textContent = showAllRepos ? 'Show fewer' : `Show all ${ranked.length}`;
  more.onclick = () => { showAllRepos = !showAllRepos; renderRepos(); };
}

/* ---------- stats ---------- */

function renderStats() {
  const ref = new Date(data.generatedAt).getTime();
  const merged = all.filter((p) => p.state === 'merged');
  const closed = all.filter((p) => p.state === 'closed').length;
  const inWindow = (from, to) => merged.filter((p) => {
    const t = new Date(p.mergedAt).getTime();
    return t > ref - to * DAY && t <= ref - from * DAY;
  }).length;
  const thisYear = inWindow(0, 365);
  const lastYear = inWindow(365, 730);
  const latest = [...merged].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))[0];
  const owners = new Set(data.repos.map((r) => r.owner.toLowerCase())).size;
  const rate = merged.length + closed ? Math.round((merged.length / (merged.length + closed)) * 100) : 0;

  const diff = thisYear - lastYear;
  const change = diff === 0 ? 'same as the year before' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} vs the year before`;

  const stat = (label, fig, sub, cls = '') =>
    h('div', {}, h('dt', {}, label), h('dd', {}, h('span', { class: `fig ${cls}` }, fig), h('span', { class: 'sub', title: sub }, sub)));

  $('#stats').replaceChildren(
    stat('Merged', String(merged.length), `${rate}% of finished PRs`, 'merged'),
    stat('Merged, last 12 months', String(thisYear), change),
    stat('Repositories', String(data.repos.length), `across ${plural(owners, 'organization')}`),
    latest
      ? stat('Latest merge', fmtShort.format(new Date(latest.mergedAt)), `${latest.repo} #${latest.number}`)
      : stat('Latest merge', '—', 'none yet'),
  );
  $('#total').textContent = String(all.length);
}

/* ---------- chart ---------- */

function renderChart() {
  const box = $('#chart');
  const prs = all.filter((p) => matches(p, { status: 'all' }));
  const ref = monthKey(data.generatedAt);
  const first = all.length ? monthKey(all.at(-1).createdAt) : ref;

  const months = [];
  for (let d = monthDate(first); monthKey(d.toISOString()) <= ref; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(monthKey(d.toISOString()));
  }
  const fit = Math.max(6, Math.floor((box.clientWidth - 28) / 10));
  const shown = months.slice(-fit);

  const tally = new Map(shown.map((m) => [m, { merged: 0, other: 0 }]));
  for (const pr of prs) {
    const t = tally.get(monthKey(eventDate(pr)));
    if (t) t[pr.state === 'merged' ? 'merged' : 'other']++;
  }
  const peak = Math.max(1, ...[...tally.values()].map((t) => t.merged + t.other));
  const top = peak <= 4 ? 4 : Math.ceil(peak / 4) * 4;

  const pct = (n) => `${(n / top) * 100}%`;
  const plot = h('div', { class: 'plot' },
    [top, top / 2, 0].map((v) => h('div', { class: 'grid-line', style: `top:${100 - (v / top) * 100}%` }, h('span', {}, String(v)))),
    h('div', { class: 'bars' },
      shown.map((m) => {
        const t = tally.get(m);
        const label = `${fmtMonthShort.format(monthDate(m))}: ${t.merged} merged, ${t.other} open or closed`;
        return h('div', { class: 'col', title: label, role: 'img', 'aria-label': label },
          t.merged ? h('i', { class: 'm', style: `height:${pct(t.merged)}` }) : null,
          t.other ? h('i', { class: 'o', style: `height:${pct(t.other)}` }) : null,
        );
      }),
    ),
  );

  const step = 100 / shown.length;
  const ticks = shown
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => m.endsWith('-01') || i === 0)
    .filter(({ m, i }, k, arr) => !(i === 0 && arr[1] && arr[1].i < 6));
  const axis = h('div', { class: 'xaxis', 'aria-hidden': 'true' },
    ticks.map(({ m, i }) => h('span', { style: `left:${i * step}%` }, m.endsWith('-01') ? m.slice(0, 4) : fmtMonthShort.format(monthDate(m)))),
  );
  box.replaceChildren(plot, axis);
}

/* ---------- log ---------- */

function row(pr) {
  const repo = repoByName.get(pr.repo);
  const status = statusOf(pr);
  const verb = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : 'opened';
  return h('li', { class: `row ${status}` },
    h('i', { class: `node ${pr.state}`, role: 'img', 'aria-label': STATE_LABEL[pr.state] }),
    img(repo?.avatarUrl),
    h('div', { class: 'what' },
      h('a', { href: pr.url }, pr.title),
      h('small', {}, h('b', {}, pr.repo), ` #${pr.number} · `, h('span', { class: `state ${status}` }, verb)),
    ),
    h('time', { class: 'when', datetime: eventDate(pr) }, fmtShort.format(new Date(eventDate(pr)))),
  );
}

function renderLog() {
  const prs = all.filter((p) => matches(p));
  const log = $('#log');
  if (!prs.length) {
    log.replaceChildren(h('p', { class: 'empty' }, 'No pull requests match'));
    return;
  }
  const months = new Map();
  for (const pr of prs) {
    const k = monthKey(eventDate(pr));
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(pr);
  }
  log.replaceChildren(
    ...[...months].map(([m, items]) => {
      const merged = items.filter((p) => p.state === 'merged').length;
      return h('section', { class: 'month' },
        h('div', { class: 'month-head' },
          h('h2', {}, fmtMonth.format(monthDate(m))),
          h('span', { class: 'n' }, merged ? `${merged} merged` : plural(items.length, 'PR')),
        ),
        h('ol', { class: 'rows' }, items.map(row)),
      );
    }),
  );
}

function renderFilter() {
  const box = $('#filter');
  box.hidden = !view.repo;
  if (!view.repo) return box.replaceChildren();
  box.replaceChildren(
    'Showing',
    h('button', { type: 'button', 'aria-label': `Clear filter ${view.repo}`, onclick: () => { view.repo = null; update(); } },
      view.repo, h('span', { 'aria-hidden': 'true' }, '×')),
  );
}

function update() {
  writeHash();
  renderStatus();
  renderRepos();
  renderChart();
  renderFilter();
  renderLog();
}

async function main() {
  readHash();
  try {
    const res = await fetch('data/prs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    prepare(await res.json());
  } catch (err) {
    $('#log').replaceChildren(h('p', { class: 'empty' }, `Couldn't load data/prs.json (${err.message})`));
    return;
  }
  if (view.repo && !repoByName.has(view.repo)) view.repo = null;
  renderProfile();
  renderStats();
  $('#q').value = view.q;
  $('#q').addEventListener('input', (e) => { view.q = e.target.value; update(); });
  update();
  $('#log').classList.add('enter');
  if (matchMedia('(max-width: 860px)').matches && !view.repo) $('#repos-box').open = false;

  let width = $('#chart').clientWidth;
  new ResizeObserver(() => {
    const w = $('#chart').clientWidth;
    if (w !== width) { width = w; renderChart(); }
  }).observe($('#chart'));
}

main();
