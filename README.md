# Behavior Tracker

A private website for a middle school (grades 6–8) to:

- record behavior **steps (1–5)** and see dashboards by grade,
- compare **steps by month across three school years**,
- list the students who **don't qualify for Rewards Day** (any Step 2 or higher, or two or more Step 1s),
- award or fine **P5 points** (Prompt, Prepared, Positive, Polite, Productive), optionally adding a step with a fine,
- run a **P5 store** where students spend points,
- let students **reserve a seat** in Rewards Day activities that teachers create, while non-qualifiers are **assigned to rooms automatically**.

It runs on **Cloudflare** (a Worker plus a D1 database) and deploys from **GitHub**. There is no server to maintain.

> **Before you put real student names in this:** read [SECURITY.md](SECURITY.md) and ask your district's technology or privacy office. Most California districts need a data-privacy agreement for any service that stores student data.

---

## What's in this folder

| Path | What it is |
|---|---|
| `public/` | The website pages (HTML, CSS, JavaScript). No third-party code. |
| `src/` | The server code (Cloudflare Worker): sign-in, API, Rewards Day engine. |
| `migrations/` | The database tables (`0001`) and starter data (`0002`). |
| `templates/` | Blank CSV files showing the import formats. |
| `test/` | Automated tests (`npm test`) and a local demo server. |
| `wrangler.jsonc` | Cloudflare settings. You edit **one line** here (the database ID). |
| `SECURITY.md` | How student data is protected, and what you need to do. |

---

## Deploy it (about 30 minutes)

You need a free **GitHub** account and a **Cloudflare** account. Turn on two-factor sign-in for both.

> **Plan note.** Staff sign-in checks passwords with a deliberately slow hash. Cloudflare's **Free** Workers plan limits CPU time per request, and that check can hit the limit (you'd see "Error 1102" when staff sign in). The **Workers Paid** plan (about $5/month at the time of writing) avoids this. If you stay on Free, add a plain-text variable `PBKDF2_ITERATIONS` set to `20000` **before** creating any accounts. Student PIN sign-in is fast on either plan.

### Step 1: Put the code on GitHub

1. On GitHub, click **New repository**. Name it `behavior-tracker` and choose **Private**.
2. Upload everything in this folder (on the repository page: **Add file → Upload files**, then drag the files and folders in). Or, with Git installed: `git init`, `git add .`, `git commit -m "First version"`, then follow GitHub's "push an existing repository" instructions.
3. Never upload real student data. The `.gitignore` already keeps secrets and local files out.

### Step 2: Create the database

1. In the Cloudflare dashboard, open **Storage & databases → D1** and click **Create database**. Name it exactly `behavior-tracker`.
2. Copy its **Database ID**.
3. In GitHub, open `wrangler.jsonc`, click the pencil (edit), replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID, and **Commit changes**. (The ID isn't a secret.)
4. Create the tables, using **one** of these:
   - **From the dashboard:** open your database → **Console**. Paste the full contents of `migrations/0001_schema.sql` and run it. Then paste `migrations/0002_seed.sql` and run it. If the console complains about a long paste, run it in smaller pieces, one `CREATE TABLE` at a time.
   - **From a computer with Node installed:** in this folder run `npm install`, `npx wrangler login`, then `npm run db:migrate:remote`.

### Step 3: Connect GitHub to Cloudflare

1. In Cloudflare, open **Workers & Pages → Create → Import a repository** (Workers Builds) and pick your `behavior-tracker` repo.
2. Leave the **build command** empty. Set the **deploy command** to `npx wrangler deploy`. The Worker name must stay `behavior-tracker` to match `wrangler.jsonc`.
3. Save and deploy. From now on, every change you commit to the `main` branch deploys automatically.

### Step 4: Set the two secrets

In your Worker, open **Settings → Variables and secrets** and add two **secrets** (type "Secret", not plain text):

| Name | What to put |
|---|---|
| `PEPPER` | A long random string, at least 32 characters. **Save a copy in your password manager.** If it's ever lost or changed, every password and PIN stops working and has to be reset. |
| `SETUP_TOKEN` | Another long random string. You'll type it once to create the first Admin account. |

To make a random string on a Mac or Linux computer: `openssl rand -base64 48`. A password manager's generator works too. Then **redeploy** (or save and let it redeploy) so the Worker picks them up.

### Step 5: First sign-in

1. Open your site (shown in the Worker's page, ending in `.workers.dev`).
2. You'll see a **Create Admin account** screen. Enter the `SETUP_TOKEN`, your name, email, and a password of 12+ characters. This screen disappears once an Admin exists.
3. Sign in, then go to **Admin → Roster and PINs**:
   - Import the roster CSV (see `templates/roster-template.csv`). Include **Homeroom Teacher** and **Room** so the Reward Day report can show them.
   - Click **Generate PINs for students without one**, and **print the PIN sheet** right away. PINs are shown only once.
4. **Admin → Import steps**: load this year's workbook (save the "Paste" sheet as CSV) and, for the monthly comparison, the two earlier years.
5. **Admin → Reward periods**: enter the 2026-27 dates. (2025-26 comes pre-loaded from the workbook.)
6. **Admin → Staff users**: add teachers.
7. Optional: **Settings → Domains & Routes** to use your own web address.

---

## Using it day to day

- **Teachers:** Record Steps, P5 Points, Store orders, and their own Rewards Day activities.
- **Rewards Day:** an Admin creates the day (**Rewards Day → New Rewards Day**), picking the reward period that decides who qualifies and when booking opens and closes. Teachers add activities (a name, room, number of spots, P5 cost) and Admins or teachers add **non-qualifier rooms**. An Admin clicks **Open booking**. When booking closes, anyone who doesn't qualify and has no room is placed automatically. A red banner appears if the rooms are too small.
- **Students:** sign in with Student ID and PIN to see their points, shop, and reserve a seat.

### New school year checklist
1. **Admin → Reward periods:** add the new dates.
2. **Admin → Roster:** import the new roster and tick "Make students who are not in this file inactive". History is kept.
3. Generate PINs for new students.
4. Old steps stay in place, so the three-year comparison keeps working.

### Backups
- **Admin → Audit and export** downloads CSV copies of the main tables (no passwords or PINs).
- Cloudflare D1 can also restore the database to an earlier point in time. Check Cloudflare's current D1 documentation for how far back it goes on your plan.
- From a computer: `npx wrangler d1 export behavior-tracker --remote --output backup.sql`. Backups contain student names, so store them as carefully as the live data.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| "The database is not connected" | The database ID in `wrangler.jsonc` is wrong or missing. Fix it and redeploy. |
| "Server is missing the PEPPER secret" or a 500 when signing in | Add the `PEPPER` secret (Step 4) and redeploy. |
| "Setup token is incorrect" | Re-copy `SETUP_TOKEN` from Cloudflare. Five wrong tries lock setup for 15 minutes. |
| Error 1102 when staff sign in | CPU limit on the Free plan. Upgrade to Workers Paid, or set `PBKDF2_ITERATIONS` lower (see the plan note). |
| A student is locked out | Five wrong PINs lock the ID for 15 minutes. An Admin can generate a new PIN in **Admin → Find a student**, which clears the lock. |
| Seat counts or lists look wrong right after a change | Reload the page. Counts come straight from the database. |

---

## Run it on your own computer (optional)

```bash
npm install
cp .dev.vars.example .dev.vars     # then edit the two values
npm run db:migrate:local
npm run dev                        # opens http://localhost:8787
npm test                           # 139 automated checks
```

Use Chrome or Firefox locally. Safari refuses sign-in cookies on plain `http://localhost`.
There is also a demo server with **fake** students for trying every screen: `node --no-warnings test/e2e-server.mjs`, then open http://localhost:8787 and sign in with `admin@example.org` / `admin-password-123`. It keeps everything in memory.

## How the pieces fit

- `src/worker.js` receives every request, adds security headers, and sends `/api/*` to the routes. Everything else is served from `public/`.
- `src/routes/*` is the API. Each route checks who you are before doing anything.
- `src/lib/rewards.js` holds the Rewards Day rules (who qualifies, booking without overbooking, auto-assigning rooms).
- Points are never stored as a balance. They're a ledger (`p5_transactions`), and a balance is the sum of a student's rows.
