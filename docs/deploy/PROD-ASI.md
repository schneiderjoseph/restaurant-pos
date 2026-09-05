# Guide déploiement prod — profil ASI (POSR + Resort F&B)

Checklist pratique pour installer / préparer l’environnement **production** du POS restaurant en mode **Resort F&B + sync ASI**.

## Topologie (confirmée)

**Tout sur le même PC** : ASI POS + ASI FrontDesk (PMS) + **POSR**.

```text
┌─────────────────────────────────────────────────────────┐
│  PMS_HOST  (ex. <PROPERTY_LAN_IP>)                      │
│                                                         │
│  ASI POS (ASIPOS600)  +  ASI FrontDesk (ASIFD600)       │
│           │                        │                    │
│           └──────── SQL :56479 ────┘                    │
│                      │                                  │
│                 asi-sync (localhost)                    │
│                      │                                  │
│                 SurrealDB :8000 (loopback)              │
│                      │                                  │
│            gateway / nginx / SPA POSR                   │
└──────────────────────┬──────────────────────────────────┘
                       │ LAN (tablettes Chrome)
                       ▼
              http(s)://<PROPERTY_LAN_IP>  (ou nom DNS)
```

Conséquences :

- `asi-sync` parle à SQL en **`127.0.0.1`** (ou `localhost`) — pas besoin d’ouvrir SQL au LAN pour le sync.
- Les **tablettes** n’ouvrent que l’UI POSR (nginx / Vite) sur l’IP LAN du PC.
- Surreal reste en **127.0.0.1:8000** (jamais exposé au LAN).
- Un seul poller `asi-sync` sur cette machine.
- Surveille CPU/RAM : ASI + SQL + Docker/Node + Surreal cohabitent.

Docs liées :

- [Gateway / sécurité](../security/GATEWAY.md)
- [ASI discovery / mapping SQL](../integrations/ASI-DISCOVERY.md) *(hôte = **PMS_HOST**)*
- Exemples env : [`.env.example`](../../.env.example), [`asi-sync/.env.example`](../../asi-sync/.env.example), [`gateway/.env.example`](../../gateway/.env.example)

---

## 1. Ce que tu déploies (sur ce même PC)

| Composant | Rôle | Port typique |
|-----------|------|--------------|
| **SPA POSR** (build Vite) | UI tablettes / caisse | 80/443 via nginx (LAN) |
| **SurrealDB** | Base POS (menu, commandes, clients…) | `8000` **loopback only** |
| **Gateway** | Auth + `/auth` + `/rpc` | `3142` (derrière nginx) |
| **API** | Sidecar (AI, etc.) | `3140` |
| **Print server** | ESC/POS | `3132` |
| **Payment** (optionnel) | Paiements | `3134` |
| **Tracking** (optionnel) | Logs activité | `3138` |
| **asi-sync** (poller) | Menu + tables + guests + chambres ASI → Surreal | process Node |

**Déjà présents sur le PC (ne pas casser) :** ASI POS, ASI FrontDesk, SQL Server `ASI2017`.

**Profil ASI / Resort F&B (build) :**

- `VITE_POS_MODE=asi`
- `VITE_RESORT_FB=true`
- Modules off : HR, Livraison, Intégrations, Accounting, Clôture

---

## 2. Téléchargements & prérequis

Installe **sur PMS_HOST** (le PC qui a déjà POS + PMS). Les tablettes = navigateur seulement.

### 2.1 Obligatoire

| Outil | Lien | Notes |
|-------|------|--------|
| **Git** | https://git-scm.com/download/win | Cloner le repo |
| **Node.js LTS (20+)** | https://nodejs.org/en/download | SPA, gateway, api, print, asi-sync |
| **Docker Desktop** (recommandé) | https://www.docker.com/products/docker-desktop/ | Compose : Surreal + sidecars — vérifier que Docker ne conflict pas avec ASI |
| **SurrealDB** | Install Windows : https://surrealdb.com/docs/running/installation/windows | Script : `iwr https://windows.surrealdb.com -useb \| iex` |
| **SurrealDB releases** | https://surrealdb.com/releases | Aligné compose : image `surrealdb/surrealdb:v3.0.5` dans `docker-compose.yml` |
| **Docker Hub Surreal** | https://hub.docker.com/r/surrealdb/surrealdb | Si tu restes 100 % Docker |

PowerShell (Surreal native Windows) :

```powershell
iwr https://windows.surrealdb.com -useb | iex
surreal version
```

### 2.2 Utile / optionnel

| Outil | Lien | Notes |
|-------|------|--------|
| **Bun** | https://bun.sh | Optionnel ; en prod un build `npm`/`node` suffit |
| **nginx** | https://nginx.org/en/download.html | Reverse-proxy HTTPS `/` → SPA, `/auth`+`/rpc` → gateway |
| **mkcert** (print HTTPS LAN) | https://github.com/FiloSottile/mkcert | Voir [printing/README.md](../../printing/README.md) |
| **SSMS / Azure Data Studio** | https://learn.microsoft.com/sql/ssms/download-sql-server-management-studio-ssms | Vérifier SQL local |
| **Chrome** | https://www.google.com/chrome/ | Tablettes / kiosks |

### 2.3 ASI déjà sur ce PC

| Élément | Valeur |
|---------|--------|
| Hostname | `PMS_HOST` |
| LAN (tablettes → POSR) | `<PROPERTY_LAN_IP>` *(confirmer `ipconfig`)* |
| Instance SQL | `ASI2017` |
| Port TCP SQL | **56479** |
| DB menu POS | **`ASIPOS600`** |
| DB FrontDesk | **`ASIFD600`** |
| Accès sync depuis POSR | **`127.0.0.1,56479`** (même machine) |
| Vendor | https://anandsystems.com / https://asifrontdesk.com |

Détail tables : [ASI-DISCOVERY.md](../integrations/ASI-DISCOVERY.md) § PMS_HOST.

**Firewall (même PC) :**

- Ouvrir au LAN : **80/443** (nginx SPA) — éventuellement `3132` print si tablettes/imprimantes distantes.
- **Ne pas** exposer Surreal `8000` ni SQL `56479` au LAN (asi-sync reste en localhost).
- Ports POSR (`3142`, etc.) : préférer derrière nginx ; sinon autoriser seulement le subnet tablettes.

---

## 3. Récupérer le code

Sur **PMS_HOST** :

```powershell
cd C:\CODE   # ou C:\POSR, etc.
git clone https://github.com/schneiderjoseph/restaurant-pos.git
cd restaurant-pos
git checkout main
git pull fork main   # si remote fork déjà configuré
```

Fork GitHub : https://github.com/schneiderjoseph/restaurant-pos

---

## 4. Secrets & fichiers `.env`

**Ne jamais committer** les vrais `.env` (passwords, JWT, SQL).

### 4.1 Générer un JWT fort

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> Hex **sans** caractère `$` (Compose interprète `$VAR`).

### 4.2 Fichiers à créer

| Fichier | Depuis | Usage |
|---------|--------|--------|
| `.env` | `.env.example` | Build SPA + Docker Compose |
| `gateway/.env` | `gateway/.env.example` | Gateway (même `GATEWAY_JWT_SECRET` / Surreal) |
| `asi-sync/.env` | `asi-sync/.env.example` | Poller ASI local → Surreal local |
| `api/.env` | `api/.env.example` | Si API utilisée |
| `payments/.env` | `payments/.env.example` | Si paiements |

```powershell
Copy-Item .env.example .env
Copy-Item gateway\.env.example gateway\.env
Copy-Item asi-sync\.env.example asi-sync\.env
Copy-Item api\.env.example api\.env
```

### 4.3 Racine `.env` — profil ASI / Resort F&B (même PC)

Les tablettes utilisent l’**IP LAN** du PC (ex. `<PROPERTY_LAN_IP>`). Adapte le domaine si tu en as un.

```env
# --- Surreal (doit matcher la DB existante si déjà créée) ---
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

# --- Gateway (partagé gateway + print + payment + tracking + api) ---
GATEWAY_JWT_SECRET=PASTE_HEX_48_BYTES_HERE
# Origines tablettes + navigateur local
GATEWAY_ALLOWED_ORIGINS=http://<PROPERTY_LAN_IP>,https://<PROPERTY_LAN_IP>,http://localhost,http://127.0.0.1
GATEWAY_ALLOW_LAN=true

VITE_GATEWAY_AUTH=true
# Derrière nginx sur ce PC (même origine = IP LAN)
# VITE_GATEWAY_URL=http://<PROPERTY_LAN_IP>
VITE_DB_WEBDOCKET=ws://<PROPERTY_LAN_IP>/rpc
# Si HTTPS : wss://<PROPERTY_LAN_IP>/rpc

VITE_LOCALE=fr-HT
VITE_DEFAULT_LANGUAGE=fr
VITE_APP_TIMEZONE=America/Port-au-Prince
VITE_CURRENCY=HTG
# VITE_SECONDARY_CURRENCY=USD
VITE_DECIMAL_PLACES=0

VITE_PRINT_SERVER_URL=http://<PROPERTY_LAN_IP>:3132
VITE_API_SERVER_URL=http://<PROPERTY_LAN_IP>:3140
VITE_TRACKING_SERVER_URL=http://<PROPERTY_LAN_IP>:3138
VITE_TRACKING_ENABLED=true
VITE_PROTECT_MODULES_SOURCE=server

# --- Profil Resort / ASI ---
VITE_POS_MODE=asi
VITE_RESORT_FB=true

# --- Modules masqués (remettre true pour réactiver + rebuild) ---
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

### 4.4 `asi-sync/.env` — SQL en localhost (même PC)

```env
# Menu + tables ASI (SQL local sur PMS_HOST)
ASI_SQL_SERVER=127.0.0.1
ASI_SQL_PORT=56479
ASI_SQL_DATABASE=ASIPOS600
ASI_SQL_USER=posr_sync
ASI_SQL_PASSWORD=CHANGE_ME
ASI_SQL_ENCRYPT=false
ASI_SQL_TRUST_CERT=true
ASI_MENU_SYNC=1
ASI_TABLE_SYNC=1
# ASI_POS_ID=2

# FrontDesk guests + chambres (même SQL local)
ASI_FD_SYNC=1
ASI_ROOM_SYNC=1
ASI_FD_SQL_SERVER=127.0.0.1
ASI_FD_SQL_PORT=56479
ASI_FD_SQL_DATABASE=ASIFD600
ASI_FD_SQL_USER=posr_fd_sync
ASI_FD_SQL_PASSWORD=CHANGE_ME
ASI_FD_SQL_ENCRYPT=false
ASI_FD_SQL_TRUST_CERT=true

# Surreal sur le même PC
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NS=posr
SURREAL_DB=posr
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

ASI_SYNC_INTERVAL_MS=30000
ASI_SYNC_ONCE=0
```

Si `127.0.0.1` refuse la connexion SQL, teste `localhost` ou `.\ASI2017` selon la config SQL Browser ; le port **56479** reste la référence découverte.

Règles dures :

1. **Un seul** poller `asi-sync` sur ce PC.
2. `SURREAL_URL` = Surreal **locale** de ce POSR seulement.
3. Ne pas pointer une autre machine / autre DB Surreal « fork ».
4. Activer `ASI_*_SYNC=1` seulement quand SQL ASI tourne déjà.

---

## 5. Démarrage services

### Option A — Docker Compose (recommandé, sur PMS_HOST)

```powershell
cd C:\CODE\restaurant-pos
docker compose up -d surrealdb gateway api printer tracking payment
```

Voir [`docker-compose.yml`](../../docker-compose.yml). Surreal = `127.0.0.1:8000` (pas exposé LAN).  
Vérifie que Docker Desktop a assez de RAM sans freiner ASI/SQL.

### Option B — Surreal native + Node sidecars (même PC)

```powershell
# Exemple Surreal (adapte user/pass/chemin data — dossier dédié, pas dans les data ASI)
surreal start --user posr_prod_user --pass CHANGE_ME_STRONG surrealkv://C:/DATA/posr-database --bind 127.0.0.1:8000
```

Puis services Node (services Windows / NSSM / Task Scheduler au boot) :

```powershell
npm --prefix gateway install ; npm --prefix gateway start
npm --prefix api install ; npm --prefix api start
npm --prefix printing install ; npm --prefix printing start
npm --prefix tracking-api install ; npm --prefix tracking-api start
```

### Build SPA

```powershell
npm install
npm run build
# Servir dist/ via nginx sur 0.0.0.0:80 (accessible tablettes via IP LAN)
```

Nginx : proxy `/auth/` et `/rpc` → gateway `3142` (voir [GATEWAY.md](../security/GATEWAY.md) + `nginx.conf` du repo).

### Poller ASI (SQL local → Surreal local)

```powershell
npm --prefix asi-sync install
# Test une fois (ASI SQL doit tourner) :
npm run asi-sync:once
# Puis boucle (1 instance, démarrer après SQL + Surreal) :
npm run asi-sync
```

Ordre de boot conseillé : **SQL ASI → Surreal → gateway/sidecars → asi-sync → nginx/SPA**.

---

## 6. Migrations / seed

Si DB neuve : appliquer les migrations Surreal du dossier [`migrations/`](../../migrations/) (dont champs ASI tables/rooms/customers).  
Ne pas réutiliser une `./database` créée avec d’anciens `root`/`root` sans aligner `SURREAL_USER` / `SURREAL_PASS` ([GATEWAY.md](../security/GATEWAY.md)).

PIN / rôles : s’assurer qu’un rôle Master a les permissions nécessaires (voir migrations Master permissions).

---

## 7. Checklist smoke test prod

- [ ] Login PIN (gateway on) OK  
- [ ] Nav **sans** HR / Livraison / Intégrations / Accounting / Clôture  
- [ ] Guest lookup : clients **in-house** PMS (PMS_HOST) visibles  
- [ ] Walk-in : prénom + nom → code auto → commande  
- [ ] Plan **Salle** : tables T…  
- [ ] Plan **Chambres** : R… ; chambre occupée → client auto ; chambre vide → refus  
- [ ] Menu ASI (plats / prix) cohérent  
- [ ] Cuisine / Order Display  
- [ ] Impression ticket (print server)  
- [ ] Logout → re-login obligatoire  
- [ ] Depuis une autre machine : port Surreal `8000` **fermé**  

---

## 8. Ops quotidiens

| Action | Commande / note |
|--------|------------------|
| Rebuild UI après env | `npm run build` |
| Relancer sync | restart process `asi-sync` (1 instance) |
| Logs sync | console du poller |
| Backup Surreal | snapshot / copie volume `./database` ou export Surreal |
| Réactiver un module | `VITE_MODULE_XXX=true` → rebuild |

---

## 9. Pièges fréquents

| Problème | Cause probable |
|----------|----------------|
| Modules toujours visibles | SPA pas rebuild après `.env` |
| Pas de guests / chambres | `ASI_FD_SYNC` off, SQL local down, ou mauvais user SQL |
| Menu vide | `ASI_MENU_SYNC=0`, Surreal down, ou sync vers mauvaise DB |
| Tablettes ne joignent pas | firewall 80/443, mauvaise IP dans `GATEWAY_ALLOWED_ORIGINS` / `VITE_*` |
| PC lent | Docker + ASI + SQL + Surreal — réduire RAM Docker ou passer Surreal native |
| Clock-in qui revient | `VITE_MODULE_HR` pas à `false` au **build** |

---

## 10. Contacts / références rapides

| Ressource | URL |
|-----------|-----|
| Fork code | https://github.com/schneiderjoseph/restaurant-pos |
| Surreal install | https://surrealdb.com/docs/running/installation/windows |
| Surreal releases | https://surrealdb.com/releases |
| Node LTS | https://nodejs.org/en/download |
| Docker Desktop | https://www.docker.com/products/docker-desktop/ |
| nginx | https://nginx.org/en/download.html |
| Doc ASI / PMS_HOST | [ASI-DISCOVERY.md](../integrations/ASI-DISCOVERY.md) |

Quand les mots de passe SQL / JWT sont figés, remplace tous les `CHANGE_ME` et confirme l’IP LAN (`ipconfig`) avant le go-live sur **PMS_HOST**.
