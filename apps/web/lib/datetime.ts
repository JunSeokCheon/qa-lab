const KST_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDateTimeKST(input: string | number | Date | null | undefined): string {
  if (input === null || input === undefined || input === "") return "-";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return KST_FORMATTER.format(date);
}

