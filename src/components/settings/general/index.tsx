import {PropsWithChildren} from "react";
import {RestaurantProfileSettingsCard} from "@/components/user_settings/restaurant_profile.tsx";
import {CurrencySymbolSettingsCard} from "@/components/user_settings/currency_symbol.tsx";
import {TranslateReceiptsSettingsCard} from "@/components/user_settings/translate_receipts.tsx";
import {PrintOptionsSettingsCard} from "@/components/user_settings/print_options.tsx";
import {MenusSettings} from "@/components/user_settings/menus.tsx";
import {ServiceChargesSettings} from "@/components/user_settings/service_charges.tsx";
import {ClosingCycleSettingsCard} from "@/components/user_settings/closing_cycle.tsx";
import {AutoCheckCloseSettingsCard} from "@/components/user_settings/auto_check_close.tsx";
import {SessionSecuritySettingsCard} from "@/components/user_settings/session_security.tsx";
import {AutoClockOutSettingsCard} from "@/components/user_settings/auto_clock_out.tsx";
import {ShowInclusivePricesSettingsCard} from "@/components/user_settings/show_inclusive_prices.tsx";
import {InventorySettingsCard} from "@/components/user_settings/inventory_settings.tsx";

function MasonryItem({ children }: PropsWithChildren) {
  return <div className="break-inside-avoid mb-5">{children}</div>;
}

/**
 * Establishment-wide settings (global rows): every terminal and user sees the
 * same value, so they live under Manage. Per-user and per-device preferences
 * stay on the Settings screen.
 */
export const AdminGeneralSettings = () => (
  <div className="columns-1 md:columns-2 lg:columns-3 gap-5 p-5" data-testid="admin-general-settings">
    <MasonryItem><RestaurantProfileSettingsCard /></MasonryItem>
    <MasonryItem><CurrencySymbolSettingsCard /></MasonryItem>
    <MasonryItem><TranslateReceiptsSettingsCard /></MasonryItem>
    <MasonryItem><PrintOptionsSettingsCard /></MasonryItem>
    <MasonryItem><MenusSettings /></MasonryItem>
    <MasonryItem><ServiceChargesSettings /></MasonryItem>
    <MasonryItem><ClosingCycleSettingsCard /></MasonryItem>
    <MasonryItem><AutoCheckCloseSettingsCard /></MasonryItem>
    <MasonryItem><SessionSecuritySettingsCard /></MasonryItem>
    <MasonryItem><AutoClockOutSettingsCard /></MasonryItem>
    <MasonryItem><ShowInclusivePricesSettingsCard /></MasonryItem>
    <MasonryItem><InventorySettingsCard /></MasonryItem>
  </div>
);
