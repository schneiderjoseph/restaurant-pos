import { useAtom } from "jotai";
import { appPage } from "@/store/jotai.ts";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBarChart,
  faBars,
  faClipboardList,
  faGear, faLineChart,
  faDisplay,
  faList, faLock,
  faMotorcycle,
  faStore,
  faBellConcierge, faWrench,
  faPowerOff,
  faReceipt,
  faPlug,
  faRefresh
} from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils.ts";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { CSSProperties, useMemo, type ReactNode } from "react";
import {useNavigate} from "react-router";
import {
  ACCOUNTS,
  ADMIN,
  CLOSING,
  DELIVERY,
  INTEGRATIONS,
  KITCHEN,
  MENU,
  ORDER_DISPLAY,
  ORDERS,
  REPORTS,
  SETTINGS,
  SUMMARY,
  TIP_DISTRIBUTION,
} from "@/routes/posr.ts";
import { useSecurity } from "@/hooks/useSecurity.ts";
import { useCacheReload } from "@/hooks/useCacheReload.ts";
import ScrollContainer from "react-indiana-drag-scroll";
import { useTranslation } from "react-i18next";
import { lockSession, logoutSession } from "@/lib/session.actions.ts";
import {
  isAccountingModuleEnabled,
  isClosingModuleEnabled,
  isDeliveryModuleEnabled,
  isIntegrationsModuleEnabled,
} from "@/lib/feature-modules.ts";
import { SecurityAlertsBadge } from "@/components/admin/security-alerts/alert-badge.tsx";
import { DuoButton } from "@/components/duo/duo-button.tsx";
import { useModuleAccess } from "@/providers/module-access.provider.tsx";
import {
  isSidebarEntryFeatureEnabled,
  SIDEBAR_NAV_ENTRIES,
  type ModuleAccessFeatureFlags,
} from "@/lib/module-access.ts";

const SIDEBAR_NAV_TEST_IDS: Partial<Record<string, string>> = {
  [MENU]: 'nav-menu',
  [ORDERS]: 'nav-orders',
  [SUMMARY]: 'nav-summary',
  [KITCHEN]: 'nav-kitchen',
  [ORDER_DISPLAY]: 'nav-order-display',
  [DELIVERY]: 'nav-delivery',
  [CLOSING]: 'nav-closing',
  [ADMIN]: 'nav-admin',
  [REPORTS]: 'nav-reports',
  [TIP_DISTRIBUTION]: 'nav-tip-distribution',
  [ACCOUNTS]: 'nav-accounts',
  [INTEGRATIONS]: 'nav-integrations',
};

const SIDEBAR_ICONS: Record<string, ReactNode> = {
  menu: <FontAwesomeIcon icon={faBars} size="lg"/>,
  orders: <FontAwesomeIcon icon={faList} size="lg"/>,
  summary: <FontAwesomeIcon icon={faClipboardList} size="lg"/>,
  kitchen: <FontAwesomeIcon icon={faBellConcierge} size="lg"/>,
  order_display: <FontAwesomeIcon icon={faDisplay} size="lg"/>,
  delivery: <FontAwesomeIcon icon={faMotorcycle} size="lg"/>,
  closing: <FontAwesomeIcon icon={faStore} size="lg"/>,
  admin: <FontAwesomeIcon icon={faGear} size="lg"/>,
  reports: <FontAwesomeIcon icon={faLineChart} size="lg"/>,
  tips: <FontAwesomeIcon icon={faBarChart} size="lg"/>,
  accounts: <FontAwesomeIcon icon={faReceipt} size="lg"/>,
  integrations: <FontAwesomeIcon icon={faPlug} size="lg"/>,
};

const SIDEBAR_TITLE_KEYS: Record<string, string> = {
  menu: 'sidebar.menu',
  orders: 'sidebar.orders',
  summary: 'sidebar.summary',
  kitchen: 'sidebar.kitchen',
  order_display: 'sidebar.orderDisplay',
  delivery: 'sidebar.delivery',
  closing: 'sidebar.closing',
  admin: 'sidebar.manage',
  reports: 'sidebar.reports',
  tips: 'sidebar.tipDist',
  accounts: 'sidebar.accounts',
  integrations: 'sidebar.integrations',
};

interface SidebarProps {
  /** Wider drawer layout on phones; default is the 130px rail. */
  variant?: 'rail' | 'drawer'
  onNavigate?: () => void
}

export const Sidebar = ({variant = 'rail', onNavigate}: SidebarProps = {}) => {
  const [page, setPage] = useAtom(appPage);
  const { t } = useTranslation(['navigation', 'common']);
  const { ready, can } = useModuleAccess();
  const isDrawer = variant === 'drawer';

  const pathInfo = location.pathname;

  const navigation = useNavigate();
  const { protectAction } = useSecurity();
  const { isReloading, reloadCache } = useCacheReload();

  const logout = () => {
    void logoutSession(setPage, navigation);
  }

  const protectedNavigate = async (to: string, module?: string, description?: string) => {
    await protectAction(() => {
      onNavigate?.();
      navigation(to);
    }, {
      description: description || t('authenticateToAccess', { module }),
      module,
    });
  }

  const lock = () => {
    lockSession(setPage, navigation);
  }

  const featureFlags: ModuleAccessFeatureFlags = useMemo(() => ({
    delivery: isDeliveryModuleEnabled(),
    integrations: isIntegrationsModuleEnabled(),
    accounting: isAccountingModuleEnabled(),
    closing: isClosingModuleEnabled(),
  }), []);

  const sidebarItems = useMemo(() => {
    return SIDEBAR_NAV_ENTRIES
      .filter((entry) => isSidebarEntryFeatureEnabled(entry, featureFlags))
      // Hide until grants are known so unauthorized entries never flash.
      .filter((entry) => ready && can(entry.role))
      .map((entry) => ({
        title: t(SIDEBAR_TITLE_KEYS[entry.role] ?? entry.role),
        icon: SIDEBAR_ICONS[entry.role],
        link: entry.link,
        role: entry.role,
      }));
  }, [t, featureFlags, ready, can]);

  const showSettings = ready && can('settings');

  return (
    <div className={cn(
      "flex flex-col justify-between items-center sidebar border border-y-0 border-white bg-white/50 backdrop-blur h-full min-h-0",
      isDrawer ? "h-full w-full" : "h-[100dvh] h-screen"
    )}>
      <div className="w-full min-h-0 flex-1 overflow-hidden">
        {/* Gutter reserved on both sides: the buttons stay centered whether the scrollbar shows or not. */}
        <ScrollContainer
          className={cn(
            "[scrollbar-gutter:stable_both-edges] [scrollbar-width:thin] h-full",
            !isDrawer && "max-h-[calc(100dvh_-_215px)] max-h-[calc(100vh_-_215px)]"
          )}
          hideScrollbars={false}
        >
          <div className="p-2 flex flex-col">
            {sidebarItems.map(item => (
              <button
                type="button"
                data-testid={SIDEBAR_NAV_TEST_IDS[item.link] ?? undefined}
                onClick={() => {
                  protectedNavigate(item.link, item.role);
                }}
                className={cn(
                  'relative flex items-center cursor-pointer p-[0.4rem] gap-2 rounded-xl pressable no-underline w-full border-[3px] border-transparent',
                  isDrawer ? 'flex-row text-left' : 'flex-col text-center',
                  pathInfo === item.link ? 'shadow-xl bg-gradient active:shadow-none' : 'text-neutral-900'
                )}
                key={item.title}
                style={{
                  '--padding': '0.4rem'
                } as CSSProperties}
              >
                <span className="icon">{item.icon}</span>
                <span className={cn("label", isDrawer ? "text-sm" : "text-[12px]")}>{item.title}</span>
                {item.link === ADMIN && <SecurityAlertsBadge />}
              </button>
            ))}
          </div>
        </ScrollContainer>
      </div>
      <div className="flex flex-col gap-2 w-full p-2">
        {/* Duo: for whoever takes orders. */}
        {ready && can('orders') && <DuoButton/>}
        <div className="input-group">
          {showSettings && (
            <button
              type="button"
              data-testid="nav-settings"
              onClick={() => protectedNavigate(SETTINGS, 'settings')}
              className={cn(
                'btn btn-primary lg flex-1',
                pathInfo === SETTINGS ? 'active' : ''
              )}
              key={'settings'}
              style={{
                '--padding': '0.5rem'
              } as CSSProperties}
            >
              <FontAwesomeIcon icon={faWrench} />
            </button>
          )}
        </div>
        <div className="input-group">
          <IconTooltipButton
            label={t('common:actions.refresh')}
            className="flex-1"
            variant="primary"
            onClick={reloadCache}
            isLoading={isReloading}
            disabled={isReloading}
            size="lg"
            data-testid="nav-refresh-cache"
          >
            {!isReloading && <FontAwesomeIcon icon={faRefresh} />}
          </IconTooltipButton>
          <IconTooltipButton
            label={t('common:actions.lock')}
            className="flex-1"
            variant="primary"
            onClick={lock}
            size="lg"
            data-testid="nav-lock"
          >
            <FontAwesomeIcon icon={faLock} />
          </IconTooltipButton>
          <IconTooltipButton
            label={t('common:actions.logout')}
            className="flex-1"
            variant="danger"
            onClick={logout}
            size="lg"
            data-testid="nav-logout"
          >
            <FontAwesomeIcon icon={faPowerOff} />
          </IconTooltipButton>
        </div>
      </div>
    </div>
  )
}
