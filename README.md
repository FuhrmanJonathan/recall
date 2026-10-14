# Recall

- `apps/web` — Next.js frontend
- `apps/api` — FastAPI backend
- `apps/database` — shared SQLAlchemy models and SQLite storage

Requires Node.js 22+, Python 3.12+, and uv.

```bash
npm run setup
npm run dev
```

Add backend routes in `apps/api/app/main.py`. Frontend requests to `/api/*`
are forwarded to the backend. To change its URL, set `API_URL` in
`apps/web/.env.local` before starting or building the frontend.

Run the backend and database tests with:

```bash
uv run --directory apps/api --locked pytest
uv run --directory apps/api --locked pytest ../database/tests
```

Use `npm run dev:web` or `npm run dev:api` to run one app.
For production, run `npm run build`, then `npm run start:web` and
`npm run start:api` in separate processes.

### Database and login

Starting the API creates the tables in `apps/database/recall.db` automatically.
Users, login sessions, decks, and flashcards all use this database. No separate
database server or sample-data setup is needed. The file is ignored by Git;
accounts survive API restarts as long as the file is kept.

Use the frontend's `/signup` and `/login` pages, or explore the API at
`http://localhost:8000/docs`:

- `POST /api/auth/signup` accepts an email and password (at least five characters),
  creates a user, and logs them in. An existing email returns `409`.
- `POST /api/auth/login` checks the saved password hash and starts a session.
- `GET /api/auth/me` returns the logged-in user's ID and email.
- `POST /api/auth/logout` revokes the session and clears its cookie.

Passwords use Argon2 hashes. Sessions expire after seven days; only a hash of
the random session token is stored in the database. The browser sends the
HTTP-only `recall_session` cookie on `/api` requests. Signup and login responses
contain only the user's ID and email.

Flashcard generation and deck retrieval require login. Generated decks belong
to the logged-in user, and other users cannot retrieve them. Existing demo decks
remain assigned to the sample user. Password reset and change routes still
return `501` pending their implementation.

To use a different SQLite file, export `DATABASE_URL` before starting the API:

```bash
DATABASE_URL=sqlite:////absolute/path/to/recall.db npm run dev:api
```

The parent directory must exist. The API reads environment variables from the
process; it does not automatically load an API `.env` file. For HTTPS deployment,
set `SESSION_COOKIE_SECURE=true`. Adding the session table is automatic for
existing databases; future changes to existing table columns will need migrations.
