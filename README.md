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
- `POST /api/auth/password/forgot` emails a time-limited password reset link.
- `POST /api/auth/password/reset` consumes the link and changes the password.

Passwords use Argon2 hashes. Sessions expire after seven days; only a hash of
the random session token is stored in the database. The browser sends the
HTTP-only `recall_session` cookie on `/api` requests. Signup and login responses
contain only the user's ID and email.
Password reset links expire after 30 minutes, can only be used once, and revoke
existing login sessions. Reset email uses the existing Resend configuration;
set `WEB_URL` to the frontend's public URL outside local development.

Flashcard generation and deck retrieval require login. Generated decks belong
to the logged-in user, and other users cannot retrieve them. Existing demo decks
remain assigned to the sample user. Password reset and change routes still
return `501` pending their implementation.

To use a different SQLite file, export `DATABASE_URL` before starting the API:

```bash
DATABASE_URL=sqlite:////absolute/path/to/recall.db npm run dev:api
```

The parent directory must exist. The API reads environment variables from the
process and loads optional settings from `apps/api/.env` for local development.
Put `OPENAI_API_KEY=...` in that ignored file to enable AI note generation and
quizzes. For HTTPS deployment, set `SESSION_COOKIE_SECURE=true`. Adding the session table is automatic for
existing databases; future changes to existing table columns will need migrations.

### Reviewing and editing decks

In **My Decks**, choose **Create a deck**, then **Write cards** to create a deck manually, or **Generate from notes** to generate cards from an upload. **Save notes only** keeps the original file without creating flashcards. Generation requires the backend's OpenAI configuration; manual creation and editing need no external service.

Open a saved deck to read its cards. Use **Edit deck** or an individual **Edit card** action to edit its title, questions, answers, and review flags, or add/remove cards. Changes are applied with **Save changes** or **Save deck**. Removed cards can be undone before saving; saving a removal also deletes that card's reviews and labels. Retained cards keep their study history and labels.

Unsaved editor drafts and study sessions are kept per account and browser tab in session storage. Editing a card during study offers **Return to study** to resume with refreshed card text. The editor also provides card search, a needs-checking filter, and a flip preview.

After revealing an answer in **Review due cards**, press **1 Again**, **2 Hard**, **3 Good**, or **4 Easy** to save the rating and advance. Matching number badges appear on the buttons. Shortcuts are inactive before revealing the answer, in free practice, while typing in form controls, and while a review is saving; held keys and modifier combinations are ignored.

`POST /api/decks` creates an empty owned deck from `{title}`. `PUT /api/decks/{deck_id}` atomically saves `{title, version, flashcards: [{id?, question, answer, needs_review}]}`. Omit `id` for new cards; existing IDs must belong to that deck. Omitted existing cards are deleted. The version returned by GET is required; stale saves receive `409` without modifying cards. Existing SQLite decks receive version 1 on startup.

The library checks `/api/flashcards/status` before offering generation. This reports configuration, not credential validity. Reminder preferences can be saved independently of email delivery; delivering reminders still requires the email configuration and reminder service.

### Choosing study material

On **Study**, use **What do you want to study?** to search and select multiple decks or tags. Cards match any selected deck and any selected tag; choosing both groups narrows the result to tagged cards inside those decks. The matching count updates before starting. Clear the selection to return to all cards. Choices are remembered per account in this browser; direct **Study this deck** links override the remembered focus.

**Session options** controls the batch size (default 20, maximum 100) and optionally shuffles the order within that batch. Cards are selected oldest-due first; practice also includes upcoming cards and leaves scheduling unchanged. Pagination follows the batch size. Returning from the card editor restores the same selection and remaining session.

`GET /api/study/cards` accepts repeated `deck_ids` and `labels` parameters, alongside the existing singular `deck_id` and `label`. Decks must all belong to the signed-in user. Tag matches are deduplicated, so a card with several selected tags appears once.

### Daily study goals

The dashboard starts with a daily target of 20 cards in the browser’s time zone. **Edit goal** opens a compact dialog with a single target control (1–1,000 cards). Saving stores the target per account and detects the browser’s time zone automatically. The progress bar counts successfully saved due-card reviews; free practice, quizzes, and manually recorded activity do not count. Yogo celebrates once the target is reached, and progress resets at midnight in the saved time zone, including daylight-saving changes. Returning to the dashboard, focusing its tab, or leaving it open refreshes progress automatically.

`GET /api/goals/daily?timezone=America/New_York` returns the saved target (or the default), today’s review count, and the next reset time. `PUT /api/goals/daily` accepts `{target, timezone}`. Startup adds the `daily_study_goals` table to existing databases without changing their data.
