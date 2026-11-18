import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import content from './src/content.json';
import * as render from './src/overlay/render';
import * as activityMod from './src/activity';
import * as reposMod from './src/repos';
import type { Activity, Content, Repo } from './src/types';

type Renderers = typeof render;

/** Files that feed the pre-rendered HTML; editing them reloads the page in dev. */
const HTML_SOURCES = ['/src/content.json', '/src/overlay/render.ts', '/src/overlay/icons.ts', '/src/repos.ts', '/src/activity.ts'];

// ---------------------------------------------------------------------------------------------
// GitHub data (repos + contribution activity), fetched at build time, not by visitors' browsers.
//
// The unauthenticated GitHub API allows only 60 requests/hour per IP, so the data is fetched
// here and baked into the HTML. In CI, GITHUB_TOKEN raises that to 5,000/hour. Results are
// cached on disk so dev reloads/restarts don't burn requests, and if GitHub is unreachable the
// last good copy is used.
// ---------------------------------------------------------------------------------------------
const DEV_TTL = 60 * 60 * 1000; // dev: refetch at most hourly

interface DiskCache<T> {
  t: number;
  user: string;
  data: T;
}

const cacheFile = (name: string) => resolve(`node_modules/.cache/ps2p-${name}.json`);
const inflight = new Map<string, Promise<unknown>>();

const explain = (status: number, token: string | undefined) =>
  status === 401
    ? ' (GITHUB_TOKEN is invalid or expired)'
    : status === 403 || status === 429
      ? token
        ? ' (token lacks access or is rate limited)'
        : ' (rate limited; add GITHUB_TOKEN to .env.local)'
      : '';

/** Fetch-once-per-TTL with an on-disk last-good copy. */
async function cached<T>(name: string, user: string, isBuild: boolean, fetcher: () => Promise<T>): Promise<T | null> {
  let cache: DiskCache<T> | null = null;
  try {
    cache = JSON.parse(await readFile(cacheFile(name), 'utf8')) as DiskCache<T>;
    if (cache.user !== user) cache = null;
  } catch {
    /* no cache yet */
  }
  if (!isBuild && cache && Date.now() - cache.t < DEV_TTL) return cache.data;

  const key = `${name}:${user}`;
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        try {
          const data = await fetcher();
          await mkdir(dirname(cacheFile(name)), { recursive: true });
          await writeFile(cacheFile(name), JSON.stringify({ t: Date.now(), user, data } satisfies DiskCache<T>));
          return data;
        } catch (err) {
          console.warn(`[${name}] ${(err as Error).message}; ${cache ? 'using cached copy' : 'not available'}`);
          return cache?.data ?? null;
        } finally {
          inflight.delete(key);
        }
      })(),
    );
  }
  return inflight.get(key) as Promise<T | null>;
}

const ghHeaders = (token: string | undefined) => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'portfolio-build',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const loadRepos = (user: string, isBuild: boolean, token: string | undefined) =>
  cached<Repo[]>('repos', user, isBuild, async () => {
    const res = await fetch(reposMod.reposUrl(user), { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`GitHub API ${res.status}${explain(res.status, token)}`);
    const data = (await res.json()) as Repo[];
    console.info(`[repos] fetched ${data.length} repos for @${user} (${token ? 'authenticated' : 'unauthenticated'})`);
    return data;
  });

/** GitHub avatar as a data: URI, so the page never calls GitHub from visitors' browsers. */
const loadAvatar = (user: string, isBuild: boolean) =>
  cached<string>('avatar', user, isBuild, async () => {
    const res = await fetch(`https://github.com/${encodeURIComponent(user)}.png?size=240`, {
      headers: { 'User-Agent': 'portfolio-build' },
    });
    if (!res.ok) throw new Error(`avatar ${res.status}`);
    const type = res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  });

/** Contribution calendar: GraphQL with a token, else the public contributions page. */
const loadActivity = (user: string, isBuild: boolean, token: string | undefined) =>
  cached<Activity>('activity', user, isBuild, async () => {
    if (token) {
      try {
        const res = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: activityMod.CONTRIB_QUERY, variables: { login: user } }),
        });
        if (!res.ok) throw new Error(`GraphQL ${res.status}${explain(res.status, token)}`);
        const a = activityMod.activityFromGraphQL(await res.json());
        if (!a) throw new Error('GraphQL returned no calendar');
        console.info(`[activity] ${a.total} contributions for @${user} (GraphQL)`);
        return a;
      } catch (err) {
        console.warn(`[activity] ${(err as Error).message}; trying the public contributions page`);
      }
    }
    const res = await fetch(activityMod.contributionsPageUrl(user), { headers: { 'User-Agent': 'portfolio-build' } });
    if (!res.ok) throw new Error(`contributions page ${res.status}`);
    const a = activityMod.activityFromHtml(await res.text());
    if (!a) throw new Error('could not read the contributions page');
    console.info(`[activity] ${a.total} contributions for @${user} (public page)`);
    return a;
  });

/**
 * Pre-renders the portfolio content (plus GitHub repos and activity) straight into index.html at build and
 * dev time, so the text is visible instantly, indexable by search engines and works without
 * JS/WebGL. In dev, content and renderers are loaded fresh on every request, so edits to
 * content.json / render.ts show up on reload without restarting the server.
 */
function prerenderContent(token: string | undefined): Plugin {
  let server: ViteDevServer | undefined;
  let isBuild = false;
  return {
    name: 'prerender-content',
    configResolved(cfg) {
      isBuild = cfg.command === 'build';
    },
    configureServer(s) {
      server = s;
    },
    async transformIndexHtml(html) {
      let data = content as Content;
      let r: Renderers = render;
      let sel = reposMod.selectRepos;
      if (server) {
        data = (await server.ssrLoadModule('/src/content.json')).default as Content;
        r = (await server.ssrLoadModule('/src/overlay/render.ts')) as Renderers;
        sel = ((await server.ssrLoadModule('/src/repos.ts')) as typeof reposMod).selectRepos;
      }
      const [all, activity, avatar] = await Promise.all([
        loadRepos(data.github.user, isBuild, token),
        loadActivity(data.github.user, isBuild, token),
        loadAvatar(data.github.user, isBuild),
      ]);
      const repos = all ? sel(all, data) : null;
      return html
        .replace('<!--app-head-->', r.renderHead(data))
        .replace('<!--app-boot-->', r.renderBoot(data))
        .replace('<!--app-hub-->', r.renderHubLabel(data, repos))
        .replace('<!--app-html-->', r.renderOverlay(data, repos, activity, avatar));
    },
    handleHotUpdate({ file, server: s }) {
      if (HTML_SOURCES.some((src) => file.endsWith(src))) {
        s.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // GITHUB_TOKEN from the shell (CI) or from .env.local (git-ignored). It is only used here at
  // build time; Vite never exposes non-VITE_ variables to browser code.
  const env = loadEnv(mode, process.cwd(), '');
  const token = (process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || '').trim() || undefined;
  return {
    // Relative base works for both <user>.github.io and <user>.github.io/<repo>/ deployments.
    base: './',
    plugins: [prerenderContent(token)],
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 700,
    },
  };
});
