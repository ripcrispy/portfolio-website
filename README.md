<div align="center">

# portfolio-website

**A full-screen WebGL portfolio inspired by early-2000s console dashboards.**
Boot sequence, crystal menu, CRT-style output: no framework, just TypeScript, Three.js and shaders.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r170-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![WebGL](https://img.shields.io/badge/WebGL-2.0-990000?style=for-the-badge&logo=webgl&logoColor=white)](https://www.khronos.org/webgl/)
[![GLSL](https://img.shields.io/badge/GLSL-shaders-5586A4?style=for-the-badge&logo=opengl&logoColor=white)](https://www.khronos.org/opengl/wiki/Core_Language_(GLSL))

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-663399?style=for-the-badge&logo=css&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![Node.js](https://img.shields.io/badge/Node.js-20-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-hosted-222222?style=for-the-badge&logo=githubpages&logoColor=white)](https://pages.github.com/)
[![No framework](https://img.shields.io/badge/framework-none-f3e36a?style=for-the-badge)](#how-it-works)

[![Dashboard](docs/dashboard.webp)](https://ripcrispy.github.io/portfolio-website/)

**[▶ View the live site](https://ripcrispy.github.io/portfolio-website/)**

</div>

| Boot sequence | Homelab | Contact |
| :---: | :---: | :---: |
| ![Boot sequence](docs/intro.webp) | ![Homelab](docs/homelab.webp) | ![Contact](docs/contact.webp) |

## Features

- **Boot sequence:** a field of towers flies out of the dark, orbiting light trails, your name. Skippable with any key, click or tap, and shortened on repeat visits.
- **Live 3D dashboard:** a full-screen scene with a rotating crystal ring, glass spokes and a swirling nebula. Scrolling glides the camera between sections; click a crystal to jump straight there.
- **Contact "insert disc" screen:** the whole scene turns to dark red smoke and smoked-glass cubes on the final section.
- **Real data, baked at build time:** GitHub repos, the contribution graph and your avatar are fetched during the build, so visitors never hit GitHub's rate limits.
- **Readable everywhere:** all content is real HTML pre-rendered into `index.html`. It works without JavaScript or WebGL and is indexable by search engines.

## How it works

| Piece | What it does |
| --- | --- |
| **Vite plugin** (`vite.config.ts`) | Renders `src/content.json` into the HTML and bakes in GitHub repos, activity and avatar (cached on disk). |
| **Scene** (`src/scene/`) | Instanced towers (one draw call), crystal and glass-spoke shaders, a low-res nebula pass, a camera path driven by scroll. |
| **Output pipeline** (`src/scene/output.ts`) | *Composite* mode renders at ~576 lines with chroma bleed, scanlines and dithering; *Component* mode is sharp. Both share a cheap glow pass. |
| **Overlay** (`src/overlay/`) | HTML renderers, HUD clock, section label, scroll engine with section gliding. |

**Performance:** rendering uses a fixed pixel budget (a 4K screen costs about the same as 1080p), the quality tier auto-adjusts if the frame rate drops, frames are capped at 60 fps, and rendering pauses in background tabs. Three.js loads in its own chunk after the text has painted. `prefers-reduced-motion` and no-WebGL fallbacks are built in.

## Editing content

Everything lives in **`src/content.json`**: profile, links, stats, projects, homelab, experience, skills (with optional `level` 0–100), the About section and the GitHub username. In dev, saving it reloads the page.

**Homelab** devices take a `name`, `vendor`, `role`, `kind` (`compute` / `storage` / `edge` / `network`), optional `status`, free-form `specs` and a list of `services`. Keep it public-safe: no IP addresses, internal hostnames or ports.

## Develop

```bash
npm install
npm run dev
```

Optional: put a GitHub token in `.env.local` (git-ignored) to avoid API rate limits while developing:

```bash
echo "GITHUB_TOKEN=your_token" > .env.local
```

URL flags: `?boot` replays the full intro · `?q=low|medium|high` forces a graphics tier · `?video=composite|component` picks the output style.

## Deploy (GitHub Pages)

1. Push to GitHub (any repo name works: the build uses relative paths, so it serves from `/<repo>/`).
2. **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` deploys via `.github/workflows/deploy.yml`, plus a daily rebuild to refresh the GitHub data.

---

<sub>An homage to early-2000s console dashboards. All visuals are original and rendered in real time; no console assets, logos or audio are used.</sub>
