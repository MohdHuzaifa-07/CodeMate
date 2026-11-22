/** Allows at most `max` events per `windowMs` for one user and one kind of event. */
export function allowEvent(user, key, max, windowMs = 1000) {
  const now = Date.now();
  user.limits ??= {};
  const w = user.limits[key];
  if (!w || now - w.start >= windowMs) {
    user.limits[key] = { start: now, count: 1 };
    return true;
  }
  w.count += 1;
  return w.count <= max;
}