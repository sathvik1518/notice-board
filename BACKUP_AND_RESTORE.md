# Backup and restore (Notice Board)

A backup is only a backup once you have **restored it somewhere else and looked at it**. Do the restore test, not just the export.

## What to save

| Part | Where it lives | How to save it |
|---|---|---|
| Notices, users, roles, settings | the **database** | export it to one `.sql` file |
| The plugin | `wp-content/plugins/notice-board/` | it is already in this repo (`plugin/notice-board/`) |
| Uploaded files | `wp-content/uploads/` | copy the folder (this project has none) |
| `wp-config.php` | the WordPress folder | copy it, keep it private (it holds the database password and salts) |

## The real steps (MySQL: Local, XAMPP, any host)

> **Not run here.** The sandbox this project was built in has no MySQL. These are the standard commands; run them once on your own machine and tick the boxes below. What *was* run here is the SQLite version in the next section.

**1. Back up**

- Local: site → **Database** tab → **Adminer** → *Export* → *Save* (SQL). Or in a terminal: `mysqldump -u root -p --single-transaction --default-character-set=utf8mb4 local > notice-board-backup.sql`
- XAMPP: `http://localhost/phpmyadmin` → pick the database → **Export** → *Quick* → *SQL* → Go. Or: `C:\xampp\mysql\bin\mysqldump.exe -u root --single-transaction --default-character-set=utf8mb4 wordpress > notice-board-backup.sql`

**2. Restore into a NEW, empty database** (never over the live one)

```sql
CREATE DATABASE notice_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
```bash
mysql -u root -p --default-character-set=utf8mb4 notice_restore < notice-board-backup.sql
```
(phpMyAdmin: create the database, open it, **Import** the file.)

**3. Point a copy of the site at the new database**

Copy the WordPress folder, change `DB_NAME` in the copy's `wp-config.php` to `notice_restore`. If the copy has a different address, set `WP_HOME` and `WP_SITEURL` in `wp-config.php` to it. Open the copy.

**4. Look at it**

- [ ] `/wp-json/wp/v2/notices` shows the same published notices, newest first
- [ ] the draft, scheduled and private notices are still **not** listed for a visitor
- [ ] you can sign in as the Editor and publish a new notice
- [ ] a Subscriber still gets 403 when creating one
- [ ] Plugins page: Notice Board is active

## What was actually run here (SQLite, same idea)

The test WordPress in this project stores everything in one SQLite file instead of MySQL. The matching steps:

| MySQL | Here |
|---|---|
| `mysqldump` (consistent export) | `php harness/backup.php <database file> <backup file>` (`VACUUM INTO`: a consistent copy of the whole database in one file) |
| `CREATE DATABASE notice_restore` | a database file name that has never been used (`.ht.restored.sqlite`) |
| `mysql ... < backup.sql` | copy the backup to that file name |
| point `DB_NAME` at it | `WP_DB_FILE=.ht.restored.sqlite` (second site on port 8081) |

`npm run test:wp` does all of this automatically (the last group of tests) and checks that the restored site has the same notices in the same order, still hides the three hidden notices, has the same users and rights, accepts a new notice, and that the original database is not touched.

## Habits

- Back up **before** an update or a plugin change, and keep the last 3.
- Keep one copy **off the computer** (cloud drive, USB stick).
- A backup you have never restored is a hope, not a backup.
