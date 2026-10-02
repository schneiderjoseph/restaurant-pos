import React, {useEffect, useMemo, useState} from "react";
import { Input } from "@/components/common/input/input.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { useAtom } from "jotai";
import { appState } from "@/store/jotai.ts";
import {Customer} from "@/api/model/customer.ts";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {faCheck} from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from "react-i18next";
import {
  canRegisterGuestFromSearch,
  generateWalkInGuestCode,
  phoneDigits,
  PHONE_SEARCH_MIN_DIGITS,
  previewGuestCode,
} from "@/lib/guest.ts";
import { findCustomerByPhone } from "@/lib/customer-phone.ts";
import { toast } from "sonner";

export interface Props {
  onAttach?: () => void;
  /** When set, called with the chosen customer (create or pick). Still updates appState. */
  onCustomerChosen?: (customer: Customer) => void | Promise<void>;
}
export const Customers = ({
  onAttach,
  onCustomerChosen,
}: Props) => {
  const [state, setState] = useAtom(appState);
  const db = useDB();
  const {t} = useTranslation(["orders", "common", "menu"]);

  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [codeOverride, setCodeOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState("");

  const canRegister = customers.length === 0 && canRegisterGuestFromSearch(search);

  const displayCode = useMemo(() => {
    if (codeOverride) return codeOverride;
    return previewGuestCode(search.trim());
  }, [codeOverride, search]);

  useEffect(() => {
    setCodeOverride(null);
  }, [search]);

  const loadCustomers = async (term: string) => {
    if(term.trim().length === 0){
      setCustomers([]);
      return;
    }

    const q = term.trim().toLowerCase();
    // Phone-like query (no letters): also match on digits, whatever the stored formatting.
    const digits = /\p{L}/u.test(q) ? '' : phoneDigits(q);
    try {
      const [list] = await db.query<Customer[]>(
        `SELECT * FROM ${Tables.customers}
         WHERE string::contains(string::lowercase(name ?? ''), $q)
            OR string::contains(string::lowercase(guest_code ?? ''), $q)
            OR string::contains(string::lowercase(type::string(phone ?? '')), $q)
            OR ($digits != '' AND string::contains(string::replace(type::string(phone ?? ''), /[^0-9]/, ''), $digits))
            OR string::contains(string::lowercase(email ?? ''), $q)
            OR string::contains(string::lowercase(type::string(room ?? '')), $q)
         ORDER BY name
         LIMIT 25`,
        { q, digits: digits.length >= PHONE_SEARCH_MIN_DIGITS ? digits : '' }
      );

      setCustomers(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('Customer search failed', error);
      setCustomers([]);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadCustomers(search);
    }, 150);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce search; loadCustomers closes over db
  }, [search]);

  const attachCustomer = async (customer: Customer) => {
    setState(prev => ({
      ...prev,
      customer,
    }));
    await onCustomerChosen?.(customer);
    onAttach?.();
  };

  const createFromSearch = async () => {
    const name = search.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(name)) {
      toast.error(t("menu:guest.nameRequired"));
      return;
    }

    if (newPhone.trim()) {
      // A failed duplicate check must not block the registration.
      const existing = await findCustomerByPhone(db, newPhone).catch((error) => {
        console.error("Phone lookup failed", error);
        return undefined;
      });
      if (existing) {
        toast.message(t("menu:guest.phoneExists", {
          name: existing.name || existing.guest_code || "",
        }));
        await attachCustomer(existing);
        return;
      }
    }

    setSaving(true);
    try {
      let guest_code = displayCode.trim().toUpperCase() || generateWalkInGuestCode(name);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code }
        );
        if (!Array.isArray(existing) || !existing[0]) {
          break;
        }
        guest_code = generateWalkInGuestCode(name);
      }

      const [created] = await db.insert(Tables.customers, {
        name,
        guest_code,
        room: null,
        in_house: false,
        source: 'walk-in',
        tags: ['walk-in'],
        phone: newPhone.trim() || null,
      });

      if (!created) {
        toast.error(t("menu:guest.createFailed"));
        return;
      }

      setNewPhone("");
      toast.success(t("menu:guest.created"));
      await attachCustomer(created as unknown as Customer);
    } catch (error) {
      console.error(error);
      toast.error(t("menu:guest.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  const selectedLabel = useMemo(() => {
    if (!state.customer?.id) return null;
    return (
      <div className="text-sm text-neutral-600 mb-3">
        {t("menu:guest.selected")}: <span className="font-semibold">{state.customer.name}</span>
        {state.customer.guest_code ? ` · #${state.customer.guest_code}` : ''}
      </div>
    );
  }, [state.customer, t]);

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder={t("menu:guest.searchPlaceholder")}
          className="search-field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          data-testid="customer-search"
        />
      </div>

      {canRegister && (
        <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-3" data-testid="walkin-create">
          <div className="font-semibold text-lg">
            {t("menu:guest.registerFromSearchTitle", { name: search.trim() })}
          </div>
          <p className="text-sm text-neutral-600">{t("menu:guest.registerFromSearchHint")}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[120px]">
              <Input
                label={t("menu:guest.code")}
                value={displayCode}
                readOnly
                data-testid="walkin-code"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <Input
                type="tel"
                inputMode="tel"
                label={t("menu:guest.phone")}
                placeholder={t("menu:guest.phonePlaceholder")}
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                data-testid="walkin-phone"
              />
            </div>
            <Button
              type="button"
              variant="neutral"
              flat
              onClick={() => setCodeOverride(generateWalkInGuestCode(search.trim()))}
              data-testid="walkin-regen-code"
            >
              {t("menu:guest.regenCode")}
            </Button>
            <Button
              type="button"
              variant="primary"
              filled
              isLoading={saving}
              onClick={() => void createFromSearch()}
              data-testid="walkin-create-attach"
            >
              {t("menu:guest.register")}
            </Button>
          </div>
        </div>
      )}

      {selectedLabel}

      <div className="mb-3">
        <table className="table">
          <thead>
            <tr>
              <th>{t("customer.columns.select")}</th>
              <th>{t("customer.columns.name")}</th>
              <th>{t("customer.columns.email")}</th>
              <th>{t("customer.columns.phone")}</th>
              <th>{t("customer.columns.address")}</th>
              <th>{t("customer.columns.secondaryAddress")}</th>
              <th>{t("customer.columns.points")}</th>
            </tr>
          </thead>
          <tbody>
          {customers.map(item => (
            <tr key={item.id?.toString()}>
              <td>
                <IconTooltipButton
                  label={t('common:actions.select')}
                  icon={faCheck}
                  onClick={() => {
                    void attachCustomer(item);
                  }}
                  variant="secondary"
                />
              </td>
              <td>{item.name}</td>
              <td>{item.email}</td>
              <td>{item.phone}</td>
              <td>{item.address}</td>
              <td>{item.secondary_address}</td>
              <td>{item.points}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
