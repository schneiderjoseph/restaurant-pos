/** Written by asi-sync: the outlets (mPOS) found in ASI. */
export const ASI_OUTLETS_KEY = 'asi_outlets';
/** Written by Manage: ASI posIDs to sync, in priority order (first wins on price conflicts). */
export const ASI_POS_IDS_KEY = 'asi_pos_ids';

export interface AsiOutlet {
  pos_id: number;
  alias: string;
  name: string;
  is_active: boolean;
}
