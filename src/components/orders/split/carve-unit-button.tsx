import {faScissors} from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from "react-i18next";
import {IconTooltipButton} from "@/components/common/input/icon.tooltip.button.tsx";

/** Gives one unit of a multi-unit line its own line, so it can go to another split. */
export const CarveUnitButton = ({onCarve}: {onCarve: () => void}) => {
  const {t} = useTranslation('orders');
  return (
    // The line row selects on tap: keep this tap to the button.
    <span onClick={(e) => e.stopPropagation()} className="ml-2">
      <IconTooltipButton
        label={t('split.carveOne')}
        icon={faScissors}
        variant="primary"
        flat
        size="lg"
        onClick={onCarve}
      />
    </span>
  );
};
