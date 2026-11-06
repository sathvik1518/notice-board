# notice-board

A WordPress **Notice** content type (title, body, class, publish date) with an Editor/Subscriber split, and a React page that lists published notices newest first, with search, a class filter and pages of 5.

```
plugin/notice-board/   the WordPress plugin (copy into wp-content/plugins/)
src/                   the React page (Vite + TypeScript)
harness/, tests/       a real test WordPress (PHP + SQLite) and the tests that run against it
scripts/               the real-browser check
BACKUP_AND_RESTORE.md  backup, and restore into a new database
```

```bash
npm install
npm run wp:setup      # once: downloads WordPress + SQLite plugin from GitHub
npm run wp:start      # terminal 1: http://localhost:8080
npm run dev           # terminal 2: http://localhost:5173
npm run test:wp && npm test && npm run proof
```

See `DOCUMENTATION.md` for the full write-up.
