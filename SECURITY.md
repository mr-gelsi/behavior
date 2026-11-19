# Security and student data

This site stores student names, grade, homeroom, behavior steps, and P5 points. That is education-record data, so it is built to keep as little as possible and to lock down what it keeps. This page explains what the code does, what it can't do, and what your school still needs to do.

## What is stored (and what is not)

**Stored:** student ID, name, grade, homeroom teacher and room, behavior steps (level, date, teacher, period, notes), P5 points ledger, store orders, Rewards Day bookings, staff accounts, and an audit log.

**Not stored:** birth dates, addresses, phone numbers, parent contacts, photos, grades, health or special-education information, or anything from outside the files you import. Please keep it that way. Don't type sensitive details into the Notes fields.

## How the code protects it

| Area | What it does |
|---|---|
| **Database access** | The D1 database is reachable only through the Worker. There is no public database address. Cloudflare encrypts D1 data at rest and all traffic uses HTTPS. |
| **Staff passwords** | At least 12 characters. Stored as a slow PBKDF2-SHA256 hash with a random salt, mixed with a secret key (`PEPPER`) that lives only in Cloudflare. A copy of the database alone can't be used to crack passwords. |
| **Student PINs** | Six digits, shown once, stored only as a keyed hash (HMAC with the same secret). A six-digit PIN has about 900,000 possibilities, so protection comes from the secret key and from lockouts, not from slow hashing. |
| **Lockouts** | Five wrong tries lock that account for 15 minutes. There is also a per-IP limit. Setup of the first Admin has its own limit. A classmate could deliberately lock another student out by typing wrong PINs; an Admin clears it by generating a new PIN. |
| **Sessions** | A random 256-bit token in a cookie that page scripts can't read (`HttpOnly`), is sent only over HTTPS (`Secure`), and is never sent from other sites (`SameSite=Strict`). Only a hash of the token is stored. Staff sessions last 12 hours and student sessions 8. Signing out, changing a password, deactivating a person, or resetting a PIN ends their sessions. |
| **Class codes** | Six characters from a 31-letter-and-number alphabet (about 887 million possibilities). Each student may enter at most 10 wrong codes per 15 minutes. A code only lets a signed-in student join that one class. Teachers can close joining or make a new code at any time. |
| **Classes and seating** | Teachers can open only their own classes. Admins can list and open any teacher's classes (join codes are never shown to other teachers). Students see only classes they have joined, and only each class's name, period, and teacher. They can't see classmates, seating charts, class codes, or other students' points, and trying to leave or look up a class they haven't joined looks the same as a class that doesn't exist. |
| **Class reports** | A report contains student names, step notes, and points, so it is limited to the class's own teacher and Admins, is never available to students, and each time one is opened it is written to the audit log. The CSV downloads are made in the browser from that data. Treat downloaded files like any other student record. |
| **Menu order** | The only thing stored is a short list of menu names for each person. It holds no student information. |
| **Rewards** | Only Admins can add or change school rewards. A custom reward belongs to the teacher who made it: other teachers can't see, edit, or offer it, and only its owner and Admins see its orders. A student can only buy a reward their classes offer, and that is checked on the server for every purchase. |
| **Who can see what** | Every request is checked on the server, not only in the page. Students can reach only their own points, store, and seat. Teachers can't reach Admin features. Non-qualifiers see only their assigned room, never the reason. |
| **Forged requests** | Writes must come from this site (origin check) and must be JSON, on top of `SameSite=Strict`. |
| **Injected scripts** | A strict Content-Security-Policy allows only this site's own files (no inline scripts or styles, no outside code). All text is escaped before it is shown. |
| **Database attacks** | Every query is parameterized. Inputs are validated for type and length. |
| **Spreadsheet tricks** | CSV downloads neutralize cells that start with `=`, `+`, `-`, or `@`. |
| **Search engines and framing** | Pages say `noindex`, `robots.txt` blocks crawlers, and the site can't be shown inside another site. |
| **Money-like data** | Points are a ledger, never a stored number. Purchases and seat bookings check balance and capacity inside a single database statement, so two clicks at once can't overspend or overbook. |
| **Audit log** | Sign-ins, imports, exports, PIN resets, point changes, store and seat changes, and settings changes are recorded with who and when. It never contains passwords or PINs. |
| **Logs** | The server logs only a short error message, never request contents or student information. |

## What you need to do

1. **Get approval first.** In California, districts normally need a signed data-privacy agreement with any service that stores student data. Cloudflare and GitHub would be part of that. Ask your district's technology or privacy office before importing real names.
2. **Protect the accounts that control it.** Turn on two-factor sign-in for your **Cloudflare** and **GitHub** accounts. Keep the GitHub repository **private**.
3. **Guard the two secrets.** Keep `PEPPER` and `SETUP_TOKEN` only in Cloudflare and your password manager, never in GitHub, email, or chat. Losing or changing `PEPPER` means every password and PIN must be reset.
4. **Keep Admins few.** Give most staff the Teacher role. Deactivate accounts when people leave.
5. **Treat PIN sheets like keys.** Print them, hand them out, and shred or lock up the leftovers. Reset a PIN if one gets out.
6. **Handle exports and backups carefully.** CSV exports and `wrangler d1 export` files contain student names. Store them in an approved place and delete old copies.
7. **Review now and then.** Skim **Admin → Audit and export** for anything unexpected, such as exports or PIN resets you didn't do.
8. **Never commit real data.** Don't put rosters or exports in the repository. The included demo data is fake.

## What this does not do

- It doesn't replace your district's own review or agreements.
- It has no single sign-on with your school accounts. Staff use a password the site manages. Cloudflare Access can be put in front for school-account sign-in and an extra layer, but that needs separate setup, and student sign-in would need to be excluded from it.
- It doesn't include a bot check on the login screen. Lockouts and rate limits are in place. You can add Cloudflare Turnstile or a Cloudflare rate-limiting rule for more protection.
- It doesn't send alerts. Nobody is notified of repeated failed sign-ins unless you check the log.
- Users can write anything in Notes. Remind staff to keep notes factual and brief.

## Reporting a problem

If you think a PIN, password, export, or either secret has been exposed: reset the affected PINs or passwords in Admin, and if `PEPPER` or `SETUP_TOKEN` leaked, replace the secret in Cloudflare (replacing `PEPPER` signs everyone out and requires resetting all passwords and PINs). Then check the audit log for the time window involved.


## Break tracker PINs

- Teacher PINs are 4 digits, so they are a classroom convenience, not strong security. They are stored as a keyed hash (using the secret `PEPPER`), never as digits, and no page ever shows them.
- A student gets 5 wrong teacher PINs per 15 minutes (and each school network address 40) before being locked out for 15 minutes. Wrong guesses are written to the audit log (Admin) so you can spot a student guessing.
- Times are stamped by the server. A student can only stop their own timer, by typing their own student number.
- Change PINs now and then, and reset one from the Break Tracker page if a student learns it.

## Student passwords

Student passwords are stored with the same slow, salted, secret-keyed hash as staff passwords (never as text). Wrong guesses count toward the same 5-per-15-minutes lock as PINs. Setting a password signs the student out everywhere and switches off their PIN.
