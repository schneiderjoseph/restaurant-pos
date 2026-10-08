import {DateTime as LuxonDateTime, ToHumanDurationOptions} from "luxon";
import { useCallback, useEffect, useState } from "react";
import { DateInput, nowInAppTimezone, toLuxonDateTime } from "@/lib/datetime.ts";

interface Props{
  time: DateInput
  showAll?: boolean
  /** Show nothing while `time` is still ahead, instead of a negative duration. */
  hideUntilStarted?: boolean
}

export const Countdown = ({time, showAll, hideUntilStarted}: Props) => {
  const [diff, setDiff] = useState('-, -, -');


  const calculateDiff = useCallback(() => {
    const humanFormatSettings: ToHumanDurationOptions = {
      unitDisplay: 'narrow',
      maximumFractionDigits: 0
    };
    const startedAt = toLuxonDateTime(time);
    const now = nowInAppTimezone();

    if(hideUntilStarted && startedAt.toMillis() > now.toMillis()){
      setDiff('');
      return;
    }

    if(showAll){
      setDiff(now.diff(startedAt).shiftTo('hours', 'minutes', 'seconds').toHuman(humanFormatSettings));
    }else {
      const diff = now.diff(startedAt).as('hours');
      if( diff < 1 ) {
        setDiff(now.diff(startedAt).shiftTo('minutes', 'seconds').toHuman(humanFormatSettings));
      } else {
        setDiff(now.diff(startedAt).shiftTo('hours', 'minutes').toHuman(humanFormatSettings));
      }
    }
  }, [time, showAll, hideUntilStarted]);

  useEffect(() => {
    calculateDiff();
    const timer = setInterval(() => {
     calculateDiff();
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateDiff]);

  return (
    <span className="tabular-nums">{diff}</span>
  )
}
