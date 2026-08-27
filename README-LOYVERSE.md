# restaurant-pos-loyverse (isolated worktree)

- **UI:** http://localhost:5174/  (`VITE_POS_MODE=loyverse`)
- **Gateway:** :3143 → Surreal `loyverse`/`loyverse`
- **Catalogue:** `loyverse-sync` (NOT ASI menu)
- **Rooms only from ASI PMS:** `asi-sync` with `ASI_MENU_SYNC=0` `ASI_TABLE_SYNC=0` `ASI_ROOM_SYNC=1`

ASI operator stack stays in `C:\CODE\restaurant-pos` (:5173 / :3142 / posr).

Start:
  cd gateway && node server.js
  bun run dev
  cd loyverse-sync && npm start
  cd asi-sync && npm start   # rooms/guests only
