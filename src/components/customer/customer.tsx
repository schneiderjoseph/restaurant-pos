import React, {useEffect, useMemo, useRef, useState} from "react";
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
import {
  findCustomerByIdDocument,
  walkInRefusal,
  normalizeIdDocument,
} from "@/lib/customer-id-document.ts";
import {
  ACTIVE_CUSTOMER,
  createWalkInCustomer,
  customerNumberLabel,
  CustomerIdDocumentTakenError,
  findWalkInMatches,
  parseCustomerNumber,
  type CustomerMatch,
} from "@/lib/customer.service.ts";
import { visiblePhone } from "@/lib/phone.ts";
import { PhoneInput } from "@/components/customer/phone.input.tsx";
import { CustomerMatchesModal } from "@/components/customer/customer.matches.modal.tsx";
import { useModuleAccess } from "@/providers/module-access.provider.tsx";
import { appPage } from "@/store/jotai.ts";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { usesAsiPmsRooms } from "@/lib/pos-mode.ts";

export interface Props {
  onAttach?: () => void;
  /** When set, called with the chosen customer (create or pick). */
  onCustomerChosen?: (customer: Customer) => void | Promise<void>;
  /** False when picking for something else (moving an order): the cart's customer stays. */
  attachToCart?: boolean;
}
export const Customers = ({
  onAttach,
  onCustomerChosen,
  attachToCart = true,
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
  const [page] = useAtom(appPage);
  const { can } = useModuleAccess();
  const canViewPhone = can("customers.view_phone");
  const [matches, setMatches] = useState<CustomerMatch[] | null>(null);
  const searchRequestRef = useRef(0);

  // A name already listed is not the same person: registering it again is one tap away.
  const [exactCount, setExactCount] = useState(0);
  const [registerOpen, setRegisterOpen] = useState(false);
  const canRegisterName = can("customers.create") && canRegisterGuestFromSearch(search);
  const canRegister = canRegisterName && (exactCount === 0 || registerOpen);

  const displayCode = useMemo(() => {
    if (codeOverride) return codeOverride;
    return previewGuestCode(search.trim());
  }, [codeOverride, search]);

  useEffect(() => {
    setCodeOverride(null);
    setRegisterOpen(false);
  }, [search]);

  const loadCustomers = async (term: string) => {
    const request = ++searchRequestRef.current;
    const apply = (rows: Customer[], exact = 0) => {
      if (request !== searchRequestRef.current) {
        return;
      }
      setExactCount(exact);
      setCustomers(rows);
    };

    // Hotel (ASI) mode: the same guests as the Client page — in-house, walk-in, local, or
    // carrying a staff note — listed without typing and filtered the same way, so a
    // checked-out guest never shows up here either.
    if (usesAsiPmsRooms()) {
      try {
        const [list] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers}
           WHERE ${ACTIVE_CUSTOMER} AND (
              in_house = true OR tags CONTAINS 'in-house'
              OR source = 'walk-in' OR tags CONTAINS 'walk-in'
              OR tags CONTAINS 'manual-stay'
              OR current_stay != NONE
              OR source = 'local'
              OR (notes != NONE AND notes != NULL AND notes != '')
           )
           ORDER BY in_house DESC, name
           LIMIT 500`
        );
        const guests = dropSupersededStays(Array.isArray(list) ? list : []);
        const found = searchGuests(guests, term);
        apply([...found.exact, ...found.close], found.exact.length);
      } catch (error) {
        console.error('Customer list failed', error);
        apply([]);
      }
      return;
    }

    if(term.trim().length === 0){
      try {
        const [list] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE ${ACTIVE_CUSTOMER} ORDER BY name LIMIT 500`
        );
        apply(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error('Customer list failed', error);
        apply([]);
      }
      return;
    }

    const q = term.trim().toLowerCase();
    // Phone-like query (no letters): also match on digits, whatever the stored formatting.
    const digits = /\p{L}/u.test(q) ? '' : phoneDigits(q);
    try {
      const [list] = await db.query<Customer[]>(
        `SELECT * FROM ${Tables.customers}
         WHERE ${ACTIVE_CUSTOMER} AND (
            string::contains(string::lowercase(name ?? ''), $q)
            OR string::contains(string::lowercase(guest_code ?? ''), $q)
            OR string::contains(string::lowercase(type::string(phone ?? '')), $q)
            OR ($digits != '' AND string::contains(string::replace(type::string(phone ?? ''), /[^0-9]/, ''), $digits))
            OR string::contains(string::lowercase(email ?? ''), $q)
            OR string::contains(string::lowercase(type::string(room ?? '')), $q)
            OR ($number != NONE AND number = $number)
         )
         ORDER BY name
         LIMIT 25`,
        {
          q,
          digits: digits.length >= PHONE_SEARCH_MIN_DIGITS ? digits : '',
          number: parseCustomerNumber(term) ?? undefined,
        }
      );

      apply(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('Customer search failed', error);
      apply([]);
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
    if (attachToCart) {
      setState(prev => ({
        ...prev,
        customer,
      }));
    }
    await onCustomerChosen?.(customer);
    onAttach?.();
  };

  const createFromSearch = async (confirmed = false) => {
    const name = search.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(name)) {
      toast.error(t("menu:guest.nameRequired"));
      return;
    }

    const refusal = walkInRefusal({ name, phone: newPhone, idDocument: newIdDocument });
    if (refusal) {
      toast.error(t(refusal));
      return;
    }

    if (saving) {
      return;
    }
    setSaving(true);
    try {
      // One ID document, one client: that client is attached.
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

      // Same phone or same name is not the same person: staff choose.
      if (!confirmed) {
        let found: CustomerMatch[];
        try {
          found = await findWalkInMatches(db, { name, phone: newPhone });
        } catch (error) {
          console.error("Walk-in match lookup failed", error);
          toast.error(t("menu:guest.matchLookupFailed"));
          return;
        }
        if (found.length > 0) {
          setMatches(found);
          return;
        }
      }

      let guest_code = displayCode.trim().toUpperCase() || generateWalkInGuestCode(name);
      let codeAvailable = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code }
        );
        if (!Array.isArray(existing) || !existing[0]) {
          codeAvailable = true;
          break;
        }
        guest_code = generateWalkInGuestCode(name);
      }
      if (!codeAvailable) {
        toast.error(t("menu:guest.codeUnavailable"));
        return;
      }

      const created = await createWalkInCustomer(db, {
        name,
        guestCode: guest_code,
        phone: newPhone,
        idDocument: newIdDocument,
        createdBy: page?.user,
      });

      setMatches(null);
      setNewPhone("");
      setNewIdDocument("");
      toast.success(t("menu:guest.created"));
      await attachCustomer(created);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t("menu:guest.idDocumentTaken", {
              name: error.holder?.name || error.holder?.guest_code || "",
            })
          : t("menu:guest.createFailed"),
      );
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

      {canRegisterName && !canRegister && (
        <Button
          type="button"
          variant="primary"
          flat
          icon={faPlus}
          className="mb-3"
          onClick={() => setRegisterOpen(true)}
          data-testid="walkin-register-homonym"
        >
          {t("menu:customer.registerAnother", { name: search.trim() })}
        </Button>
      )}

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
            <div className="flex-[2] min-w-[240px]">
              <PhoneInput
                label={t("menu:guest.phone")}
                value={newPhone}
                onChange={setNewPhone}
                testId="walkin-phone"
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
              <th>{t("menu:customer.number")}</th>
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
              <td className="whitespace-nowrap text-neutral-600">{customerNumberLabel(item)}</td>
              <td>
                {item.name}
                {item.room ? (
                  <span className="ml-2 rounded bg-primary-100 text-primary-800 px-2 py-0.5 text-sm font-semibold">
                    {t("menu:guest.room")} {item.room}
                  </span>
                ) : null}
              </td>
              <td>{item.email}</td>
              <td className="whitespace-nowrap">{visiblePhone(item.phone, canViewPhone)}</td>
              <td>{item.address}</td>
              <td>{item.secondary_address}</td>
              <td>{item.points}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>

      {matches && (
        <CustomerMatchesModal
          open
          name={search.trim().replace(/\s+/g, " ")}
          matches={matches}
          creating={saving}
          onPick={(customer) => {
            setMatches(null);
            void attachCustomer(customer);
          }}
          onCreateNew={() => void createFromSearch(true)}
          onClose={() => setMatches(null)}
        />
      )}
    </>
  )
}
