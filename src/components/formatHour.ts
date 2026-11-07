// "HH:MM" for an hour of the day, rounded to the minute.
export const formatHour = (hour: number) => {
  const total = Math.round(hour * 60) % (24 * 60)
  const h = String(Math.floor(total / 60)).padStart(2, '0')
  const m = String(total % 60).padStart(2, '0')
  return `${h}:${m}`
}
