/**
 * Child slots (adr-016, child data minimisation).
 *
 * A "child slot" holds only grade + school (+ curriculum). The child's name is no
 * longer collected. These helpers are pure so they can be tested without a database.
 */

export interface ChildSlotLike {
  grade?: string | null;
  schoolName?: string | null;
}

/** Human label for a slot, e.g. "Grade 5 slot at Brookhouse School". Never uses a name. */
export function childSlotLabel(slot: ChildSlotLike): string {
  const grade = slot.grade && slot.grade.trim() ? slot.grade.trim() : "your child";
  const school = slot.schoolName && slot.schoolName.trim() ? ` at ${slot.schoolName.trim()}` : "";
  return slot.grade && slot.grade.trim() ? `${grade} slot${school}` : `${grade}${school}`;
}

/**
 * Strip any stored legacy name from a child row before it leaves the API.
 * Existing names stay in the database (no data is dropped) but are not exposed.
 */
export function toChildSlot<T extends Record<string, any>>(
  child: T,
  index: number
): Omit<T, "name"> & { name: null; displayName: string } {
  const { name: _legacyName, ...rest } = child;
  const label = childSlotLabel({ grade: child.grade, schoolName: child.schoolName });
  return {
    ...rest,
    name: null,
    displayName: label || `Child slot ${index + 1}`,
  } as Omit<T, "name"> & { name: null; displayName: string };
}
