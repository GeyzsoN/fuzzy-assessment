export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${pluralize(count, singular, plural)}`;
}

export function formatDurationUnit(
  count: number,
  unit: 'minutes' | 'hours' | 'days',
) {
  const singularByUnit = {
    minutes: 'minute',
    hours: 'hour',
    days: 'day',
  };

  return pluralize(count, singularByUnit[unit], unit);
}
