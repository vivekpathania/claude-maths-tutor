---
description: Start the local dev server (frees port 3000 first — only if something is LISTENING on it)
---
Start the maths tutor server for local development.

1. Find what is **listening** on port 3000 (not everything that has a socket on it):
   `lsof -ti tcp:3000 -sTCP:LISTEN`
   - If nothing, go to step 2.
   - If something, **show me what it is first**:
     `lsof -ti tcp:3000 -sTCP:LISTEN | xargs -I{} ps -o pid=,lstart=,command= -p {}`
     then kill just those: `lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill`
     (plain `kill` first; `kill -9` only if it is still there, which a hung server can be).
   - Do **not** use `lsof -ti :3000` — that also lists clients (a browser tab, a stuck
     `curl`), and killing them is how a browser's network process gets taken down.
2. Start the server: `node server.js`
3. Confirm it printed "Maths tutor running at http://localhost:3000".
4. Tell me the two URLs to open:
   - Child session: http://localhost:3000/
   - Parent dashboard: http://localhost:3000/dashboard.html
