// Pure transforms from GitHub search results to the data file the site reads.

export function prState(item) {
  if (item.pull_request?.merged_at) return 'merged';
  if (item.state === 'open') return item.draft ? 'draft' : 'open';
  return 'closed';
}

export function repoFromUrl(url) {
  return url.replace(/^https:\/\/api\.github\.com\/repos\//, '');
}

const lower = (list) => new Set((list ?? []).map((s) => s.toLowerCase()));

export function buildWall({ username, user, items, repos, config }) {
  const excludeRepos = lower(config.excludeRepos);
  const excludeOwners = lower(config.excludeOwners);
  const includeOwners = lower(config.includeOwners);
  const minStars = config.minRepoStars ?? 0;

  const repoInfo = new Map();
  for (const r of repos) {
    if (r.private) continue;
    repoInfo.set(r.full_name.toLowerCase(), r);
  }

  const prs = [];
  const used = new Map();
  for (const it of items) {
    const key = repoFromUrl(it.repository_url).toLowerCase();
    const r = repoInfo.get(key);
    if (!r) continue;
    const owner = r.owner.login.toLowerCase();
    if (includeOwners.size && !includeOwners.has(owner)) continue;
    if (excludeRepos.has(key) || excludeOwners.has(owner)) continue;
    if (r.stargazers_count < minStars) continue;

    used.set(key, r);
    prs.push({
      repo: r.full_name,
      number: it.number,
      title: it.title,
      url: it.html_url,
      state: prState(it),
      createdAt: it.created_at,
      mergedAt: it.pull_request?.merged_at ?? null,
      closedAt: it.closed_at ?? null,
    });
  }
  prs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const outRepos = [...used.values()].map((r) => ({
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    url: r.html_url,
    avatarUrl: r.owner.avatar_url,
    description: r.description ?? '',
    stars: r.stargazers_count,
    language: r.language ?? null,
  }));
  outRepos.sort((a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName));

  const count = (s) => prs.filter((p) => p.state === s).length;
  const mergedRepos = new Set(prs.filter((p) => p.state === 'merged').map((p) => p.repo));
  const stats = {
    total: prs.length,
    merged: count('merged'),
    open: count('open') + count('draft'),
    closed: count('closed'),
    repos: outRepos.length,
    owners: new Set(outRepos.map((r) => r.owner.toLowerCase())).size,
    stars: outRepos.filter((r) => mergedRepos.has(r.fullName)).reduce((n, r) => n + r.stars, 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    user: {
      login: username,
      name: user?.name ?? null,
      avatarUrl: user?.avatar_url ?? `https://github.com/${username}.png`,
      url: `https://github.com/${username}`,
    },
    stats,
    repos: outRepos,
    prs,
  };
}
