#!/usr/bin/env node
// Fetches your pull requests to other people's repositories and writes
// site/data/prs.json. Uses only GitHub's search API, so the default
// Actions GITHUB_TOKEN is enough.
//
//   GITHUB_TOKEN=... node scripts/fetch-prs.mjs   (or: gh auth login, then run it)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWall } from './wall.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'pr-wall.config.json'), 'utf8'));
const username = process.env.PR_WALL_USER || config.username;
const outFile = join(root, 'site/data/prs.json');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
// With no token (or PR_WALL_USE_GH=1), shell out to the GitHub CLI for auth.
const useGh = !token || process.env.PR_WALL_USE_GH === '1';

async function api(path, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.github.com${path}?${qs}`;
  if (useGh) {
    const args = ['api', '-X', 'GET', path, ...Object.entries(params).flatMap(([k, v]) => ['-f', `${k}=${v}`])];
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pr-wall',
      },
    });
    if (res.ok) return res.json();
    const limited = res.status === 403 || res.status === 429;
    if (limited && attempt < 3) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 5_000), 65_000);
      console.warn(`rate limited, waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}\n${await res.text()}`);
  }
}

async function searchAll(path, q) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api(path, { q, per_page: '100', page: String(page), sort: 'created', order: 'desc' });
    items.push(...data.items);
    if (data.items.length < 100 || items.length >= data.total_count) break;
  }
  return items;
}

let q = `is:pr author:${username}`;
if (!config.includeOwnRepos) q += ` -user:${username}`;
const items = await searchAll('/search/issues', q);
console.log(`found ${items.length} pull requests`);

// Repository metadata, ten repos per search query.
const names = [...new Set(items.map((i) => i.repository_url.replace('https://api.github.com/repos/', '')))];
const repos = [];
for (let i = 0; i < names.length; i += 10) {
  const batch = names.slice(i, i + 10);
  const data = await api('/search/repositories', { q: batch.map((n) => `repo:${n}`).join(' '), per_page: '100' });
  repos.push(...data.items);
}
console.log(`looked up ${repos.length}/${names.length} repositories`);

const users = await api('/search/users', { q: `user:${username}` });
const wall = buildWall({ username, user: users.items[0], items, repos, config });
if (config.displayName) wall.user.name = config.displayName;
if (config.tagline) wall.tagline = config.tagline;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(wall, null, 2) + '\n');
console.log(`wrote ${wall.prs.length} PRs across ${wall.repos.length} repos to ${outFile}`);
