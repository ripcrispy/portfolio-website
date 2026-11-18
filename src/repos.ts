import type { Content, Repo } from './types';

export const reposUrl = (user: string) =>
  `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed`;

/**
 * Pick the repos to show: skip forks, archived repos, the profile-README repo, excluded names and
 * anything already featured; most-starred first, then most recently pushed.
 * Pure (no DOM / network) so it runs both at build time and in the browser.
 */
export function selectRepos(repos: Repo[], c: Content): Repo[] {
  const { user, maxRepos, exclude } = c.github;
  const featured = new Set(
    c.projects
      .map((p) => p.repo?.match(/github\.com\/[^/]+\/([^/?#]+)/i)?.[1]?.toLowerCase())
      .filter(Boolean) as string[],
  );
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  return repos
    .filter((r) => {
      const n = r.name.toLowerCase();
      return !r.fork && !r.archived && n !== user.toLowerCase() && !skip.has(n) && !featured.has(n);
    })
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, maxRepos);
}
