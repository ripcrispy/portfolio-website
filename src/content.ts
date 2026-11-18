import { reposUrl, selectRepos } from './repos';
import type { Content, Repo } from './types';

const TTL = 30 * 60 * 1000;

/**
 * Browser fallback only: repos are normally baked into the page at build time, so visitors never
 * hit the GitHub API (which allows just 60 unauthenticated requests per hour per IP).
 */
export async function fetchRepos(c: Content): Promise<Repo[]> {
  const key = `ps2p:repos:${c.github.user}`;
  let repos: Repo[] | null = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.t < TTL) repos = cached.data;
  } catch {
    /* ignore */
  }
  if (!repos) {
    const res = await fetch(reposUrl(c.github.user), { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    repos = (await res.json()) as Repo[];
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data: repos }));
    } catch {
      /* ignore */
    }
  }
  return selectRepos(repos, c);
}
