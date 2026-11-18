/**
 * Pure string renderers (no DOM access) so they can run both in the browser
 * and inside the Vite plugin that pre-renders index.html.
 */
import type { Activity, ContribDay, Content, DeviceKind, Experience, Link, Repo, Server, Skill } from '../types';
import { icon } from './icons';

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Section metadata. Each section is one camera "station" and one crystal in the 3D scene. */
export const SECTIONS = [
  { id: 'top', ps: 'System', real: 'Overview' },
  { id: 'projects', ps: 'Memory Card', real: 'Projects' },
  { id: 'homelab', ps: 'Expansion Bay', real: 'Homelab' },
  { id: 'experience', ps: 'Browser', real: 'Experience' },
  { id: 'skills', ps: 'System Configuration', real: 'Skills' },
  { id: 'about', ps: 'Player 1', real: 'About me' },
  { id: 'contact', ps: 'Network', real: 'Contact' },
] as const;

/** Deterministic hue in the blue → violet → teal range for save icons. */
const hueOf = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 170 + (h % 150);
};

/**
 * DD/MM/YYYY in Australian time. (Rendering happens at build time, often on a UTC machine, so the
 * time zone is fixed explicitly: otherwise a morning push in Australia would show the day before.)
 */
const DATE_FMT = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d);
};

/** "2026-11-17" (a calendar day, no time zone) → "17/11/2026" */
const dayToDMY = (day: string) => day.split('-').reverse().join('/');

const isExternal = (url: string) => /^https?:\/\//.test(url);
const linkAttrs = (url: string) =>
  `href="${esc(url)}"${isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}`;

const linkList = (links: Link[], cls = 'links') =>
  `<ul class="${cls}">${links
    .map((l) => `<li><a ${linkAttrs(l.url)}>${icon(l.icon)}<span>${esc(l.label)}</span></a></li>`)
    .join('')}</ul>`;

const sectionHead = (i: number, sub = '', lead = '') => {
  const s = SECTIONS[i];
  return `<header class="screen-head">
    <p class="kicker">${esc(s.ps)}</p>
    <h2>${esc(s.real)}${sub ? ` <span class="h-sub">${esc(sub)}</span>` : ''}</h2>
    ${lead ? `<p class="screen-lead">${esc(lead)}</p>` : ''}
  </header>`;
};

interface SaveData {
  title: string;
  blurb: string;
  tags: string[];
  repo?: string;
  live?: string;
  meta?: string;
  featured?: boolean;
}

/** Let long repo names (kebab/snake case) wrap at their separators, never mid-word. */
const breakable = (s: string) => esc(s).replace(/([-_/])/g, '$1<wbr>');

export const saveCard = (p: SaveData) => `
  <article class="save${p.featured ? ' save--featured' : ''}" style="--h:${hueOf(p.title)}">
    <div class="save-icon" aria-hidden="true"><div class="cube">${'<i></i>'.repeat(6)}</div></div>
    <div class="save-body">
      <h3>${breakable(p.title)}</h3>
      ${
        p.featured || p.meta
          ? `<p class="save-meta">${p.featured ? '<span class="badge">Featured</span>' : ''}${p.meta ? esc(p.meta) : ''}</p>`
          : ''
      }
      <p class="save-blurb" title="${esc(p.blurb)}">${esc(p.blurb)}</p>
      <div class="save-foot">
        ${p.tags.length ? `<ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${
          p.repo || p.live
            ? `<p class="save-links">${p.repo ? `<a ${linkAttrs(p.repo)}>${icon('github')}Code</a>` : ''}${
                p.live ? `<a ${linkAttrs(p.live)}>${icon('globe')}Live</a>` : ''
              }</p>`
            : ''
        }
      </div>
    </div>
  </article>`;

export const repoCards = (repos: Repo[]) =>
  repos
    .map((r) =>
      saveCard({
        title: r.name,
        blurb: r.description || 'No description provided.',
        tags: [r.language, ...(r.topics ?? []).slice(0, 3)].filter(Boolean) as string[],
        repo: r.html_url,
        live: r.homepage || undefined,
        meta: `${r.stargazers_count ? `★ ${r.stargazers_count} · ` : ''}Updated ${formatDate(r.pushed_at)}`,
      }),
    )
    .join('');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style contribution graph, styled as glowing PS2 "memory blocks". */
export function activityPanel(a: Activity, user: string) {
  // Columns are weeks (Sun → Sat). Pad the first week so day 0 lands on its weekday.
  const firstWeekday = new Date(`${a.days[0].date}T00:00:00Z`).getUTCDay();
  const cells: (ContribDay | null)[] = [...Array<null>(firstWeekday).fill(null), ...a.days];
  const weeks: (ContribDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Month label on the first week where a new month begins (skip a cramped first label).
  const labels = weeks.map(() => '');
  let prev = -1;
  weeks.forEach((w, i) => {
    const d = w.find((x): x is ContribDay => x !== null);
    if (!d) return;
    const m = Number(d.date.slice(5, 7)) - 1;
    if (m !== prev) labels[i] = MONTHS[m];
    prev = m;
  });
  const next = labels.findIndex((l, i) => i > 0 && l);
  if (labels[0] && next > 0 && next < 3) labels[0] = '';

  const plural = (n: number) => `${n === 0 ? 'No' : n} contribution${n === 1 ? '' : 's'}`;
  const cell = (d: ContribDay | null) =>
    d ? `<i class="c l${d.level}" title="${plural(d.count)} · ${dayToDMY(d.date)}"></i>` : '<i class="c c--pad"></i>';

  return `
  <div class="panel activity">
    <div class="activity-head">
      <p><span class="activity-kicker">Activity</span> <b>${a.total.toLocaleString('en-US')}</b> contribution${
        a.total === 1 ? '' : 's'
      } in the last year</p>
      <a ${linkAttrs(`https://github.com/${user}`)} class="activity-link">@${esc(user)} ▸</a>
    </div>
    <div class="activity-scroll">
      <div class="activity-graph" role="img" aria-label="${a.total} GitHub contributions in the last year">
        <div class="act-days" aria-hidden="true"><span></span><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
        <div class="act-body" aria-hidden="true">
          <div class="act-months">${labels.map((l) => `<span>${l}</span>`).join('')}</div>
          <div class="act-weeks">${weeks
            .map((w, i) => `<div class="wk" style="--w:${i}">${[...w, ...Array<null>(7 - w.length).fill(null)].map(cell).join('')}</div>`)
            .join('')}</div>
        </div>
      </div>
    </div>
    <p class="activity-legend" aria-hidden="true">Less <i class="c l0"></i><i class="c l1"></i><i class="c l2"></i><i class="c l3"></i><i class="c l4"></i> More</p>
  </div>`;
}

const timelineItem = (e: Experience) => `<li>
  <p class="tl-date">${esc(e.start)} – ${esc(e.end)}</p>
  <div>
    <h3>${esc(e.role)} <span class="tl-org">${esc(e.org)}</span></h3>
    ${e.location ? `<p class="tl-loc">${esc(e.location)}</p>` : ''}
    ${e.points?.length ? `<ul>${e.points.map((pt) => `<li>${esc(pt)}</li>`).join('')}</ul>` : ''}
  </div>
</li>`;

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** Skill groups and the skills inside them, both alphabetical. */
const sortedSkills = (c: Content): [string, Skill[]][] =>
  Object.entries(c.skills)
    .sort(([a], [b]) => byName(a, b))
    .map(([g, list]) => [
      g,
      list.map((s) => (typeof s === 'string' ? { name: s } : s)).sort((a, b) => byName(a.name, b.name)),
    ]);

/** One skill: name, a 10-segment PS2 "memory block" meter, and the percentage. */
const skillRow = (s: Skill) => {
  const has = typeof s.level === 'number' && Number.isFinite(s.level);
  const pct = has ? Math.max(0, Math.min(100, Math.round(s.level as number))) : 0;
  const lit = Math.round(pct / 10);
  return `<li class="meter${has ? '' : ' meter--none'}"${has ? ` aria-label="${esc(s.name)}: ${pct}%"` : ''}>
    <span class="meter-name">${esc(s.name).replace(/\//g, '/<wbr>')}</span>
    ${
      has
        ? `<span class="meter-bar" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('')}</span>
    <span class="meter-pct" aria-hidden="true">${pct}%</span>`
        : ''
    }
  </li>`;
};

const STATUS_LABEL = { online: 'Online', maintenance: 'Maintenance', offline: 'Offline' } as const;

/** Rack tiers, in display order. */
const TIERS: { kind: DeviceKind; label: string }[] = [
  { kind: 'compute', label: 'Compute' },
  { kind: 'storage', label: 'Storage' },
  { kind: 'edge', label: 'Edge' },
  { kind: 'network', label: 'Network' },
];

const vendorLabel = (s: Server) => (s.vendor ? `<p class="vendor">${esc(s.vendor)}</p>` : '');

const statusBadge = (s: Server) =>
  s.status
    ? `<p class="status status--${s.status}"><span class="led" aria-hidden="true"></span>${STATUS_LABEL[s.status]}</p>`
    : '';

const specList = (s: Server) =>
  s.specs && Object.keys(s.specs).length
    ? `<dl class="server-specs">${Object.entries(s.specs)
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl>`
    : '';

const serverCard = (s: Server) => `
  <article class="panel server" style="--h:${hueOf(s.name)}">
    <header class="server-head">
      <div class="save-icon" aria-hidden="true"><div class="cube">${'<i></i>'.repeat(6)}</div></div>
      <div class="server-title">
        ${vendorLabel(s)}
        <h3>${esc(s.name)}</h3>
        <p class="server-role">${esc(s.role)}</p>
      </div>
      ${statusBadge(s)}
    </header>
    ${specList(s)}
    ${
      s.services?.length
        ? `<ul class="services" aria-label="Services on ${esc(s.name)}">${s.services
            .map(
              (sv) => `<li class="service">
            <p class="service-top">
              ${sv.url ? `<a ${linkAttrs(sv.url)} class="service-name">${esc(sv.name)} ▸</a>` : `<span class="service-name">${esc(sv.name)}</span>`}
              ${sv.category ? `<span class="service-cat">${esc(sv.category)}</span>` : ''}
            </p>
            <p class="service-desc">${esc(sv.description)}</p>
          </li>`,
            )
            .join('')}</ul>`
        : ''
    }
  </article>`;

/** Compact card for gear with at most one service (switches, firewalls, arrays, a Pi…). */
const deviceCard = (s: Server) => `
  <article class="panel device" style="--h:${hueOf(s.name)}">
    ${vendorLabel(s)}
    <h3 title="${esc([s.vendor, s.name].filter(Boolean).join(' '))}">${esc(s.name)}</h3>
    <p class="server-role">${esc(s.role)}</p>
    ${s.specs && Object.keys(s.specs).length ? `<p class="device-specs">${Object.values(s.specs).map(esc).join(' · ')}</p>` : ''}
    ${
      s.services?.length
        ? `<ul class="device-svcs">${s.services.map((sv) => `<li title="${esc(sv.description)}">${esc(sv.name)}</li>`).join('')}</ul>`
        : ''
    }
  </article>`;

/** Sum spec values like "384 GB ECC" / "4 TB" across devices, as GB. */
const sumSpec = (servers: Server[], keys: string[]) =>
  servers.reduce((total, s) => {
    for (const [k, v] of Object.entries(s.specs ?? {})) {
      if (!keys.includes(k)) continue;
      const m = /([\d.]+)\s*(TB|GB)/i.exec(v);
      if (m) total += parseFloat(m[1]) * (m[2].toUpperCase() === 'TB' ? 1000 : 1);
    }
    return total;
  }, 0);

const fmtSize = (gb: number) => (gb >= 1000 ? `${+(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`);

/** At-a-glance totals + devices grouped by rack tier. */
function homelabBody(servers: Server[]) {
  const services = servers.reduce((n, s) => n + (s.services?.length ?? 0), 0);
  const ram = sumSpec(servers, ['RAM']);
  const storage = sumSpec(servers, ['Storage', 'Capacity']);
  const summary = [
    ['Devices', String(servers.length)],
    ['Memory', ram ? fmtSize(ram) : ''],
    ['Storage', storage ? fmtSize(storage) : ''],
    ['Services', String(services)],
  ].filter(([, v]) => v && v !== '0');

  const tier = ({ kind, label }: (typeof TIERS)[number]) => {
    const list = servers.filter((s) => (s.kind ?? 'compute') === kind);
    if (!list.length) return '';
    const withServices = list.filter((s) => (s.services?.length ?? 0) > 1);
    const plain = list.filter((s) => (s.services?.length ?? 0) <= 1);
    return `<div class="tier" style="--n:${plain.length}">
      <p class="slot-head">${label} <span>${list.length}</span></p>
      ${withServices.length ? `<div class="lab">${withServices.map(serverCard).join('')}</div>` : ''}
      ${plain.length ? `<div class="devices">${plain.map(deviceCard).join('')}</div>` : ''}
    </div>`;
  };
  // Tiers made only of small devices sit side by side on one row.
  const big = TIERS.filter((t) => servers.some((s) => (s.kind ?? 'compute') === t.kind && (s.services?.length ?? 0) > 1));
  const small = TIERS.filter((t) => !big.includes(t));

  return `<dl class="panel lab-summary">${summary
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('')}</dl>${big.map(tier).join('')}<div class="tier-row">${small.map(tier).join('')}</div>`;
}

export function renderHead(c: Content) {
  const title = `${c.profile.name}${c.profile.handle ? ` (${c.profile.handle})` : ''} · ${c.profile.title}`;
  const desc = [c.profile.focus?.join(' · '), c.profile.tagline].filter(Boolean).join('. ');
  return `<title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:type" content="website" />`;
}

export function renderBoot(c: Content) {
  return `<p class="boot-name">${esc(c.profile.name)}</p>${
    c.profile.title ? `<p class="boot-sub">${esc(c.profile.title)}</p>` : ''
  }`;
}

const saves = (n: number) => `${n} save${n === 1 ? '' : 's'}`;

/** One short value line per section (used by the Overview menu tiles and the hub label). */
/** @param repoCount GitHub repos shown alongside the featured projects */
export function sectionValues(c: Content, repoCount = 0) {
  const skillCount = Object.values(c.skills).reduce((n, s) => n + s.length, 0);
  return [
    c.profile.name,
    saves(c.projects.length + repoCount),
    `${c.homelab.servers.length} devices`,
    `${c.experience.length} roles`,
    `${skillCount} skills`,
    c.about?.interests?.[0] ?? 'More about me',
    c.profile.email ? c.profile.email : 'Get in touch',
  ];
}

/**
 * The PS2-style floating label beside the crystal hub (yellow system name, cyan section,
 * white value), one item per section; main.ts shows the active one and keeps it next to the hub.
 */
export function renderHubLabel(c: Content, repos: Repo[] | null = null) {
  const values = sectionValues(c, repos?.length ?? 0);
  return `<div class="hub-label" id="hub-label">
    <div class="hl-items" aria-hidden="true">
      ${SECTIONS.map(
        (s, i) => `<div class="hl-item${i === 0 ? ' on' : ''}">
          <p class="hl-ps">${esc(s.ps)}</p>
          <p class="hl-real">${esc(s.real)}</p>
          <p class="hl-val">${esc(values[i])}</p>
        </div>`,
      ).join('')}
    </div>
    <div class="hl-arrows">
      <button type="button" class="hl-arrow" data-dir="-1" aria-label="Previous section">▲</button>
      <button type="button" class="hl-arrow" data-dir="1" aria-label="Next section">▼</button>
    </div>
  </div>`;
}

/**
 * @param repos    repos fetched at build time (null = not available; the browser will try instead)
 * @param activity contribution calendar fetched at build time (null = graph omitted)
 */
export function renderOverlay(
  c: Content,
  repos: Repo[] | null = null,
  activity: Activity | null = null,
  avatar: string | null = null,
) {
  const p = c.profile;
    const lab = c.homelab;
  const svcCount = lab.servers.reduce((n, s) => n + (s.services?.length ?? 0), 0);
  const menuVal = sectionValues(c, repos?.length ?? 0).slice(1);

  const hero = `
  <section class="screen screen--hero" id="top" data-station>
    <div class="panel hero">
      <p class="kicker">System <span class="kicker-dim">· ready</span></p>
      <div class="hero-id">
        ${
          avatar || c.github.user
            ? `<div class="avatar"><img src="${esc(avatar || `https://github.com/${c.github.user}.png?size=240`)}" alt="${esc(p.name)}'s avatar" width="120" height="120" /></div>`
            : ''
        }
        <div class="hero-id-text">
          <h1 class="hero-name">${esc(p.name)}${p.handle ? ` <span class="hero-handle">“${esc(p.handle)}”</span>` : ''}</h1>
          <p class="hero-title">${esc(p.title)}</p>
        </div>
      </div>
      ${
        p.focus?.length
          ? `<ul class="hero-focus" aria-label="Areas of focus">${p.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
          : ''
      }
      <p class="hero-tagline">${esc(p.tagline)}</p>
      <p class="hero-bio">${esc(p.bio)}</p>
      <dl class="spec">
        <div><dt>Location</dt><dd>${esc(p.location)}</dd></div>
        ${c.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}
      </dl>
      ${linkList(p.links)}
    </div>
    <nav class="menu" aria-label="Sections">
      ${SECTIONS.slice(1)
        .map(
          (s, i) => `<a href="#${s.id}" class="menu-item">
            <span class="menu-ps">${esc(s.ps)}</span>
            <span class="menu-real">${esc(s.real)}</span>
            <span class="menu-val">${esc(menuVal[i])}</span>
          </a>`,
        )
        .join('')}
    </nav>
    <p class="scroll-cue" aria-hidden="true">▼ Scroll</p>
  </section>`;

  const projects = `
  <section class="screen" id="projects" data-station>
    ${sectionHead(1, saves(c.projects.length + (repos?.length ?? 0)))}
    ${activity ? activityPanel(activity, c.github.user) : ''}
    <p class="slot-head">Slot 1 <span>Featured + live from GitHub · <a ${linkAttrs(
      `https://github.com/${c.github.user}`,
    )}>@${esc(c.github.user)}</a></span></p>
    <div class="saves">
      ${c.projects.map((p) => saveCard({ ...p, featured: true })).join('')}
      ${
        repos
          ? `<div id="repos" class="repos" data-baked>${repos.length ? repoCards(repos) : ''}</div>`
          : `<div id="repos" class="repos" aria-live="polite" aria-busy="true"><p class="loading">Reading memory card…</p></div>`
      }
    </div>
  </section>`;

  const homelab = `
  <section class="screen" id="homelab" data-station>
    ${sectionHead(2, `${lab.servers.length} devices · ${svcCount} services`, lab.intro)}
    ${homelabBody(lab.servers)}
  </section>`;

  const experience = `
  <section class="screen" id="experience" data-station>
    ${sectionHead(3)}
    <ol class="timeline panel">${c.experience.map(timelineItem).join('')}</ol>
    ${
      c.education?.length || c.certifications?.length
        ? `<div class="creds">
      ${
        c.education?.length
          ? `<div class="panel cred-panel"><p class="slot-head">Education</p><ol class="timeline timeline--compact">${c.education
              .map(timelineItem)
              .join('')}</ol></div>`
          : ''
      }
      ${
        c.certifications?.length
          ? `<div class="panel cred-panel"><p class="slot-head">Certifications</p><ul class="certs">${c.certifications
              .map(
                (x) => `<li>${x.url ? `<a ${linkAttrs(x.url)}>${esc(x.name)}</a>` : esc(x.name)}${
                  x.issuer || x.year ? `<span>${esc([x.issuer, x.year].filter(Boolean).join(' · '))}</span>` : ''
                }</li>`,
              )
              .join('')}</ul></div>`
          : ''
      }
    </div>`
        : ''
    }
  </section>`;

  const skills = `
  <section class="screen" id="skills" data-station>
    ${sectionHead(4)}
    <dl class="config panel">
      ${sortedSkills(c)
        .map(
          ([group, list]) => `<div class="config-row">
            <dt>${esc(group)}</dt>
            <dd><ul class="meters">${list.map(skillRow).join('')}</ul></dd>
          </div>`,
        )
        .join('')}
    </dl>
  </section>`;

  const ab = c.about;
  const about = ab
    ? `
  <section class="screen" id="about" data-station>
    ${sectionHead(5, '', ab.lead)}
    <div class="panel about">
      ${
        ab.image
          ? `<figure class="about-photo">
        <span class="about-corner tl" aria-hidden="true"></span><span class="about-corner br" aria-hidden="true"></span>
        <img src="${esc(ab.image.src)}"${ab.image.srcset ? ` srcset="${esc(ab.image.srcset)}" sizes="(min-width: 901px) 380px, 100vw"` : ''}
          alt="${esc(ab.image.alt)}" width="${ab.image.width}" height="${ab.image.height}" loading="lazy" decoding="async" />
        ${ab.image.caption ? `<figcaption>${esc(ab.image.caption)}</figcaption>` : ''}
      </figure>`
          : ''
      }
      <div class="about-text">
        <p class="about-label">Profile</p>
        ${ab.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('')}
        ${
          ab.interests?.length
            ? `<div class="about-interests"><p class="about-label">Interests</p><ul class="about-tags">${ab.interests
                .map((t) => `<li>${esc(t)}</li>`)
                .join('')}</ul></div>`
            : ''
        }
      </div>
    </div>
  </section>`
    : '';

  const contact = `
  <section class="screen screen--contact" id="contact" data-station>
    ${sectionHead(6)}
    <div class="panel contact">
      ${p.contactLead ? `<p class="contact-lead">${esc(p.contactLead)}</p>` : ''}
      ${
        p.email
          ? `<p class="contact-email"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>
             <button type="button" class="copy" data-copy="${esc(p.email)}">Copy</button></p>`
          : ''
      }
      ${linkList(p.links, 'links links--menu')}
    </div>
    <p class="footer-note">© ${new Date().getFullYear()} ${esc(p.name)}${
      p.handle ? ` · ${esc(p.handle)}` : ''
    } · Built with Three.js · An homage to early-2000s console dashboards.</p>
  </section>`;

  return hero + projects + homelab + experience + skills + about + contact;
}
