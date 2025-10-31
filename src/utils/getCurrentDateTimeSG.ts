import { DateTime } from "luxon";

/**
 * Returns the current date-time string in Singapore timezone,
 * formatted like a native JS Date.toString() output.
 */
export function getCurrentDateTimeSG(): string {
  const nowInSG = DateTime.now().setZone("Asia/Singapore");
  const basicFormat = nowInSG.toFormat("EEE MMM dd yyyy HH:mm:ss");
  const offset = nowInSG.toFormat("ZZ").replace(":", ""); // e.g. +0800
  const offsetString = `GMT${offset}`;
  const timezoneName = `(${nowInSG.offsetNameLong})`;
  return `${basicFormat} ${offsetString} ${timezoneName}`;
}
