# POSR Documentation structure

Generated from `docs-automation/guide-catalog.mjs` (edit the catalog, not this file by hand).

```
POSR Documentation
│
├── 📘 Employee Guide
│   ├── Login
│   ├── Menu and order taking
│   ├── Cart
│   ├── Payment screen
│   ├── Orders
│   ├── Session lock and logout
│   ├── Settings
│   ├── Tables and dine-in
│   └── Security re-authentication
│
├── 📗 Manager Guide
│   ├── Summary
│   ├── Kitchen
│   ├── Order display
│   ├── Delivery
│   ├── Closing
│   ├── Reports (operations)
│   ├── Tip oversight
│   └── Tip distribution
│
├── 📕 Accounts Guide
│   ├── Accounts overview
│   ├── Journal entries and account groups
│   └── Ledgers, P&L, and cash flow
│
└── 📓 Administrator Guide
    ├── Manage overview
    ├── Menus, categories, and dishes
    ├── Floors and tables
    ├── Discounts and coupons
    ├── Kitchens and workflows
    ├── Printers and print settings
    ├── Payment types, taxes, and order types
    ├── Users and roles
    ├── Reports hub (administrator packs)
    ├── Integrations
    └── General settings
```

## Build output

| Path | Description |
|------|-------------|
| `dist/{lang}/index.html` | Documentation hub |
| `dist/{lang}/{guide}/user-guide.html` | Role guide HTML |
| `dist/{lang}/{guide}/posr-*-guide.pdf` | Role guide PDF |
