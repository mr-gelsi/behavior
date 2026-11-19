# Behavior Tracker

A private website for a middle school (grades 6–8) to:

- record behavior **steps (1–5)** and see dashboards by grade,
- compare **steps by month across three school years**,
- list the students who **don't qualify for Rewards Day** (any Step 2 or higher, or two or more Step 1s),
- award or fine **P5 points** (Prompt, Prepared, Positive, Polite, Productive), optionally adding a step with a fine,
- run a **P5 store** where students spend points,
- let students **reserve a seat** in Rewards Day activities that teachers create, while non-qualifiers are **assigned to rooms automatically**,
- let each teacher choose which **rewards** each class can buy, including **custom rewards** only their classes can see,
- let each person put their left-hand **menu in the order they like**,
- give every class a **name spinner** and a one-click **class report** (printable, or spreadsheets),
- let teachers create **classes** with a join code, build a drag-and-drop **seating chart**, and award or fine P5 points right from each student's desk.

It runs on **Cloudflare** (a Worker plus a D1 database) and deploys from **GitHub**. There is no server to maintain.

> **Before you put real student names in this:** read [SECURITY.md](SECURITY.md) and ask your district's technology or privacy office. Most California districts need a data-privacy agreement for any service that stores student data.

---

## What's in this folder

| Path | What it is |
|---|---|
| `public/` | The website pages (HTML, CSS, JavaScript). No third-party code. |
| `src/` | The server code (Cloudflare Worker): sign-in, API, Rewards Day engine. |
| `migrations/` | The database tables (`0001`), starter data (`0002`), and classes and seating charts (`0003`), class rewards (`0004`), and staff last names (`0005`). |
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

> Run **all five** files in `migrations/` (`0001` to `0010`), in that order. The files contain no comments, so they paste cleanly into the D1 Console even though it joins everything onto one line.

1. In the Cloudflare dashboard, open **Storage & databases → D1** and click **Create database**. Name it exactly `behavior-tracker`.
2. Copy its **Database ID**.
3. In GitHub, open `wrangler.jsonc`, click the pencil (edit), replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID, and **Commit changes**. (The ID isn't a secret.)
4. Create the tables, using **one** of these:
   - **From the dashboard:** open your database → **Console**. Paste the full contents of `migrations/0001_schema.sql` and run it. Then do the same with `0002_seed.sql`, `0003_classes.sql`, `0004_class_rewards.sql`, and `0005_staff_last_name.sql`. (If a pasted file stops with "No SQL statements detected", it still has `--` comment lines. Delete those lines and try again.) If the console complains about a long paste, run it in smaller pieces, one `CREATE TABLE` at a time.
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

### Classes and seating charts

1. **My Classes → New class.** Give it a name and period. Every class gets a 6-character **class code** (no look-alike letters such as 0/O or 1/I).
2. Students sign in, open **My Classes**, and type the code. You can also add students yourself (**Students** tab, including a whole homeroom at once). Turn joining off in **Settings** once everyone is in, or make a new code at any time.
3. **Seating chart → Edit layout.**
   - Click an empty spot to add a desk, and drag desks to move them (or focus a desk and use the arrow keys). Dropping a desk on another one swaps them.
   - Pick a student on the right and click a desk to seat them, or use **Seat A–Z**.
   - Change the grid size, add a teacher desk, then click **Save layout**. Leaving the page with unsaved changes asks first.
4. **Copy a layout:** in Edit layout, choose another of your classes (archived ones included) and click **Copy layout here**. Tick the box to also seat students who are in both classes.
5. **Award & fine mode:** each desk has **+** and **−** buttons. **+** opens a window where you pick an amount, then tap what it's for (Prompt, Prepared, Positive, Polite, Productive) and the points are given. **−** works the same way, with the optional "Also add a step" box. You can also print the chart.
6. **Whole class:** **Award whole class** and **Fine whole class** (on the Seating chart and Students tabs) open a checklist of the class. Untick anyone who is absent, pick an amount and what it's for, and confirm. A fine can add a step to everyone fined. It all saves together or not at all.
7. On the **P5 Points** page, **Add a whole class or homeroom** also includes your classes.

Teachers see only their own classes. Admins can open any class. Students never see classmates or the seating chart.

### Reorder your menu

At the bottom of the left-hand menu, click **Reorder menu**. Drag a row by its **⋮⋮** handle, or use the **▲ ▼** arrows (they work with a keyboard and on phones). Click **Save** to keep it. **Reset** puts the menu back in its original order, and **Cancel** throws away your changes. The order is saved to your account, so it follows you to any computer or phone. Teachers, admins, and students each have their own order, and new tabs added in a future update appear at the end of your list.

### Name spinner (in every class)

Open a class and click **Name spinner**. The wheel fills itself with the class list.

- Press **Spin the wheel**. The pick is chosen with secure random numbers, so every name is equally likely, and the wheel then turns to stop on it.
- **Who is here?** Untick absent students. **Add other names** lets you type extra names (one per line) for guests, helpers, or groups.
- **Take each winner off the wheel** (on by default) makes sure everyone gets a turn. **Reset wheel** starts over, and **Put back on the wheel** returns a name you didn't mean to remove.
- Under the winner's name, **+ Award points** and **− Fine points** work the same as on the seating chart.
- The wheel is just for the lesson: nothing about spins is stored. If your computer is set to reduce motion, the wheel picks instantly with no animation.

### Class report (in every class)

Open a class and click **Report**. Choose a school year (and optionally a date range) to get, for everyone in the class: step counts by level, P5 awarded, fined, spent and current balance, store orders, and their Rewards Day activity, plus the full step history, P5 history, and store orders.

- **Print or save as PDF** opens a clean white, landscape printout (choose "Save as PDF" in the print window).
- **Student summary, Step history, P5 points, Store orders** download as spreadsheets (CSV files that open in Excel or Google Sheets, including names with accents).
- Reversed awards and fines are netted out, so the numbers match what students actually earned.
- A teacher can only open reports for their own classes (Admins can open any). Store orders for another teacher's custom rewards are left out. Opening a report is recorded in the audit log.

### Finding classes: Show and Sort

- **My Classes** opens on **My classes**, the classes you created. A teacher only ever sees their own.
- **Admins** also get a **Show** menu: **All teachers**, or one teacher picked from a list ordered by **last name** (shown as "Last, First"). With **All teachers**, classes are grouped under each teacher, ordered by last name.
- **Sort by:** **Period** (1, 2, 3 … then text periods, then classes with no period), **Class name**, or, when looking at other teachers, **Teacher (last name)**.
- **Staff names** have separate **First name** and **Last name** boxes (**Admin → Staff users**), and the staff list is ordered by last name. Existing accounts get their last name filled in from their current name (the last word). Fix any that came out wrong, for example "Jr." or a two-word surname, by editing the account.
- **Students** can only see classes they have joined, on their own **My Classes** page. They can't browse, list, or look up other classes, and a wrong, closed, or archived code all give the same answer.

### Rewards for each class

- **School rewards** are the shared store items. Only an **Admin** adds or edits them (**Store → School rewards**).
- **Custom rewards:** any teacher can add rewards just for their own classes under **Store → My class rewards**, such as "Five minutes of extra recess." No other teacher can see or edit them.
- **Choosing what a class offers:** open the class and go to the **Rewards** tab. Tick the school rewards and custom rewards you want, then **Save rewards**. You can also add a custom reward right there, copy another class's ticks, or go **Back to default**.
- **The default:** until you save a choice, a class offers **every school reward**, so nothing changes for classes you haven't touched. Students who aren't in any class also see the school rewards.
- **What students see:** only the rewards their classes offer. A student in several classes can buy anything any of those classes offers. Custom rewards show "From <teacher>".
- **Orders:** orders for school rewards are visible to all staff. Orders for a custom reward are visible only to the teacher who made it, and Admins. Only they can fulfil or cancel them.
- **Archiving a class** removes its rewards from its students. A student left with no active class sees the school rewards.

### Updating a site that is already running

1. Upload the new files to GitHub (replace the old ones). Cloudflare redeploys by itself.
2. In the D1 Console, run any migration you haven't run yet, in order: `0003_classes.sql`, then `0004_class_rewards.sql`, then `0005_staff_last_name.sql`. Run each only once. Existing data is kept.

### New school year checklist
1. **Admin → Reward periods:** add the new dates.
2. **My Classes:** archive last year's classes and create this year's. Use **Copy layout** to reuse a seating chart.
3. **Admin → Roster:** import the new roster and tick "Make students who are not in this file inactive". History is kept.
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
npm test                           # 498 automated checks
```

Use Chrome or Firefox locally. Safari refuses sign-in cookies on plain `http://localhost`.
There is also a demo server with **fake** students for trying every screen: `node --no-warnings test/e2e-server.mjs`, then open http://localhost:8787 and sign in with `admin@example.org` / `admin-password-123`. It keeps everything in memory.

## How the pieces fit

- `src/worker.js` receives every request, adds security headers, and sends `/api/*` to the routes. Everything else is served from `public/`.
- `src/routes/*` is the API. Each route checks who you are before doing anything.
- `src/lib/rewards.js` holds the Rewards Day rules (who qualifies, booking without overbooking, auto-assigning rooms).
- Points are never stored as a balance. They're a ledger (`p5_transactions`), and a balance is the sum of a student's rows.


## New: look, break tracker, bank-style student page

- **Look:** red fade top bar and left menu (`public/red-bg.jpg`), darker page background, white boxes, Inter font (bundled in `public/fonts`, no outside requests), outline icons (`public/js/icons.js`). Colours are variables at the top of `public/styles.css` and in the "MODERN THEME" block at the end.
- **Behavior Reports:** the 6th, 7th and 8th grade buttons moved into tabs on this page (with the Monthly and Reward Day reports). Old `#/grade/7` links still work.
- **Break Tracker (staff):** set your own 4-digit release PIN, see who is out right now, and run the report (by student or every break, with CSV). Admins can see who has a PIN and reset one.
- **Restroom / Water (students):** the button in the top bar (and on My P5) asks for a reason and a teacher PIN, then opens a timer. The student stops it by typing their own student number. All times are stamped by the server. A break still open after 3 hours is closed automatically and labelled "auto-closed".
- **My P5 (students):** bank-style card with the ticket balance, the student ID as the account number, name at the bottom, boxes for total tickets and total spent, and buttons for this rewards period's bonuses and fines/steps.
- **One more migration:** run `migrations/0007_breaks.sql` (or `0007_breaks_console.sql` in the Cloudflare console) once.

- **Student passwords:** after signing in with the PIN, students are asked to create their own password (8+ characters). From then on they sign in with their student ID and that password and the PIN stops working. An admin PIN reset clears the password, so the student starts over with the new PIN. Run `migrations/0008_student_passwords.sql` once (console copy: `0008_student_passwords_console.sql`).
- The Student tab is now first on the sign-in page, and Monthly Report lives only under Behavior Reports.

- **Steps compound (7 days):** a teacher's first step starts a 7-day window for that student. Any more steps from the same teacher inside the window must be higher than the highest one so far (Step 1, then 2, 3, 4, 5). After the 7 days the chain resets. On Record Steps and on a P5 fine with a step, the levels already used are greyed out, and the server refuses a lower step even if the page is bypassed. An admin can override a single step.
- **Trophies:** top P5 ticket earners in each Rewards period (tickets awarded, not counting ones taken back, across all active students): Gold for the top 10%, Silver 11-20%, Bronze 21-30%. The current period shows "so far" until it ends.
- **Badges:** step-free weeks (one for every full 7 days since the last step, or since the school year began) and days in class (school days, Monday-Friday, since the last restroom/water break). Each has Bronze, Silver, Gold and Platinum levels.
- **Teacher names for students:** students see only a teacher's last name (steps, classes, store items, break release).
- No new migration is needed for this update.

- **Trophies are per grade:** a student is ranked only against students in the same grade (top 10% gold, 11-20% silver, 21-30% bronze).
- **School calendar (Admin > School calendar):** upload a CSV (date, end_date, label, type) or add days one at a time. Days off (holidays, breaks, teacher days) and extra school days are stored per school year. Weekends are always skipped; with no calendar loaded, every weekday counts. Run `migrations/0009_school_calendar.sql` once (console copy: `0009_school_calendar_console.sql`).
- **Both badges count school days:** "school days without a step" and "school days in class" (no restroom/water break) use the calendar. Today is never counted until it is over.

## New: charger log, class jobs, student leadership

**One more migration:** run `migrations/0010_equipment_jobs_leadership.sql` once (Cloudflare console copy: `0010_equipment_jobs_leadership_console.sql`). The full set is now `0001` to `0010`.

- **Chargers (students):** the new **Chargers** menu item lets a student borrow a *charger* or a *computer*. They pick the item and a teacher types their 4-digit PIN to approve it (the same PIN teachers set on the Break Tracker page). The server records the date, time and which teacher approved. The student returns it by typing their own student number. Students see their own history with teacher last names only.
- **Charger Log (staff):** every check-out, who is still holding something (with a "Mark returned" button), totals, by-student and every-check-out views, filters, and CSV download.
- **Class jobs:** on any class, open the new **Jobs** tab. Add jobs (pick a preset such as Tech Helper or Materials Manager, or write your own), set the weekly salary in P5 tickets and the number of openings. Students open **My Classes** and press **Jobs** next to a class, then apply and explain why they'd be good for it. You see each application and press **Hire** or **Decline**, and **End job** later. A student can hold one job per class.
- **Automatic pay:** every Friday the hourly background job pays each hired student their job's current salary as a P5 award (ledger note "Class job pay: Tech Helper (Period 2)"). If the school calendar marks that Friday as a day off, the last school day of that week is pay day. Nobody is paid twice for the same week, a missed week is caught up, and a student is paid only while they still hold the job in a class they are still in. Admins can also run it by hand with `POST /api/admin/payroll/run` (optional `as_of` date).
- **Student leadership:** in **Admin > Roster > Edit** tick **Student leadership**. That student gets a **Store orders** tab next to **My bank**, listing pending School Store orders (not teachers' own custom rewards) with a **Mark handed out** button. Leaders never see prices or balances, cannot cancel or refund, and cannot hand out their own order. Untick the box and access ends immediately.
