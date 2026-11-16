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
remain assigned to the sample user. The password change route still returns
`501`; password reset is available through email.

To use a different SQLite file, export `DATABASE_URL` before starting the API:

```bash
DATABASE_URL=sqlite:////absolute/path/to/recall.db npm run dev:api
```

The parent directory must exist. The API reads environment variables from the
process and loads optional settings from `apps/api/.env` for local development.
Put `OPENAI_API_KEY=...` in that ignored file to enable AI note generation and
quizzes. Photos of written notes (PNG/JPG/WEBP) are sent straight to the same
OpenAI model, so no local OCR model is needed. Auto-tagging embeds each card
(`OPENAI_EMBEDDING_MODEL`, default `text-embedding-3-small`), groups similar
cards with HDBSCAN (scikit-learn), and then asks the model to name each group,
so every tag covers at least two cards. For HTTPS deployment, set `SESSION_COOKIE_SECURE=true`. Adding the session table is automatic for
existing databases; future changes to existing table columns will need migrations.

### Google sign-in setup

Google sign-in is optional. Set `GOOGLE_CLIENT_ID` in `apps/api/.env` to show a
**Continue with Google** button on login and signup. The frontend reads the public
client ID from the API, so no frontend environment variable or client secret is needed.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview),
   select or create a project, and click **Get started** if prompted.
2. Fill in **Branding** with the app name (Recall), support email, and contact
   information. Choose **External** under **Audience** for personal Google accounts;
   add your testing accounts under **Test users** while developing.
3. Open **Clients → Create client** and choose **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost` and
   `http://localhost:3000`. Add your exact HTTPS frontend origin for production.
   Origins have no path; use the actual port if your frontend runs elsewhere.
   Leave **Authorized redirect URIs** empty: this integration uses a popup and
   JavaScript callback, not a redirect callback.
5. Copy the **Client ID** into the existing `apps/api/.env` (preserve other settings):

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   ```

6. Restart the API (`npm run dev:api`, or restart `npm run dev`) and visit
   `http://localhost:3000/login`. Select **Continue with Google**.

For production, complete the branding/domain information Google requests, review
the app's publishing status under **Audience**, register the production origin,
and set `SESSION_COOKIE_SECURE=true` in the API environment. Only basic sign-in
is used; no Google Drive or Gmail access is requested.

See Google's [client setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
and [Auth Platform guide](https://support.google.com/cloud/answer/15544987).

The API verifies Google's signed ID token and its audience, issuer, expiry,
verified email, and browser-bound nonce before issuing a normal Recall session.
`GET /api/auth/google/challenge` supplies the client ID and a ten-minute challenge;
`POST /api/auth/google` accepts `{credential, password?}` and consumes the challenge
once on success. Existing databases automatically gain `google_identities` and
`google_login_challenges` tables on startup; existing user rows are unchanged.

An existing email/password account requires its Recall password before linking
Google, preserving its user ID and decks. Subsequent Google logins use Google's
stable subject ID. Each Recall account links to one Google account. Google-created
accounts can establish a password through **Forgot password?** if email delivery
is configured. Logout revokes the Recall session; it does not sign out of Google.

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
