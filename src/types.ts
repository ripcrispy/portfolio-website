export type IconName = 'github' | 'linkedin' | 'mail' | 'file' | 'globe' | 'x' | 'coffee';

export interface Link {
  label: string;
  url: string;
  icon?: IconName;
}

export interface Project {
  title: string;
  blurb: string;
  tags: string[];
  repo?: string;
  live?: string;
  year?: string;
}

export interface Service {
  name: string;
  description: string;
  /** e.g. "Monitoring", "DNS", "Media" */
  category?: string;
  /** optional public link (never an internal address) */
  url?: string;
}

export type DeviceKind = 'compute' | 'storage' | 'edge' | 'network';

export interface Server {
  /** model name, e.g. "PowerEdge R620" */
  name: string;
  /** manufacturer, shown as a small label above the name, e.g. "Dell" */
  vendor?: string;
  role: string;
  /** which rack tier the device is listed under (default: compute) */
  kind?: DeviceKind;
  /** omit to hide the status light */
  status?: 'online' | 'maintenance' | 'offline';
  /** free-form spec rows, e.g. { "CPU": "...", "RAM": "...", "OS": "..." } */
  specs?: Record<string, string>;
  services?: Service[];
}

export interface Experience {
  role: string;
  org: string;
  start: string;
  end: string;
  location?: string;
  /** achievement bullets (optional) */
  points?: string[];
}

export interface Skill {
  name: string;
  /** relative strength, 0–100 (omit or null for no meter) */
  level?: number | null;
}

export interface Certification {
  name: string;
  issuer?: string;
  year?: string;
  url?: string;
}

export interface Content {
  profile: {
    name: string;
    handle?: string;
    title: string;
    /** areas of focus, shown as one line under the title */
    focus?: string[];
    tagline: string;
    bio: string;
    location: string;
    email?: string;
    /** intro line in the Contact section */
    contactLead?: string;
    links: Link[];
  };
  stats: { label: string; value: string }[];
  projects: Project[];
  homelab: {
    intro?: string;
    servers: Server[];
  };
  about?: {
    /** short line under the section title */
    lead?: string;
    paragraphs: string[];
    /** things you're into, shown as tags */
    interests?: string[];
    image?: { src: string; srcset?: string; alt: string; caption?: string; width: number; height: number };
  };
  experience: Experience[];
  education?: Experience[];
  certifications?: Certification[];
  /** group → skills; a skill is a name, or { name, level } with level as a 0–100 percentage */
  skills: Record<string, (string | Skill)[]>;
  github: {
    user: string;
    maxRepos: number;
    exclude: string[];
  };
}

export interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
  topics?: string[];
}

export interface ContribDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  /** GitHub's intensity bucket: 0 = none … 4 = busiest */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Activity {
  total: number;
  /** consecutive days, oldest first */
  days: ContribDay[];
}
