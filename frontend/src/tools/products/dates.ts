export function athensToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  return ['year', 'month', 'day'].map((field) => parts.find((part) => part.type === field)?.value).join('-')
}
