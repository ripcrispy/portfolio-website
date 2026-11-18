import type { Activity, ContribDay } from './types';

/**
 * GitHub contribution calendar, fetched at build time from one of two sources:
 *  - GraphQL API (needs a token; used in CI and when GITHUB_TOKEN is set locally)
 *  - the public contributions page GitHub itself uses to draw the profile graph (no token)
 * Pure functions only (no DOM / Node APIs) so they run in the Vite config.
 */

export const contributionsPageUrl = (user: string) =>
  `https://github.com/users/${encodeURIComponent(user)}/contributions`;

export const CONTRIB_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

const LEVELS: Record<string, ContribDay['level']> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

interface GraphQLCalendar {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          totalContributions: number;
          weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }[];
        };
      };
    } | null;
  };
}

export function activityFromGraphQL(json: GraphQLCalendar): Activity | null {
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) return null;
  const days = cal.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 }));
  return days.length ? { total: cal.totalContributions, days } : null;
}

/** Parse GitHub's public contributions page (the HTML behind the profile graph). */
export function activityFromHtml(html: string): Activity | null {
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const tips = new Map<string, string>();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) tips.set(m[1], m[2]);

  const days: ContribDay[] = [];
  for (const m of html.matchAll(/<td\b[^>]*ContributionCalendar-day[^>]*>/g)) {
    const tag = m[0];
    const date = attr(tag, 'data-date');
    const id = attr(tag, 'id');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const level = Math.min(4, Math.max(0, Number(attr(tag, 'data-level') ?? 0))) as ContribDay['level'];
    const tip = (id && tips.get(id)) || '';
    const count = Number(/^([\d,]+) contribution/.exec(tip.trim())?.[1]?.replace(/,/g, '') ?? 0);
    days.push({ date, count, level });
  }
  if (!days.length) return null;
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { total: days.reduce((n, d) => n + d.count, 0), days };
}
