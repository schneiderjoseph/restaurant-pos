# 06 — Integrations

> External services this project depends on. Secret **names** only — never values (`SEC-002`).

| Service | Used for | Environment variable | Failure behaviour |
|---|---|---|---|
| ASI FrontDesk (`ASIFD600`, read-only, via `asi-sync`) | In-house guests polled every 30 s into `customer:asi_fd_{checkInID}`: name, room, folio, `in_house`, `asi_synced_at`, planned departure `asi_date_out` (YYYY-MM-DD). A stay that leaves `isCheckOut = 0` is set `in_house = false` | `ASI_FD_SYNC`, `ASI_FD_SQL_SERVER`, `ASI_FD_SQL_PORT`, `ASI_FD_SQL_DATABASE`, `ASI_FD_SQL_USER`, `ASI_FD_SQL_PASSWORD`, `ASI_SYNC_INTERVAL_MS` | Fails closed for money: once `asi_synced_at` is older than 5 min (`ROOM_SYNC_MAX_AGE_MS`) no room charge passes |

## Webhooks in

| Provider | Verification | Idempotency key | Handler |
|---|---|---|---|
| TODO(devia) | | | |

Signature verified against the raw body, stale timestamps rejected, replays are no-ops
(`SEC-007`).

## When one is down

- **ASI FrontDesk sync down** → fail closed: the Room tender is refused for every guest
  ("Séjour non vérifiable — paiement direct"); cash and card still work. Decided by Joseph on
  2026-10-02: a guest whose stay cannot be confirmed pays like a walk-in.
