# 00 — Overview

> What this project **is**. No progress, no counters, no plans — those live in the registries
> and the tracker (`MEM-007`).

## What it is

Restaurant POS (point of sale) for staff: take orders, kitchen/order display, payments,
inventory, HR, accounts, reports, and integrations against a SurrealDB backend.

## Who uses it

Restaurant staff and managers signed in with PIN/password; roles carry permission module
lists. Permissions detail goes in `04_PERMISSIONS.md`.

## What someone is meant to do here

Take and complete guest orders (menu → payment). Secondary: run the restaurant day
(kitchen, closing, inventory, HR, reports).

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Language / runtime | TypeScript / Node | Vite app |
| Framework | React + React Router | |
| Data store | SurrealDB | Via gateway / websocket |
| Frontend | React + Vite + Jotai + react-i18next | |
| Hosting / deploy | TODO(devia) | |
| CI | TODO(devia) | |

## Modules

| Module | Responsibility | Where |
|---|---|---|
| Access / permissions | Role modules, protectAction, nav/tab visibility | `src/lib/access.rules.ts`, `src/lib/module-access.ts`, `src/providers/module-access.provider.tsx` |
| POS screens | Menu, orders, kitchen, closing, … | `src/screens/` |
| Admin / settings | Dishes, floors, users, printers, … | `src/screens/admin`, `src/components/settings` |
| Inventory / HR / Accounts | Optional feature-flagged modules | `src/screens/inventory`, `hr`, `accounts` |

## Non-goals

TODO(devia): what this project deliberately does **not** do. This is the cheapest way to stop an
agent from helpfully building the wrong thing.

## Where the truth lives

| Question | Source of truth |
|---|---|
| Product intent | TODO(devia) |
| Data model | TODO(devia) |
| Permissions | TODO(devia) |
| API contract | TODO(devia) |
| Design tokens | TODO(devia) |

This memory **points** at those documents. It never copies them (`MEM-008`).
