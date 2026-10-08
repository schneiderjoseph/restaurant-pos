import React, { useCallback } from 'react';
import { useSecurityContext, AuthType, SecurityManager } from '@/providers/security.provider';
import { nanoid } from 'nanoid';
import {toRecordId} from "@/lib/utils.ts";
import {useAtom} from "jotai";
import {appPage} from "@/store/jotai.ts";
import {useDB} from "@/api/db/db.ts";
import {getTrackingUserFields, postTracking, withOrderTrackingPayload} from "@/lib/tracking.service.ts";
import {normalizeModules, getUserModules, getProtectModulesSource, userModulesGrant} from "@/lib/access.rules.ts";

export interface ProtectedActionOptions {
  description: string;
  authType?: AuthType;
  module?: string;
  orderId?: string;
  /** Always open manager auth UI (do not auto-allow current user). */
  forceAuth?: boolean;
  alternateModule?: string;
  excludeUserId?: string;
  onSuccess?: (manager?: SecurityManager) => void;
  onCancel?: () => void;
  onError?: () => void;
  payload?: any
}

export const useSecurity = () => {
  const { requestSecurity } = useSecurityContext();
  const [{user, page, locked}] = useAtom(appPage);
  const db = useDB();

  const getManagerId = useCallback((manager?: SecurityManager) => {
    if(!manager){
      return undefined;
    }

    const managerId = `${manager?.first_name} ${manager?.last_name}`;

    if (!managerId) return undefined;

    return managerId;
  }, []);

  const trackProtectActionSuccess = useCallback((options: ProtectedActionOptions, authMethod: string, manager?: SecurityManager) => {
    void postTracking({
      auth_method: authMethod,
      manager: getManagerId(manager),
      manager_role: manager?.user_role?.name || manager?.role?.name,
      module: options.module,
      page,
      payload: withOrderTrackingPayload(options.payload, options.orderId),
      ...getTrackingUserFields(user),
    });
  }, [getManagerId, page, user]);

  const protectAction = useCallback(async (
    action: () => void,
    options: ProtectedActionOptions
  ) => {
    const {
      description,
      authType = 'pin',
      module,
      forceAuth = false,
      alternateModule,
      excludeUserId,
      onSuccess,
      onCancel,
      onError,
      payload,
    } = options;

    if (!forceAuth && !locked) {
      let userModules: string[];
      if (getProtectModulesSource() === 'memory') {
        userModules = getUserModules(user);
      } else {
        const [userWithModules] = await db.query(`SELECT * FROM ONLY ${toRecordId(user?.id)} WHERE deleted_at = none FETCH user_role`);
        userModules = normalizeModules(userWithModules?.user_role?.roles);
      }
      if (userModulesGrant(userModules, module)) {
        action();
        onSuccess?.();
        void trackProtectActionSuccess(options, 'auto');
        return;
      }
    }

    requestSecurity({
      id: nanoid(),
      description,
      authType,
      module,
      forceAuth,
      alternateModule,
      excludeUserId,
      onConfirm: (manager?: SecurityManager, usedAuthType?: AuthType) => {
        action();
        onSuccess?.(manager);
        void trackProtectActionSuccess(options, usedAuthType ?? authType, manager);
      },
      onCancel,
      onError,
      payload
    });
  }, [db, requestSecurity, trackProtectActionSuccess, user, locked]);

  const protectFormSubmit = useCallback((
    submitHandler: (e: React.FormEvent) => void,
    options: ProtectedActionOptions
  ) => {
    return (e: React.FormEvent) => {
      e.preventDefault();
      protectAction(() => submitHandler(e), options);
    };
  }, [protectAction]);

  return {
    protectAction,
    protectFormSubmit,
  };
};
