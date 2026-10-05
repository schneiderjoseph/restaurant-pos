import {PropsWithChildren} from "react";
import {RestaurantProfileSettingsCard} from "@/components/user_settings/restaurant_profile.tsx";
import {CurrencySymbolSettingsCard} from "@/components/user_settings/currency_symbol.tsx";
import {TranslateReceiptsSettingsCard} from "@/components/user_settings/translate_receipts.tsx";
// Printer routing is moving to the print router; the default/system printers card stays hidden.
// import {Printersettings} from "@/components/user_settings/printers.tsx";
import {PrintOptionsSettingsCard} from "@/components/user_settings/print_options.tsx";
import {MenusSettings} from "@/components/user_settings/menus.tsx";
import {AsiOutletsSettingsCard} from "@/components/user_settings/asi_outlets.tsx";
import {ServiceChargesSettings} from "@/components/user_settings/service_charges.tsx";
import {ClosingCycleSettingsCard} from "@/components/user_settings/closing_cycle.tsx";
import {AutoCheckCloseSettingsCard} from "@/components/user_settings/auto_check_close.tsx";
import {SessionSecuritySettingsCard} from "@/components/user_settings/session_security.tsx";
import {AutoClockOutSettingsCard} from "@/components/user_settings/auto_clock_out.tsx";
import {ShowInclusivePricesSettingsCard} from "@/components/user_settings/show_inclusive_prices.tsx";
import {InventorySettingsCard} from "@/components/user_settings/inventory_settings.tsx";
import {ItemsVisibilityConfig} from "@/components/user_settings/items_visibility_config.tsx";
import {OrderVisibilitySettingsCard} from "@/components/user_settings/order_visibility.tsx";
import {OrderDisplayAccessSettingsCard} from "@/components/user_settings/order_display_access.tsx";

function MasonryItem({ children }: PropsWithChildren) {
  return <div className="break-inside-avoid mb-5">{children}</div>;
}

/**
 * Settings the admin manages: establishment-wide rows shared by every user and
 * terminal, plus the per-device items visibility, set by the admin on each
 * terminal. Settings keeps only personal preferences.
 */
export const AdminGeneralSettings = () => (
  <div className="columns-1 md:columns-2 lg:columns-3 gap-5 p-5" data-testid="admin-general-settings">
    <MasonryItem><RestaurantProfileSettingsCard /></MasonryItem>
    <MasonryItem><CurrencySymbolSettingsCard /></MasonryItem>
    <MasonryItem><TranslateReceiptsSettingsCard /></MasonryItem>
    {/* <MasonryItem><Printersettings /></MasonryItem> */}
    <MasonryItem><PrintOptionsSettingsCard /></MasonryItem>
    <MasonryItem><MenusSettings /></MasonryItem>
    {/* Carries its own masonry wrapper: it renders nothing where ASI is not synced. */}
    <AsiOutletsSettingsCard />
    <MasonryItem><ServiceChargesSettings /></MasonryItem>
    <MasonryItem><ClosingCycleSettingsCard /></MasonryItem>
    <MasonryItem><AutoCheckCloseSettingsCard /></MasonryItem>
    <MasonryItem><SessionSecuritySettingsCard /></MasonryItem>
    <MasonryItem><OrderVisibilitySettingsCard /></MasonryItem>
    <MasonryItem><OrderDisplayAccessSettingsCard /></MasonryItem>
    <MasonryItem><AutoClockOutSettingsCard /></MasonryItem>
    <MasonryItem><ShowInclusivePricesSettingsCard /></MasonryItem>
    <MasonryItem><InventorySettingsCard /></MasonryItem>
    <MasonryItem><ItemsVisibilityConfig /></MasonryItem>
  </div>
);
