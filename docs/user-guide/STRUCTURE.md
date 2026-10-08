# POSR Documentation structure

Generated from `docs-automation/guide-catalog.mjs` (edit the catalog, not this file by hand).

```
POSR Documentation
│
├── 📘 Server Guide
│   ├── Getting started [planned]
│   ├── Guest, room or table [planned]
│   ├── Taking the order [planned]
│   ├── Cart and sending [planned]
│   ├── Following orders [planned]
│   ├── Changing a sent order [planned]
│   ├── Bill, split and payment [planned]
│   └── Working as a DUO [planned]
│
├── 📗 Cashier and Manager Guide
│   ├── Cashing and authorizations [planned]
│   ├── Approving changes to sent orders [planned]
│   ├── Summary
│   ├── Closing
│   ├── Reports (operations)
│   ├── Tip distribution
│   └── Delivery
│
├── 📺 Screens Guide
│   ├── Setting up a screen [planned]
│   ├── Preparation station [planned]
│   └── Order display [planned]
│
├── 📓 Administrator Guide
│   ├── Manage overview
│   ├── Users and roles
│   ├── Role rights that change the floor [planned]
│   ├── Menus, categories, and dishes
│   ├── Points of sale [planned]
│   ├── Floors and tables
│   ├── Kitchens and workflows
│   ├── Printers and print settings
│   ├── Payment types, taxes, and order types
│   ├── Discounts and coupons
│   ├── Customers [planned]
│   ├── General settings
│   ├── Settings
│   └── Integrations
│
└── 📕 Accounts Guide
    ├── Accounts overview
    ├── Journal entries and account groups
    └── Ledgers, P&L, and cash flow
```

## Build output

| Path | Description |
|------|-------------|
| `dist/{lang}/index.html` | Documentation hub |
| `dist/{lang}/{guide}/user-guide.html` | Role guide HTML |
| `dist/{lang}/{guide}/posr-*-guide.pdf` | Role guide PDF |
