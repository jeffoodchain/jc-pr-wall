const ICONS = {
  // Drawn on a 16x16 grid with strokes; see .ic in style.css.
  open: '<circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><path d="M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H8M9.5 3 8 4.5 9.5 6"/>',
  merged: '<circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="8" r="1.75"/><path d="M4 5.25v5.5M4 5.25c0 2 2 2.75 4 2.75h2.25"/>',
  closed: '<circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><path d="M4 5.25v5.5M12 10.75V8M10.5 2.5l3 3M13.5 2.5l-3 3"/>',
  draft: '<circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><path d="M4 5.25v5.5M12 9v.01M12 6.5v.01M12 4v.01"/>',
  star: '<path d="M8 1.75l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62z"/>',
};

const LABEL = { merged: 'Merged', open: 'Open', closed: 'Closed', draft: 'Draft' };

const LANG_COLORS = {
  Go: '#00add8', Rust: '#dea584', TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572a5',
  Zig: '#ec915c', Solidity: '#aa6746', 'C++': '#f34b7d', C: '#555555', Cuda: '#3a4e3a', Swift: '#f05138',
  Kotlin: '#a97bff', Java: '#b07219', Circom: '#707575', Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c',
  Ruby: '#701516', Nix: '#7e7eff', 'Jupyter Notebook': '#da5b0b', Noir: '#2f1f49', Cairo: '#ff4a48',
};

const FILTERS = ['merged', 'open', 'closed'];
const PREVIEW = 5;

const $ = (sel) => document.querySelector(sel);

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever used with the static ICONS above
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

function statusIcon(state) {
  const el = icon(state, `s-${state}`);
  el.setAttribute('role', 'img');
  el.removeAttribute('aria-hidden');
  el.setAttribute('aria-label', LABEL[state]);
  return el;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const filterKey = (pr) => (pr.state === 'draft' ? 'open' : pr.state);
const prDate = (pr) => pr.mergedAt ?? pr.closedAt ?? pr.createdAt;

function img(src, alt = '') {
  return h('img', { src, alt, loading: 'lazy', decoding: 'async', onerror: (e) => (e.target.style.visibility = 'hidden') });
}

/* ---------- state (kept in the URL hash so views can be shared) ---------- */

const state = { view: 'repos', show: new Set(['merged', 'open']), q: '' };

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('view') === 'timeline') state.view = 'timeline';
  if (p.has('show')) state.show = new Set(p.get('show').split(',').filter((s) => FILTERS.includes(s)));
  state.q = p.get('q') ?? '';
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== 'repos') p.set('view', state.view);
  const show = FILTERS.filter((s) => state.show.has(s)).join(',');
  if (show !== 'merged,open') p.set('show', show);
  if (state.q) p.set('q', state.q);
  const s = p.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
}

/* ---------- rendering ---------- */

function renderHero(data) {
  const { user, stats } = data;
  const name = user.name || user.login;
  document.title = `${name} · PR Wall`;
  $('#me-avatar').src = user.avatarUrl;
  $('#me-name').replaceChildren(h('a', { href: user.url }, name));
  $('#tagline').textContent = data.tagline || 'Pull requests to open-source projects.';

  const stat = (label, value, cls) =>
    h('div', {}, h('dt', {}, label), h('dd', { class: cls }, value));
  $('#stats').replaceChildren(
    stat('Merged PRs', String(stats.merged), 'merged'),
    stat('Repositories', String(stats.repos)),
    stat('Organizations', String(stats.owners)),
    stat('Stars of merged-into repos', compact.format(stats.stars)),
  );

  renderActivity(data.prs);
}

function renderActivity(prs) {
  const box = $('#activity');
  if (!prs.length) return box.remove();
  const key = (iso) => iso.slice(0, 7);
  const counts = new Map();
  for (const pr of prs) counts.set(key(pr.createdAt), (counts.get(key(pr.createdAt)) ?? 0) + 1);

  const first = new Date(prs.at(-1).createdAt);
  const now = new Date();
  const months = [];
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); ; m++) {
    if (m === 12) { m = 0; y++; }
    const k = `${y}-${String(m + 1).padStart(2, '0')}`;
    months.push(k);
    if (y > now.getUTCFullYear() || (y === now.getUTCFullYear() && m >= now.getUTCMonth())) break;
  }
  const max = Math.max(...counts.values());
  box.replaceChildren(
    ...months.map((k) => {
      const n = counts.get(k) ?? 0;
      const label = `${monthFmt.format(new Date(`${k}-01T00:00:00Z`))}: ${n} PR${n === 1 ? '' : 's'} opened`;
      return h('span', { class: n ? 'hot' : null, style: `height:${n ? Math.max(12, (n / max) * 100) : 5}%`, title: label });
    }),
  );
  box.after(h('div', { class: 'activity-axis', 'aria-hidden': 'true' }, h('span', {}, months[0]), h('span', {}, months.at(-1))));
}

function renderControls(data) {
  for (const btn of document.querySelectorAll('.seg button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.view === state.view));
    btn.onclick = () => { state.view = btn.dataset.view; update(data); };
  }

  const counts = { merged: 0, open: 0, closed: 0 };
  for (const pr of data.prs) counts[filterKey(pr)]++;
  $('#chips').replaceChildren(
    ...FILTERS.map((s) =>
      h('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(state.show.has(s)),
        onclick: () => { state.show.has(s) ? state.show.delete(s) : state.show.add(s); update(data); },
      }, icon(s, `s-${s}`), LABEL[s], h('span', { class: 'n' }, String(counts[s]))),
    ),
  );

  const q = $('#q');
  q.value = state.q;
  q.oninput = () => { state.q = q.value; update(data, { keepControls: true }); };
}

function visiblePrs(data) {
  const q = state.q.trim().toLowerCase();
  return data.prs
    .filter((pr) => state.show.has(filterKey(pr)) && (!q || pr.title.toLowerCase().includes(q) || pr.repo.toLowerCase().includes(q)))
    .sort((a, b) => prDate(b).localeCompare(prDate(a)));
}

function prRow(pr) {
  return h('li', {},
    statusIcon(pr.state),
    h('a', { href: pr.url, title: `#${pr.number}` }, pr.title),
    h('time', { class: 'pr-when', datetime: prDate(pr) }, shortDate.format(new Date(prDate(pr)))),
  );
}

function repoCard(repo, prs) {
  const list = h('ul', { class: 'pr-list' }, prs.slice(0, PREVIEW).map(prRow));
  const merged = prs.filter((p) => p.state === 'merged').length;
  const rest = prs.length - PREVIEW;
  const more = rest > 0 &&
    h('button', {
      type: 'button',
      class: 'more',
      onclick: (e) => { list.append(...prs.slice(PREVIEW).map(prRow)); e.target.remove(); },
    }, `Show ${rest} more`);

  return h('article', { class: 'repo' },
    h('div', { class: 'repo-head' },
      img(repo.avatarUrl),
      h('div', {},
        h('a', { class: 'repo-name', href: repo.url }, h('span', { class: 'owner' }, `${repo.owner}/`), repo.name),
        repo.description && h('p', { class: 'repo-desc' }, repo.description),
      ),
    ),
    h('div', { class: 'repo-meta' },
      h('span', { title: `${repo.stars} stars` }, icon('star'), h('span', { class: 'num' }, compact.format(repo.stars))),
      repo.language && h('span', {},
        h('i', { class: 'lang-dot', style: `background:${LANG_COLORS[repo.language] ?? 'var(--faint)'}` }), repo.language),
      h('span', {}, merged ? `${merged} merged` : `${prs.length} PR${prs.length === 1 ? '' : 's'}`),
    ),
    list,
    more,
  );
}

function renderRepos(data, prs) {
  const byRepo = groupBy(prs, (p) => p.repo);
  const cards = data.repos.filter((r) => byRepo.has(r.fullName)).map((r) => repoCard(r, byRepo.get(r.fullName)));
  return h('div', { class: 'grid' }, cards);
}

function renderTimeline(data, prs) {
  const repos = new Map(data.repos.map((r) => [r.fullName, r]));
  const byMonth = groupBy(prs, (p) => prDate(p).slice(0, 7));
  return [...byMonth].map(([month, items]) =>
    h('section', { class: 'month' },
      h('h2', {}, monthFmt.format(new Date(`${month}-01T00:00:00Z`))),
      h('ul', { class: 'rows' },
        items.map((pr) =>
          h('li', {},
            statusIcon(pr.state),
            img(repos.get(pr.repo)?.avatarUrl ?? ''),
            h('div', { class: 'title' },
              h('a', { href: pr.url }, pr.title),
              h('small', {}, `${pr.repo} #${pr.number}`),
            ),
            h('time', { class: 'pr-when', datetime: prDate(pr) }, shortDate.format(new Date(prDate(pr)))),
          ),
        ),
      ),
    ),
  );
}

function update(data, { keepControls = false } = {}) {
  writeHash();
  if (!keepControls) renderControls(data);
  const prs = visiblePrs(data);
  const wall = $('#wall');
  if (!prs.length) {
    wall.replaceChildren(h('p', { class: 'empty' }, 'No pull requests match these filters.'));
    return;
  }
  wall.replaceChildren(...[state.view === 'timeline' ? renderTimeline(data, prs) : renderRepos(data, prs)].flat());
}

async function main() {
  readHash();
  let data;
  try {
    const res = await fetch('data/prs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch (err) {
    $('#wall').replaceChildren(h('p', { class: 'empty' }, `Couldn't load data/prs.json (${err.message}).`));
    return;
  }
  renderHero(data);
  update(data);
  $('#foot').replaceChildren(
    `Updated ${shortDate.format(new Date(data.generatedAt))} from the GitHub API. `,
    h('a', { href: data.user.url }, `@${data.user.login}`),
  );
}

main();
