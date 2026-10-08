import dayjs, { Dayjs } from "dayjs";

export const jsDateToDayjs = (date?: Date | null): Dayjs | null =>
  date ? dayjs(date) : null;
