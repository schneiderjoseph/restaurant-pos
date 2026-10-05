import { Layout } from "@/screens/partials/layout.tsx";
import {CacheSettings} from "@/components/user_settings/cache.tsx";
import {TouchSettings} from "@/components/user_settings/touch.tsx";
import {TableSelectionSettings} from "@/components/user_settings/table_selection.tsx";
import {ReadyAlertTestSettings} from "@/components/user_settings/ready_alert_test.tsx";
import {LanguageSettings} from "@/components/user_settings/language.tsx";
import {useTranslation} from "react-i18next";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import {PropsWithChildren} from "react";

function MasonryItem({ children }: PropsWithChildren) {
  return <div className="break-inside-avoid mb-5">{children}</div>;
}

/** Personal preferences. Everything the admin manages lives under Manage > General settings. */
export const Settings = () => {
  const {t: tNav} = useTranslation('navigation');

  return (
    <Layout containerClassName="p-5">
      <DocumentTitle parts={[tNav('sidebar.settings')]} />
      {/* Columns must not sit on the max-height Layout pane or content is clipped to the viewport. */}
      <div className="columns-1 md:columns-2 lg:columns-3 gap-5" data-testid="settings-page">
        <MasonryItem><LanguageSettings /></MasonryItem>
        <MasonryItem><TouchSettings /></MasonryItem>
        <MasonryItem><TableSelectionSettings /></MasonryItem>
        <MasonryItem><ReadyAlertTestSettings /></MasonryItem>
        <MasonryItem><CacheSettings /></MasonryItem>
      </div>
    </Layout>
  );
}
