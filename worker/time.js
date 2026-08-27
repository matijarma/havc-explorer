export const ANALYTICS_TIME_ZONE = 'Europe/Zagreb';

export function dayInTimeZone(value = Date.now(), timeZone = ANALYTICS_TIME_ZONE) {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(new Date(value));
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(day, amount) {
	const date = new Date(`${day}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + amount);
	return date.toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
	const a = Date.parse(`${start}T00:00:00Z`);
	const b = Date.parse(`${end}T00:00:00Z`);
	return Math.round((b - a) / 86400000);
}

export function eachDay(start, end) {
	const days = [];
	for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
	return days;
}

export function formatZagrebDateTime(value) {
	if (!Number.isFinite(Number(value))) return 'not yet';
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: ANALYTICS_TIME_ZONE,
		year: 'numeric',
		month: 'short',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZoneName: 'short',
	}).format(new Date(Number(value)));
}
