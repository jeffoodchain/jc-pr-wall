import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prState, repoFromUrl, buildWall } from '../scripts/wall.mjs';

const item = (over = {}) => ({
  number: 1,
  title: 'fix: something',
  html_url: 'https://github.com/acme/rocket/pull/1',
  repository_url: 'https://api.github.com/repos/acme/rocket',
  state: 'closed',
  draft: false,
  created_at: '2026-01-01T00:00:00Z',
  closed_at: '2026-01-02T00:00:00Z',
  pull_request: { merged_at: '2026-01-02T00:00:00Z' },
  ...over,
});

const repo = (over = {}) => ({
  full_name: 'acme/rocket',
  name: 'rocket',
  owner: { login: 'acme', avatar_url: 'https://avatars.example/acme' },
  html_url: 'https://github.com/acme/rocket',
  description: 'Rockets',
  stargazers_count: 1200,
  language: 'Rust',
  private: false,
  ...over,
});

test('prState distinguishes merged, open, draft and closed', () => {
  assert.equal(prState(item()), 'merged');
  assert.equal(prState(item({ state: 'open', pull_request: { merged_at: null } })), 'open');
  assert.equal(prState(item({ state: 'open', draft: true, pull_request: { merged_at: null } })), 'draft');
  assert.equal(prState(item({ pull_request: { merged_at: null } })), 'closed');
});

test('repoFromUrl extracts owner/name', () => {
  assert.equal(repoFromUrl('https://api.github.com/repos/acme/rocket'), 'acme/rocket');
});

test('buildWall drops PRs whose repo is private or unknown', () => {
  const wall = buildWall({
    username: 'me',
    items: [
      item(),
      item({ number: 2, repository_url: 'https://api.github.com/repos/secret/thing' }),
      item({ number: 3, repository_url: 'https://api.github.com/repos/gone/repo' }),
    ],
    repos: [repo(), repo({ full_name: 'secret/thing', private: true })],
    config: {},
  });
  assert.deepEqual(wall.prs.map((p) => p.number), [1]);
  assert.deepEqual(wall.repos.map((r) => r.fullName), ['acme/rocket']);
});

test('buildWall honours excludeRepos, excludeOwners and minRepoStars (case-insensitive)', () => {
  const repos = [
    repo(),
    repo({ full_name: 'Big/Small', name: 'Small', owner: { login: 'Big', avatar_url: '' }, stargazers_count: 2 }),
    repo({ full_name: 'skip/me', name: 'me', owner: { login: 'skip', avatar_url: '' } }),
    repo({ full_name: 'org/hidden', name: 'hidden', owner: { login: 'org', avatar_url: '' } }),
  ];
  const items = repos.map((r, i) =>
    item({ number: i + 1, repository_url: `https://api.github.com/repos/${r.full_name}` }),
  );
  const wall = buildWall({
    username: 'me',
    items,
    repos,
    config: { excludeRepos: ['SKIP/me'], excludeOwners: ['ORG'], minRepoStars: 10 },
  });
  assert.deepEqual(wall.repos.map((r) => r.fullName), ['acme/rocket']);
});

test('buildWall keeps only includeOwners when it is set (case-insensitive)', () => {
  const repos = [
    repo(),
    repo({ full_name: 'Keep/one', name: 'one', owner: { login: 'Keep', avatar_url: '' } }),
    repo({ full_name: 'drop/two', name: 'two', owner: { login: 'drop', avatar_url: '' } }),
  ];
  const items = repos.map((r, i) =>
    item({ number: i + 1, repository_url: `https://api.github.com/repos/${r.full_name}` }),
  );
  const wall = buildWall({ username: 'me', items, repos, config: { includeOwners: ['keep', 'ACME'] } });
  assert.deepEqual(wall.repos.map((r) => r.fullName).sort(), ['Keep/one', 'acme/rocket']);
  const all = buildWall({ username: 'me', items, repos, config: { includeOwners: [] } });
  assert.equal(all.repos.length, 3);
});

test('buildWall computes stats and sorts PRs newest first', () => {
  const wall = buildWall({
    username: 'me',
    items: [
      item({ number: 1, created_at: '2026-01-01T00:00:00Z' }),
      item({ number: 2, created_at: '2026-03-01T00:00:00Z', state: 'open', pull_request: { merged_at: null } }),
      item({ number: 3, created_at: '2026-02-01T00:00:00Z', pull_request: { merged_at: null } }),
      item({
        number: 4,
        created_at: '2026-02-15T00:00:00Z',
        repository_url: 'https://api.github.com/repos/beta/lib',
      }),
    ],
    repos: [repo(), repo({ full_name: 'beta/lib', name: 'lib', owner: { login: 'beta', avatar_url: '' }, stargazers_count: 300 })],
    config: {},
  });
  assert.deepEqual(wall.prs.map((p) => p.number), [2, 4, 3, 1]);
  assert.deepEqual(wall.stats, { total: 4, merged: 2, open: 1, closed: 1, repos: 2, owners: 2, stars: 1500 });
  assert.equal(wall.user.login, 'me');
});

test('buildWall stats only count stars of repos with a merged PR', () => {
  const wall = buildWall({
    username: 'me',
    items: [item({ pull_request: { merged_at: null } })],
    repos: [repo()],
    config: {},
  });
  assert.equal(wall.stats.stars, 0);
  assert.equal(wall.stats.repos, 1);
});
