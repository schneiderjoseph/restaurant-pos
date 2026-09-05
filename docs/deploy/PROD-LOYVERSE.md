# Guide déploiement prod — profil Loyverse (POSR + catalogue cloud)

Checklist pratique pour installer l'environnement **production** du POS avec catalogue **Loyverse** (mode `VITE_POS_MODE=loyverse`). Ce profil tourne sur sa **propre machine dédiée** — il ne coexiste pas avec un profil ASI sur le même poste.

**Portée de ce soir : catalogue seulement.** Loyverse fournit le menu/catégories/clients/moyens de paiement ; POSR encaisse et fait ses propres rapports. Le push des reçus POSR → Loyverse (`loyverse-sync/src/receipt-push.js`) n'est **pas branché** au flux de paiement — les ventes ne remonteront pas dans le Back Office Loyverse. C'est un choix assumé pour ce déploiement, pas un bug à corriger ce soir.

## Topologie

**Tout sur le même PC dédié** : POSR (SPA + gateway + Surreal) + poller `loyverse-sync`. Optionnel : `asi-sync` en mode « rooms only » si cette propriété a aussi un PMS ASI pour les chambres.

```text
┌───────────────────────────────────────────────────────────┐
│  Machine dédiée (IP LAN ex. <PROPERTY_LAN_IP>)             │
│                                                             │
│  loyverse-sync (poll cloud) ──► SurrealDB loopback         │
│                                        │                    │
│                            gateway / nginx / SPA POSR       │
│                                        │                    │
│  [optionnel] asi-sync (rooms/guests) ─┘  (PMS on-site)      │
└──────────────────────┬──────────────────────────────────────┘
                        │ LAN (tablettes Chrome)
                        ▼
              http(s)://<PROPERTY_LAN_IP>
```

Conséquences :

- Surreal reste en **127.0.0.1** (jamais exposé au LAN) ; NS/DB = **`loyverse`/`loyverse`** — les scripts `loyverse-sync` **refusent** de tourner sur `posr`/`posr` (protection intentionnelle, pas une limite à contourner).
- Les tablettes n'ouvrent que l'UI POSR (nginx / build Vite) sur l'IP LAN du PC.
- Un seul poller `loyverse-sync` sur cette machine. Si le PMS ASI existe sur site pour les chambres, `asi-sync` tourne en plus, jamais en mode menu/tables (`ASI_MENU_SYNC=0`, `ASI_TABLE_SYNC=0`).

Docs liées :

- [Loyverse ↔ POSR — mapping, scopes, env](../integrations/LOYVERSE.md)
- [Ce qui a été construit / limites](../integrations/LOYVERSE-SETUP.md)
- [Gateway / sécurité](../security/GATEWAY.md)
- Exemples env : [`.env.example`](../../.env.example), [`loyverse-sync/.env.example`](../../loyverse-sync/.env.example), [`gateway/.env.example`](../../gateway/.env.example)

---

## 1. Ce que tu déploies

| Composant | Rôle | Port typique |
|-----------|------|--------------|
| **SPA POSR** (build Vite) | UI tablettes / caisse | 80/443 via nginx (LAN) |
| **SurrealDB** | Base POS — NS/DB `loyverse`/`loyverse` | `8000` **loopback only** |
| **Gateway** | Auth + `/auth` + `/rpc` | `3142` (derrière nginx) |
| **Print server** | ESC/POS | `3132` |
| **loyverse-sync** (poller) | Menu + clients + moyens de paiement + discounts cloud → Surreal | process Node |
| **asi-sync** (optionnel) | Chambres / guests PMS on-site → Surreal (jamais le menu) | process Node |

**Profil Loyverse (build) :**

- `VITE_POS_MODE=loyverse`
- `VITE_RESORT_FB=` `true` seulement si la propriété a des chambres suivies via un PMS on-site, sinon `false`
- Modules à activer/désactiver selon les besoins de la propriété (HR, Livraison, Intégrations, Accounting, Clôture)

---

## 2. Téléchargements & prérequis

Identiques à un déploiement ASI standard :

| Outil | Lien | Notes |
|-------|------|--------|
| **Git** | https://git-scm.com/download/win | Cloner le repo |
| **Node.js LTS (20+)** | https://nodejs.org/en/download | SPA, gateway, print, loyverse-sync |
| **Docker Desktop** (recommandé) | https://www.docker.com/products/docker-desktop/ | Compose : Surreal + sidecars |
| **SurrealDB** | https://surrealdb.com/docs/running/installation/windows | Script : `iwr https://windows.surrealdb.com -useb \| iex` |
| **nginx** | https://nginx.org/en/download.html | Reverse-proxy HTTPS `/` → SPA, `/auth`+`/rpc` → gateway |
| **mkcert** | https://github.com/FiloSottile/mkcert | HTTPS LAN pour l'impression — voir [printing/README.md](../../printing/README.md) |
| **Chrome** | https://www.google.com/chrome/ | Tablettes / kiosks |

---

## 3. Récupérer le code

```powershell
cd C:\CODE   # ou équivalent
git clone https://github.com/schneiderjoseph/restaurant-pos.git
cd restaurant-pos
git checkout main
git pull fork main
```

---

## 4. Secrets & fichiers `.env`

**Ne jamais committer** les vrais `.env`.

### 4.1 Générer un JWT fort

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> Hex **sans** caractère `$` (Compose interprète `$VAR`).

### 4.2 Fichiers à créer

```powershell
Copy-Item .env.example .env
Copy-Item gateway\.env.example gateway\.env
Copy-Item loyverse-sync\.env.example loyverse-sync\.env
```

### 4.3 Racine `.env` — profil Loyverse

```env
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

GATEWAY_JWT_SECRET=PASTE_HEX_48_BYTES_HERE
GATEWAY_ALLOWED_ORIGINS=http://<PROPERTY_LAN_IP>,https://<PROPERTY_LAN_IP>,http://localhost,http://127.0.0.1
GATEWAY_ALLOW_LAN=true

VITE_GATEWAY_AUTH=true
VITE_DB_WEBDOCKET=ws://<PROPERTY_LAN_IP>/rpc
# Si HTTPS : wss://<PROPERTY_LAN_IP>/rpc

VITE_LOCALE=fr-HT
VITE_DEFAULT_LANGUAGE=fr
VITE_APP_TIMEZONE=America/Port-au-Prince
VITE_CURRENCY=HTG
# VITE_SECONDARY_CURRENCY=USD
VITE_DECIMAL_PLACES=0

VITE_PRINT_SERVER_URL=http://<PROPERTY_LAN_IP>:3132
VITE_PROTECT_MODULES_SOURCE=server

# --- Profil catalogue ---
VITE_POS_MODE=loyverse
VITE_RESORT_FB=false
# → true seulement si chambres suivies via PMS on-site (voir §7)

# --- Modules ---
VITE_MODULE_HR=false
VITE_MODULE_DELIVERY=false
VITE_MODULE_INTEGRATIONS=false
VITE_MODULE_ACCOUNTING=false
VITE_MODULE_CLOSING=false

VITE_RESTAURANT_NAME=
VITE_RESTAURANT_ADDRESS=
VITE_RESTAURANT_PHONE=
```

**Important :** tout changement `VITE_*` → **rebuild** de la SPA (`npm run build`).

### 4.4 `gateway/.env`

Reprendre `gateway/.env.example` en changeant :

```env
SURREAL_NS=loyverse
SURREAL_DB=loyverse
```

(le reste — port `3142`, `SURREAL_URL=ws://127.0.0.1:8000/rpc`, JWT secret — identique à un déploiement standard).

### 4.5 `loyverse-sync/.env`

```env
LOYVERSE_ACCESS_TOKEN=PASTE_PAT_FROM_BACK_OFFICE
LOYVERSE_STORE_ID=
LOYVERSE_MENU_SYNC=1
LOYVERSE_CUSTOMER_SYNC=1
LOYVERSE_PAYMENT_SYNC=1
LOYVERSE_DISCOUNT_SYNC=1
LOYVERSE_MODIFIER_SYNC=1

SURREAL_URL=ws://127.0.0.1:8000/rpc
LOYVERSE_SURREAL_NS=loyverse
LOYVERSE_SURREAL_DB=loyverse
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

LOYVERSE_SYNC_INTERVAL_MS=60000
LOYVERSE_SYNC_ONCE=0
```

PAT : Back Office Loyverse → Access Tokens (scopes lecture catégories/items/taxes/modifiers/clients/moyens de paiement — voir [LOYVERSE.md §1](../integrations/LOYVERSE.md)).

Règles dures (déjà imposées par le code, pas juste une recommandation) :

1. `LOYVERSE_SURREAL_NS` / `LOYVERSE_SURREAL_DB` doivent rester `loyverse`/`loyverse` — le poller et le webhook server refusent `posr`/`posr`.
2. Ne jamais mettre `LOYVERSE_ACCESS_TOKEN` dans un `.env` Vite (racine) — server-side uniquement.

---

## 5. Démarrage services

### Option A — Docker Compose (recommandé)

```powershell
cd C:\CODE\restaurant-pos
docker compose up -d surrealdb gateway printer
```

Surreal = `127.0.0.1:8000` (pas exposé LAN).

### Option B — Surreal native + Node sidecars

```powershell
surreal start --user posr_prod_user --pass CHANGE_ME_STRONG surrealkv://C:/DATA/loyverse-database --bind 127.0.0.1:8000
```

```powershell
npm --prefix gateway install ; npm --prefix gateway start
npm --prefix printing install ; npm --prefix printing start
```

### Build SPA

```powershell
npm install
npm run build
# Servir dist/ via nginx sur 0.0.0.0:80 (accessible tablettes via IP LAN)
```

### Bootstrap DB + premier sync (une seule commande fait tout le schéma)

```powershell
cd loyverse-sync
npm install
npm run bootstrap-db     # applique migrations/latest.surql + champs Loyverse (idempotent)
npm run once             # premier fetch + projection
```

Puis boucle continue (1 instance) :

```powershell
npm start
```

Ordre de boot conseillé : **Surreal → gateway → bootstrap-db (une fois) → loyverse-sync → nginx/SPA**.

### Vérifications avant ouverture

```powershell
cd loyverse-sync
npm run verify-mirror     # compare compteurs API Loyverse vs mirror local
node scripts/verify-isolation.js   # confirme que posr/posr est propre et loyverse/loyverse peuplé
```

---

## 6. Premier utilisateur / rôle Master

Une base neuve n'a aucun utilisateur. Créer le premier compte admin (PIN + rôle Master avec toutes les permissions, y compris `settings.restaurant_profile`) — voir [ADMIN-USERS.md](../user-guide/ADMIN-USERS.md) et [LOGIN.md](../user-guide/LOGIN.md).

---

## 7. Chambres / guests via PMS on-site (optionnel)

Seulement si cette propriété a un PMS on-site avec chambres à suivre. Dans ce cas, `asi-sync` tourne **en plus**, en mode « rooms only » — jamais le menu :

```env
# asi-sync/.env sur cette machine
ASI_MENU_SYNC=0
ASI_TABLE_SYNC=0
ASI_FD_SYNC=1
ASI_ROOM_SYNC=1
ASI_FD_SQL_SERVER=<PMS_LAN_IP>
ASI_FD_SQL_PORT=<PMS_SQL_PORT>
ASI_FD_SQL_DATABASE=<PMS_DB_NAME>
ASI_FD_SQL_USER=<read-only login>
ASI_FD_SQL_PASSWORD=

SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NS=loyverse
SURREAL_DB=loyverse
```

Mettre `VITE_RESORT_FB=true` côté racine `.env` (+ rebuild) pour afficher la recherche guest / plan Chambres.

Si cette propriété n'a pas de chambres à suivre : ignorer cette section entièrement, `VITE_RESORT_FB=false` suffit.

---

## 8. Checklist smoke test prod

- [ ] Login PIN (gateway on) OK
- [ ] Menu Loyverse (plats / prix / catégories) cohérent avec le Back Office
- [ ] Clients / moyens de paiement / discounts synchronisés
- [ ] `npm run verify-mirror` sans écart significatif
- [ ] Cuisine / Order Display
- [ ] Impression ticket (print server)
- [ ] Logout → re-login obligatoire
- [ ] Depuis une autre machine : port Surreal `8000` **fermé**
- [ ] Si §7 activé : Plan Chambres, chambre occupée → client auto, chambre vide → refus
- [ ] Vérifié que personne n'attend un retour de vente dans le Back Office Loyverse (§ Portée de ce soir)

---

## 9. Ops quotidiens

| Action | Commande / note |
|--------|------------------|
| Rebuild UI après env | `npm run build` |
| Relancer sync catalogue | restart process `loyverse-sync` (1 instance) |
| Vérifier parité API/mirror | `npm run verify-mirror` |
| Backfill reçus (rapport lecture seule, pas de push) | `npm run backfill-receipts` |
| Backup Surreal | snapshot / export `./database` (NS/DB `loyverse`) |
| Réactiver un module | `VITE_MODULE_XXX=true` → rebuild |

---

## 10. Pièges fréquents

| Problème | Cause probable |
|----------|----------------|
| Modules toujours visibles | SPA pas rebuild après `.env` |
| Menu vide | `LOYVERSE_MENU_SYNC=0`, PAT invalide/expiré, ou Surreal down |
| Poller refuse de démarrer | `LOYVERSE_SURREAL_NS`/`DB` pointent sur `posr`/`posr` (protection volontaire) |
| Pas de chambres/guests | §7 non activé, ou `ASI_FD_SYNC` off |
| Ventes absentes du Back Office Loyverse | Normal — receipt-push non branché, voir portée §0 |
| Tablettes ne joignent pas | firewall 80/443, mauvaise IP dans `GATEWAY_ALLOWED_ORIGINS` / `VITE_*` |

---

## 11. Références rapides

| Ressource | URL |
|-----------|-----|
| Fork code | https://github.com/schneiderjoseph/restaurant-pos |
| Loyverse Developer hub | https://developer.loyverse.com/ |
| Loyverse API reference | https://developer.loyverse.com/docs/ |
| Surreal install | https://surrealdb.com/docs/running/installation/windows |
| Node LTS | https://nodejs.org/en/download |
| Docker Desktop | https://www.docker.com/products/docker-desktop/ |
| nginx | https://nginx.org/en/download.html |

Quand le PAT / mots de passe SQL / JWT sont figés, remplace tous les `CHANGE_ME` et confirme l'IP LAN (`ipconfig`) avant le go-live.
