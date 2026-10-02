import { useCallback } from 'react';
import { isActionVisible } from '@/lib/module-access.ts';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';

/**
 * Returns whether a control guarded by `module` / `alternateModule` should render.
 * Built on `useModuleAccess().can` — safe to call inside pages behind ProtectedRoute
 * (ready is already true there).
 */
export const useActionVisible = () => {
  const { can } = useModuleAccess();

  return useCallback(
    (module?: string, alternateModule?: string) => isActionVisible(can, module, alternateModule),
    [can],
  );
};
