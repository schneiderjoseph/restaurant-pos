import { useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { nowInAppTimezone, toLuxonDateTime } from "@/lib/datetime.ts";
import {
  DUE_MINUTE_STEP,
  DUE_QUICK_OFFSETS_MIN,
  dueFromOffset,
  dueFromParts,
  formatDueLabel,
  isDueAhead,
} from "@/lib/order-due.ts";

interface Props {
  /** Current choice as an ISO instant; null = as soon as possible. */
  value: string | null
  onChange: (value: string | null) => void
  onClose: () => void
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Touch picker for when an order is wanted: now, in X minutes, or a time today / tomorrow. */
export const OrderDueModal = ({ value, onChange, onClose }: Props) => {
  const { t } = useTranslation("payment");
  const now = nowInAppTimezone();
  const current = value ? toLuxonDateTime(value) : null;
  const initial = isDueAhead(current, now) ? current : dueFromOffset(now, 30);

  const [dayOffset, setDayOffset] = useState(
    Math.max(0, Math.round(initial.startOf("day").diff(now.startOf("day"), "days").days))
  );
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute - (initial.minute % DUE_MINUTE_STEP));

  const choose = (due: DateTime | null) => {
    onChange(due ? due.toUTC().toISO() : null);
    onClose();
  };

  const picked = dueFromParts(now, dayOffset, hour, minute);

  const confirm = () => {
    if (!isDueAhead(picked, nowInAppTimezone())) {
      toast.error(t("due.past"));
      return;
    }
    choose(picked);
  };

  const stepper = (
    label: string,
    shown: number,
    onStep: (delta: number) => void,
    testId: string,
  ) => (
    <div className="flex flex-col items-center gap-2" data-testid={testId}>
      <span className="text-sm text-neutral-500">{label}</span>
      <Button variant="primary" flat size="xl" icon={faPlus} aria-label={`${label} +`} onClick={() => onStep(1)} />
      <span className="text-5xl font-black tabular-nums min-w-[90px] text-center">{pad(shown)}</span>
      <Button variant="primary" flat size="xl" icon={faMinus} aria-label={`${label} -`} onClick={() => onStep(-1)} />
    </div>
  );

  return (
    <Modal open onClose={onClose} title={t("due.title")} size="md" testId="order-due-modal">
      <div className="flex flex-col gap-5">
        <Button
          variant="primary"
          filled={!value}
          flat={!!value}
          size="lg"
          className="w-full"
          data-testid="order-due-asap"
          onClick={() => choose(null)}
        >
          {t("due.asap")}
        </Button>

        <div>
          <div className="font-semibold mb-2">{t("due.inTitle")}</div>
          <div className="grid grid-cols-3 gap-3">
            {DUE_QUICK_OFFSETS_MIN.map((minutes) => (
              <Button
                key={minutes}
                variant="primary"
                flat
                size="lg"
                data-testid="order-due-offset"
                onClick={() => choose(dueFromOffset(nowInAppTimezone(), minutes))}
              >
                {minutes < 60
                  ? t("due.inMinutes", { count: minutes })
                  : t("due.inHours", {
                      hours: Math.floor(minutes / 60),
                      minutes: minutes % 60 ? pad(minutes % 60) : "",
                    })}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <div className="font-semibold mb-2">{t("due.atTitle")}</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Button variant="primary" flat size="lg" active={dayOffset === 0} onClick={() => setDayOffset(0)}>
              {t("due.today")}
            </Button>
            <Button variant="primary" flat size="lg" active={dayOffset === 1} onClick={() => setDayOffset(1)}>
              {t("due.tomorrow")}
            </Button>
          </div>
          <div className="flex justify-center items-center gap-6">
            {stepper(t("due.hour"), hour, (delta) => setHour((h) => (h + delta + 24) % 24), "order-due-hour")}
            <span className="text-5xl font-black">:</span>
            {stepper(
              t("due.minute"),
              minute,
              (delta) => setMinute((m) => (m + delta * DUE_MINUTE_STEP + 60) % 60),
              "order-due-minute",
            )}
          </div>
        </div>

        <Button variant="success" filled size="lg" className="w-full" data-testid="order-due-confirm" onClick={confirm}>
          {t("due.confirm", { time: formatDueLabel(picked, now, t("due.tomorrowShort")) })}
        </Button>
      </div>
    </Modal>
  );
};
