# restaurant-pos-loyverse (isolated worktree)

Branch: `loyverse-pos` · Path: `C:\CODE\restaurant-pos-loyverse`

| | |
|--|--|
| UI | http://localhost:5174/ (`VITE_POS_MODE=loyverse`) |
| Gateway | `:3143` → Surreal `loyverse`/`loyverse` |
| Catalogue | `loyverse-sync` (NOT ASI menu) |
| Rooms | `asi-sync` with `ASI_MENU_SYNC=0` `ASI_TABLE_SYNC=0` `ASI_ROOM_SYNC=1` |

ASI operator stack stays in `C:\CODE\restaurant-pos` (:5173 / :3142 / posr).

## Start

```bash
cd gateway && node server.js
bun run dev
cd loyverse-sync && npm start
cd asi-sync && npm start   # rooms/guests only into loyverse/loyverse
```

Full notes: `docs/integrations/LOYVERSE-SETUP.md`
