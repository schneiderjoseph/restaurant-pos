import { Layout } from "@/screens/partials/layout.tsx";
import {Printersettings} from "@/components/user_settings/printers.tsx";
import {CacheSettings} from "@/components/user_settings/cache.tsx";
import {TouchSettings} from "@/components/user_settings/touch.tsx";
import {TableSelectionSettings} from "@/components/user_settings/table_selection.tsx";
import {LanguageSettings} from "@/components/user_settings/language.tsx";
import {ItemsVisibilityConfig} from "@/components/user_settings/items_visibility_config.tsx";
import {WhatsNewSettingsCard} from "@/components/user_settings/whats_new.tsx";
import {useTranslation} from "react-i18next";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import {PropsWithChildren} from "react";

function MasonryItem({ children }: PropsWithChildren) {
  return <div className="break-inside-avoid mb-5">{children}</div>;
}

/** Per-user and per-device preferences. Establishment-wide settings live under Manage. */
export const Settings = () => {
  const {t: tNav} = useTranslation('navigation');

  return (
    <Layout containerClassName="p-5">
      <DocumentTitle parts={[tNav('sidebar.settings')]} />
      {/* Columns must not sit on the max-height Layout pane or content is clipped to the viewport. */}
      <div className="columns-1 md:columns-2 lg:columns-3 gap-5" data-testid="settings-page">
        <MasonryItem><WhatsNewSettingsCard /></MasonryItem>
        <MasonryItem><LanguageSettings /></MasonryItem>
        <MasonryItem><Printersettings /></MasonryItem>
        <MasonryItem><TouchSettings /></MasonryItem>
        <MasonryItem><TableSelectionSettings /></MasonryItem>
        <MasonryItem><ItemsVisibilityConfig /></MasonryItem>
        <MasonryItem><CacheSettings /></MasonryItem>
      </div>
    </Layout>
  );
}
