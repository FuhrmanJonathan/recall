# Recall

- `apps/web` — Next.js frontend
- `apps/api` — FastAPI backend

Requires Node.js 22+, Python 3.12+, and uv.

```bash
npm run setup
npm run dev
```

The frontend runs on http://localhost:3000 and the backend on
http://127.0.0.1:8000. Ctrl+C stops both.

Add backend routes in `apps/api/app/main.py`. Frontend requests to `/api/*`
are forwarded to the backend. To change its URL, set `API_URL` in
`apps/web/.env.local` before starting or building the frontend.

Use `npm run dev:web` or `npm run dev:api` to run one app.
For production, run `npm run build`, then `npm run start:web` and
`npm run start:api` in separate processes.
