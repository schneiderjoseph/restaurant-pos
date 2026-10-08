import AntDatePicker from "antd/es/date-picker";
import { Dayjs } from "dayjs";
import { antPickerPopupProps, usePickerTouchProps } from "@/components/common/antd/picker.shared.ts";

interface Props {
  label?: string;
  name?: string;
  value?: Dayjs | null;
  onChange?: (value: Dayjs | null) => void;
  isClearable?: boolean;
  disabled?: boolean;
}

export const DateTimePicker = ({
  label,
  name,
  value,
  onChange,
  isClearable = false,
  disabled = false,
}: Props) => {
  const touchProps = usePickerTouchProps();
  return (
    <div className="flex flex-col" data-react-aria-top-layer="true">
      {label && <label>{label}</label>}
      <AntDatePicker
        className="w-full app-ant-picker"
        value={value}
        allowClear={isClearable}
        disabled={disabled}
        showTime={{ format: "HH:mm" }}
        format="YYYY-MM-DD HH:mm"
        onChange={(nextValue) => {
          onChange?.(nextValue);
        }}
        {...antPickerPopupProps}
        {...touchProps}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={value ? value.format("YYYY-MM-DD HH:mm") : ""}
        />
      )}
    </div>
  );
};
