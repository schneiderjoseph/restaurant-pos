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
  dropSupersededStays,
  generateWalkInGuestCode,
  searchGuests,
  phoneDigits,
  PHONE_SEARCH_MIN_DIGITS,
  previewGuestCode,
} from "@/lib/guest.ts";
import { findCustomerByPhone } from "@/lib/customer-phone.ts";
import {
  findCustomerByIdDocument,
  hasWalkInContact,
  normalizeIdDocument,
} from "@/lib/customer-id-document.ts";
import { toast } from "sonner";
import { usesAsiPmsRooms } from "@/lib/pos-mode.ts";

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
  const [newIdDocument, setNewIdDocument] = useState("");

  // Exact matches only: a name merely spelled close does not block registering a new guest.
  const [exactCount, setExactCount] = useState(0);
  const canRegister = exactCount === 0 && canRegisterGuestFromSearch(search);

  const displayCode = useMemo(() => {
    if (codeOverride) return codeOverride;
    return previewGuestCode(search.trim());
  }, [codeOverride, search]);

  useEffect(() => {
    setCodeOverride(null);
  }, [search]);

  const loadCustomers = async (term: string) => {
    // Hotel (ASI) mode: the same guests as the Client page — in-house, walk-in, local, or
    // carrying a staff note — listed without typing and filtered the same way, so a
    // checked-out guest never shows up here either.
    if (usesAsiPmsRooms()) {
      try {
        const [list] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers}
           WHERE in_house = true OR tags CONTAINS 'in-house'
              OR source = 'walk-in' OR tags CONTAINS 'walk-in'
              OR source = 'local'
              OR (notes != NONE AND notes != NULL AND notes != '')
           ORDER BY in_house DESC, name
           LIMIT 500`
        );
        const guests = dropSupersededStays(Array.isArray(list) ? list : []);
        const found = searchGuests(guests, term);
        setExactCount(found.exact.length);
        setCustomers([...found.exact, ...found.close]);
      } catch (error) {
        console.error('Customer list failed', error);
        setCustomers([]);
      }
      return;
    }

    if(term.trim().length === 0){
      try {
        const [list] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} ORDER BY name LIMIT 500`
        );
        setCustomers(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error('Customer list failed', error);
        setCustomers([]);
      }
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

    if (normalizeIdDocument(newIdDocument)) {
      // A failed duplicate check must not block the registration.
      const existing = await findCustomerByIdDocument(db, newIdDocument).catch((error) => {
        console.error("ID document lookup failed", error);
        return undefined;
      });
      if (existing) {
        toast.message(t("menu:guest.idDocumentExists", {
          name: existing.name || existing.guest_code || "",
        }));
        await attachCustomer(existing);
        return;
      }
    }

    if (!hasWalkInContact({ phone: newPhone, idDocument: newIdDocument })) {
      toast.error(t("menu:guest.contactRequired"));
      return;
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
        // Only named when set: keeps this insert valid on a DB without
        // migrations/2026_10_02_customer_id_document.surql (customer is SCHEMAFULL).
        ...(normalizeIdDocument(newIdDocument)
          ? { id_document_number: normalizeIdDocument(newIdDocument) }
          : {}),
      });

      if (!created) {
        toast.error(t("menu:guest.createFailed"));
        return;
      }

      setNewPhone("");
      setNewIdDocument("");
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
          <p className="text-sm text-neutral-600" data-testid="walkin-contact-hint">{t("menu:guest.contactHint")}</p>
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
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                data-testid="walkin-phone"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <Input
                label={t("menu:guest.idDocument")}
                placeholder={t("menu:guest.idDocumentPlaceholder")}
                value={newIdDocument}
                onChange={(event) => setNewIdDocument(event.target.value)}
                autoComplete="off"
                data-testid="walkin-id-document"
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

      <div className="mb-3 max-h-[50vh] overflow-auto" data-testid="customer-list">
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
              <td>
                {item.name}
                {item.room ? (
                  <span className="ml-2 rounded bg-primary-100 text-primary-800 px-2 py-0.5 text-sm font-semibold">
                    {t("menu:guest.room")} {item.room}
                  </span>
                ) : null}
              </td>
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
