/** Allowed geofence radii (meters) — matches DB `radius_meters` on `nudges` and `locations`. */
export const RADIUS_STEPS_METERS = [10, 15, 20, 25, 30, 50, 75, 100] as const

export type RadiusMeters = (typeof RADIUS_STEPS_METERS)[number]

export function snapMetersToStep(m: number): RadiusMeters {
  return RADIUS_STEPS_METERS.reduce((best, v) =>
    Math.abs(v - m) < Math.abs(best - m) ? v : best,
  )
}
