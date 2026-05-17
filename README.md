# barista-bench-site — dashboard sources

Source for the Barista project's benchmark dashboard at
<https://bench.barista.build/>. The companion marketing and documentation
site at <https://barista.build/> is built and deployed from a separate
repository.

## Status

Pre-release scaffolding. A minimal landing route ships from day one and
fetches the public benchmark index so the data path is exercised end to
end. Interactive charts and per-run pages land as the project matures.

## Stack

- [Next.js 16+](https://nextjs.org/) (App Router)
- [React 19+](https://react.dev/)
- TypeScript (strict mode)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) component primitives
- Deployed to [Vercel](https://vercel.com/)

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Edit `app/page.tsx` to change the landing
route; the page auto-reloads.

## Scripts

| Command         | What it does                  |
| --------------- | ----------------------------- |
| `npm run dev`   | Start the dev server          |
| `npm run build` | Build for production          |
| `npm run start` | Run the production build      |
| `npm run lint`  | Run ESLint                    |

## Configuration

| Variable                   | Purpose                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_R2_INDEX_URL` | Public URL of the benchmark index JSON in the R2 bucket. Defaults to `https://barista-bench.r2.dev/index.json` if unset. |

The landing route fetches `index.json` server-side and renders a run
count. If the URL is unreachable or the response is not valid JSON, the
route gracefully degrades to a "no runs yet" state — the page is never
broken by a missing bucket.

## Layout

- `app/` — App Router routes, layouts, global styles.
- `components/ui/` — shadcn/ui component primitives.
- `lib/` — shared utilities (`cn`, etc.).
- `public/` — static assets served at the site root.

## License

Dual-licensed under [MIT](./LICENSE-MIT) OR
[Apache-2.0](./LICENSE-APACHE), matching the main Barista repository.
