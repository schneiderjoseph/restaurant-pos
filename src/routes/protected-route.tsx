import {useAtomValue} from "jotai";
import {Navigate, Outlet, useLocation} from "react-router";
import {appPage} from "@/store/jotai.ts";
import {LOGIN} from "@/routes/posr.ts";
import {getSessionToken, isGatewayAuthEnabled} from "@/lib/session.ts";
import {useHydrateCurrencySymbol} from "@/hooks/useCurrencySymbol.ts";
import {useRestaurantProfile} from "@/hooks/useRestaurantProfile.ts";
import {ModuleAccessProvider, useModuleAccess} from "@/providers/module-access.provider.tsx";
import {
  canAccessPath,
  getFirstAllowedPath,
  type ModuleAccessFeatureFlags,
} from "@/lib/module-access.ts";
import {
  isAccountingModuleEnabled,
  isClosingModuleEnabled,
  isDeliveryModuleEnabled,
  isHrModuleEnabled,
  isIntegrationsModuleEnabled,
} from "@/lib/feature-modules.ts";
import {NoModuleAccess} from "@/screens/no-module-access.tsx";
import {PageLoader} from "@/components/common/loader/page-loader.tsx";

const readFeatureFlags = (): ModuleAccessFeatureFlags => ({
  hr: isHrModuleEnabled(),
  delivery: isDeliveryModuleEnabled(),
  integrations: isIntegrationsModuleEnabled(),
  accounting: isAccountingModuleEnabled(),
  closing: isClosingModuleEnabled(),
});

/**
 * After modules are loaded: keep the current route if allowed, otherwise
 * redirect to the first allowed sidebar page (or show a no-access screen).
 * Never redirects while `ready` is false.
 */
const ModuleAccessRouteGuard = () => {
  const location = useLocation();
  const {ready, modules, can} = useModuleAccess();
  const flags = readFeatureFlags();

  // Render nothing of the page until grants are known: a deep link to a page the
  // user cannot open must not flash its content before the redirect.
  if (!ready) {
    return <PageLoader/>;
  }

  if (canAccessPath(location.pathname, modules, flags, can)) {
    return <Outlet/>;
  }

  const fallback = getFirstAllowedPath(modules, flags, can);
  if (fallback) {
    return <Navigate to={fallback} replace/>;
  }

  return <NoModuleAccess/>;
};

export const ProtectedRoute = () => {
  const {user, locked} = useAtomValue(appPage);
  const location = useLocation();
  useHydrateCurrencySymbol();
  useRestaurantProfile();

  if (!user) {
    return <Navigate to={LOGIN} replace state={{from: location}}/>;
  }

  if (locked) {
    return <Navigate to={LOGIN} replace state={{from: location}}/>;
  }

  if (isGatewayAuthEnabled() && !getSessionToken()) {
    return <Navigate to={LOGIN} replace state={{from: location}}/>;
  }

  return (
    <ModuleAccessProvider>
      <ModuleAccessRouteGuard/>
    </ModuleAccessProvider>
  );
};
