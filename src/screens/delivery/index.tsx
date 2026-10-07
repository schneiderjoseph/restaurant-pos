import {TabList, Tabs} from "react-aria-components";
import {Tab, TabPanel} from "@/components/common/react-aria/tabs.tsx";
import {useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import {Delivery} from "@/screens/delivery/delivery.tsx";
import {DeliverySettings} from "@/screens/delivery/settings.tsx";
import {Layout} from "@/screens/partials/layout.tsx";
import {DeliveryAreas} from "@/screens/delivery/delivery.areas.tsx";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import { useModuleAccess } from "@/providers/module-access.provider.tsx";
import {
  filterKeysByModuleAccess,
  resolveVisibleSelection,
} from "@/lib/module-access.ts";
import { NoAccessibleTabs } from "@/components/common/no-accessible-tabs.tsx";
import ScrollContainer from "react-indiana-drag-scroll";

/** Stable permission codes stored in user roles — not translated labels. */
const DELIVERY_TAB_MODULES: Record<string, string> = {
  delivery: 'delivery.orders',
  areas: 'delivery.areas',
  settings: 'delivery.settings',
};

export const Index = () => {
  const { t } = useTranslation('delivery');
  const { t: tNav } = useTranslation('navigation');
  const [selected, setSelected] = useState<string | null>(null);
  const {protectAction} = useSecurity();
  const { ready, can } = useModuleAccess();

  const pages = useMemo(() => ({
    'delivery': {component: <Delivery/>, title: t('tabs.delivery')},
    'areas': {component: <DeliveryAreas/>, title: t('tabs.areas')},
    'settings': {component: <DeliverySettings/>, title: t('tabs.settings')},
  }), [t]);

  const pageKeys = useMemo(() => Object.keys(pages), [pages]);

  const visibleKeys = useMemo(() => {
    if (!ready) return [] as string[];
    return filterKeysByModuleAccess(pageKeys, DELIVERY_TAB_MODULES, can);
  }, [ready, can, pageKeys]);

  const effectiveSelected = resolveVisibleSelection(selected, visibleKeys);

  useEffect(() => {
    if (effectiveSelected != null && effectiveSelected !== selected) {
      setSelected(effectiveSelected);
    }
  }, [effectiveSelected, selected]);

  const titleParts = effectiveSelected
    ? [pages[effectiveSelected]?.title, tNav('sidebar.delivery')]
    : [tNav('sidebar.delivery')];

  return (
    <Layout>
      <DocumentTitle parts={titleParts} />
      <div data-testid="delivery-page">
      {!ready ? null : visibleKeys.length === 0 ? (
        <NoAccessibleTabs />
      ) : (
      <Tabs
        className="w-full flex flex-col rounded-xl"
        selectedKey={effectiveSelected ?? undefined}
        onSelectionChange={(key: string) => {
          protectAction(() => setSelected(key), {
            module: DELIVERY_TAB_MODULES[key],
            description: t('security.accessTab', { module: pages[key].title })
          });
        }}
      >
        <ScrollContainer mouseScroll hideScrollbars={false} className="flex-grow-0 flex-shrink">
          <TabList aria-label="Tabs"
                   className="flex flex-row gap-3 px-1 py-3 flex-nowrap"
                   data-testid="delivery-tabs">
            {visibleKeys.map(key => (
              <Tab id={key} key={key} data-testid={`delivery-tab-${key}`}>{pages[key].title}</Tab>
            ))}
          </TabList>
        </ScrollContainer>
        {visibleKeys.map((key) => (
          <TabPanel id={key} key={key} className="bg-white shadow flex-grow flex-shrink-0">
            <div>
              {pages[key].component}
            </div>
          </TabPanel>
        ))}
      </Tabs>
      )}
      </div>
    </Layout>
  )
}
