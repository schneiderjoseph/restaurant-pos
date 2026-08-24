import React, {useEffect, useState} from "react";
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
import { generateWalkInGuestCode, joinGuestName } from "@/lib/guest.ts";
import { toast } from "sonner";

export interface Props {
  onAttach?: () => void;
}
export const Customers = ({
  onAttach
}: Props) => {
  const [state, setState] = useAtom(appState);
  const db = useDB();
  const {t} = useTranslation(["orders", "common", "menu"]);

  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [autoCode, setAutoCode] = useState(() => generateWalkInGuestCode());
  const [saving, setSaving] = useState(false);

  const loadCustomers = async (term: string) => {
    if(term.trim().length === 0){
      setCustomers([]);
      return;
    }

    const [list] = await db.query<Customer[]>(
      `SELECT * FROM ${Tables.customers}
       WHERE name CONTAINS $q
          OR phone CONTAINS $q
          OR email CONTAINS $q
          OR guest_code CONTAINS $q
       ORDER BY name
       LIMIT 10`,
      { q: term.trim() }
    );

    setCustomers(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    void loadCustomers(search)
  }, [search]);

  const attachCustomer = (customer: Customer) => {
    setState(prev => ({
      ...prev,
      customer,
    }));
    onAttach?.();
  };

  const createWalkIn = async () => {
    const name = joinGuestName(firstName, lastName);
    if (!name) {
      toast.error(t("menu:guest.nameRequired"));
      return;
    }

    setSaving(true);
    try {
      let guest_code = autoCode.trim().toUpperCase() || generateWalkInGuestCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code }
        );
        if (!Array.isArray(existing) || !existing[0]) {
          break;
        }
        guest_code = generateWalkInGuestCode();
      }

      const [created] = await db.insert(Tables.customers, {
        name,
        guest_code,
        room: null,
        in_house: false,
        source: 'walk-in',
        tags: ['walk-in'],
      });

      if (!created) {
        toast.error(t("menu:guest.createFailed"));
        return;
      }

      setFirstName('');
      setLastName('');
      setAutoCode(generateWalkInGuestCode());
      toast.success(t("menu:guest.created"));
      attachCustomer(created as Customer);
    } catch (error) {
      console.error(error);
      toast.error(t("menu:guest.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-4 rounded-xl border border-neutral-200 p-4 space-y-3" data-testid="walkin-create">
        <div className="font-semibold text-lg">{t("menu:guest.createWalkInTitle")}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={t("customer.firstName")}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            enableKeyboard
            data-testid="walkin-first-name"
          />
          <Input
            label={t("customer.lastName")}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            enableKeyboard
            data-testid="walkin-last-name"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[120px]">
            <Input
              label={t("menu:guest.code")}
              value={autoCode}
              readOnly
              data-testid="walkin-code"
            />
          </div>
          <Button
            type="button"
            variant="neutral"
            flat
            onClick={() => setAutoCode(generateWalkInGuestCode())}
            data-testid="walkin-regen-code"
          >
            {t("menu:guest.regenCode")}
          </Button>
          <Button
            type="button"
            variant="primary"
            filled
            isLoading={saving}
            onClick={() => void createWalkIn()}
            data-testid="walkin-create-attach"
          >
            {t("menu:guest.createAndAttach")}
          </Button>
        </div>
        {state.customer?.id && (
          <div className="text-sm text-neutral-600">
            {t("menu:guest.selected")}: <span className="font-semibold">{state.customer.name}</span>
            {state.customer.guest_code ? ` · #${state.customer.guest_code}` : ''}
          </div>
        )}
      </div>

      <div className="h-[2px] bg-gray-300 my-5"/>
      <div className="mb-3">
        <Input
          placeholder={t("customer.search")}
          className="search-field"
          onChange={(event) => setSearch(event.target.value)}
          enableKeyboard
        />
      </div>

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
                  onClick={() => attachCustomer(item)}
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
