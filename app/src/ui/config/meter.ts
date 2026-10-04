/** Ratio meter / graph scale: log10 from 0.01 % to 100 %, as 0–1. */
const LOG_MIN = -4;
export const meterPos = (r: number) =>
  Math.min(1, Math.max(0, (Math.log10(Math.max(r, 10 ** LOG_MIN)) - LOG_MIN) / -LOG_MIN));
