import { useEffect, useMemo, useState } from 'react';
import { TabList, Tabs } from 'react-aria-components';
import { Tab, TabPanel } from '@/components/common/react-aria/tabs.tsx';
import { Layout } from '@/screens/partials/layout.tsx';
import { useIntegrationManager } from '@/providers/integration.provider.tsx';
import { ProviderManifest } from '@/integrations/core/types.ts';
import { IntegrationHealthSnapshot } from '@/integrations/core/types.ts';
import { IntegrationQueueJob } from '@/integrations/queue/types.ts';
import { ProvidersPanel } from '@/screens/integrations/providers.panel.tsx';
import { ConfigurationPanel } from '@/screens/integrations/configuration.panel.tsx';
import { HealthPanel } from '@/screens/integrations/health.panel.tsx';
import { QueuePanel } from '@/screens/integrations/queue.panel.tsx';
import { useSecurity } from '@/hooks/useSecurity.ts';
import { useActionVisible } from '@/hooks/useActionVisible.ts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AvailableProviderEntry } from '@/integrations/core/integration-manager.ts';
import { DocumentTitle } from '@/components/common/document-title.tsx';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';
import {
  filterKeysByModuleAccess,
  resolveVisibleSelection,
} from '@/lib/module-access.ts';
import { NoAccessibleTabs } from '@/components/common/no-accessible-tabs.tsx';

const INTEGRATION_TAB_MODULES: Record<string, string> = {
  providers: 'integrations.providers',
  configuration: 'integrations.configuration',
  health: 'integrations.health',
  queue: 'integrations.queue',
};

const INTEGRATION_TAB_KEYS = ['providers', 'configuration', 'health', 'queue'] as const;
type IntegrationTabKey = (typeof INTEGRATION_TAB_KEYS)[number];

export const IntegrationsScreen = () => {
  const { t } = useTranslation('integrations');
  const { t: tNav } = useTranslation('navigation');
  const { manager, initialized, providers: availableProviders, setProviderEnabled } = useIntegrationManager();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const { ready, can } = useModuleAccess();
  const showConfigureProvider = isVisible('integrations.open_configuration');
  const showToggleProvider = isVisible('integrations.toggle_provider');

  const [selected, setSelected] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderManifest[]>([]);
  const [providerEntries, setProviderEntries] = useState<AvailableProviderEntry[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [healthRows, setHealthRows] = useState<IntegrationHealthSnapshot[]>([]);
  const [queueRows, setQueueRows] = useState<IntegrationQueueJob[]>([]);

  const pages = useMemo(() => ({
    providers: { title: t('tabs.providers') },
    configuration: { title: t('tabs.configuration') },
    health: { title: t('tabs.health') },
    queue: { title: t('tabs.queue') },
  }), [t]);

  const visibleKeys = useMemo(() => {
    if (!ready) return [] as IntegrationTabKey[];
    return filterKeysByModuleAccess(INTEGRATION_TAB_KEYS, INTEGRATION_TAB_MODULES, can);
  }, [ready, can]);

  const effectiveSelected = resolveVisibleSelection(selected, visibleKeys);

  useEffect(() => {
    if (effectiveSelected != null && effectiveSelected !== selected) {
      setSelected(effectiveSelected);
    }
  }, [effectiveSelected, selected]);

  useEffect(() => {
    if (!initialized) return;
    setProviderEntries(availableProviders);
    const manifests = availableProviders.map((entry) => entry.manifest);
    setProviders(manifests);
    if (manifests[0] && !selectedProviderId) {
      setSelectedProviderId(manifests[0].id);
    }
  }, [availableProviders, initialized, selectedProviderId]);

  useEffect(() => {
    if (!initialized) return;
    const loadStatus = async () => {
      const health = await manager.refreshHealth();
      const queue = await manager.getQueueSnapshot();
      setHealthRows(health);
      setQueueRows(queue);
    };
    void loadStatus();
  }, [initialized, manager]);

  useEffect(() => {
    if (!initialized || effectiveSelected !== 'queue') return;
    let cancelled = false;
    const refreshQueue = async () => {
      const queue = await manager.getQueueSnapshot();
      if (!cancelled) setQueueRows(queue);
    };
    void refreshQueue();
    const timer = setInterval(() => {
      void refreshQueue();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [initialized, manager, effectiveSelected]);

  const handleConfigure = (providerId: string) => {
    void protectAction(() => {
      setSelectedProviderId(providerId);
      setSelected('configuration');
    }, {
      module: 'integrations.open_configuration',
      description: t('security.openConfiguration'),
    });
  };

  const handleConnect = async (providerId: string) => {
    const provider = manager.getOrCreateProvider(providerId);
    if (!provider?.connect) {
      throw new Error(t('connectNotSupported'));
    }
    await provider.connect();
    toast.success(t('oauth.connected'));
  };

  const handleDisconnect = async (providerId: string) => {
    const provider = manager.getOrCreateProvider(providerId);
    if (!provider?.disconnect) {
      throw new Error(t('disconnectNotSupported'));
    }
    await provider.disconnect();
    toast.success(t('oauth.disconnected'));
  };

  const handleInitialSync = async (providerId: string) => {
    // First-time setup: wire the provider with config/db loaders but skip validation
    // (account mappings don't exist yet — the sync creates them).
    const provider = await manager.prepareAndEnableForSync(providerId);
    if (!provider?.sync) {
      throw new Error('Sync not supported');
    }
    await provider.sync();
    toast.success(t('syncComplete', { count: 0 }));
  };

  const handleToggleProvider = (providerId: string, enabled: boolean) => {
    void protectAction(async () => {
      try {
        await setProviderEnabled(providerId, enabled);
        toast.success(enabled ? t('providerEnabled') : t('providerDisabled'));
        const health = await manager.refreshHealth();
        const queue = await manager.getQueueSnapshot();
        setHealthRows(health);
        setQueueRows(queue);
      } catch (error) {
        const message = error instanceof Error ? error.message : t('enableFailed');
        toast.error(message || t('enableFailed'));
        console.error(error);
      }
    }, {
      module: 'integrations.toggle_provider',
      description: t('security.toggleProvider'),
    });
  };

  const titleParts = effectiveSelected
    ? [pages[effectiveSelected as keyof typeof pages]?.title, tNav('sidebar.integrations')]
    : [tNav('sidebar.integrations')];

  return (
    <Layout>
      <DocumentTitle parts={titleParts} />
      <div data-testid="integrations-page">
        {!ready ? null : visibleKeys.length === 0 ? (
          <NoAccessibleTabs />
        ) : (
          <Tabs
            className="w-full flex flex-col rounded-xl"
            selectedKey={effectiveSelected ?? undefined}
            onSelectionChange={(key: string) => {
              protectAction(() => setSelected(key), {
                module: INTEGRATION_TAB_MODULES[key],
                description: t('security.accessTab', { module: pages[key as keyof typeof pages].title }),
              });
            }}
          >
            <TabList
              aria-label="Integrations tabs"
              className="flex flex-row gap-3 px-1 py-3 flex-nowrap"
              data-testid="integrations-tabs"
            >
              {visibleKeys.map((key) => (
                <Tab id={key} key={key} data-testid={`integrations-tab-${key}`}>
                  {pages[key].title}
                </Tab>
              ))}
            </TabList>

            {visibleKeys.includes('providers') && (
              <TabPanel id="providers" className="bg-white shadow flex-grow flex-shrink-0">
                <div data-testid="integrations-panel-providers">
                  <ProvidersPanel
                    providers={providerEntries}
                    onConfigure={handleConfigure}
                    onToggleProvider={handleToggleProvider}
                    showConfigure={showConfigureProvider}
                    showToggle={showToggleProvider}
                  />
                </div>
              </TabPanel>
            )}

            {visibleKeys.includes('configuration') && (
              <TabPanel id="configuration" className="bg-white shadow flex-grow flex-shrink-0">
                <div data-testid="integrations-panel-configuration">
                  <ConfigurationPanel
                    providers={providers}
                    selectedProviderId={selectedProviderId}
                    onProviderChange={setSelectedProviderId}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                    onInitialSync={handleInitialSync}
                  />
                </div>
              </TabPanel>
            )}

            {visibleKeys.includes('health') && (
              <TabPanel id="health" className="bg-white shadow flex-grow flex-shrink-0">
                <div data-testid="integrations-panel-health">
                  <HealthPanel rows={healthRows} />
                </div>
              </TabPanel>
            )}

            {visibleKeys.includes('queue') && (
              <TabPanel id="queue" className="bg-white shadow flex-grow flex-shrink-0">
                <div data-testid="integrations-panel-queue">
                  <QueuePanel rows={queueRows} />
                </div>
              </TabPanel>
            )}
          </Tabs>
        )}
      </div>
    </Layout>
  );
};
