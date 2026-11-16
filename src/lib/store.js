// Which store rewards a student may see and buy, and which staff may manage or fulfil them.
//
// Rewards are either SCHOOL rewards (owner_id IS NULL, managed by Admins) or CUSTOM rewards
// (owner_id = a teacher). A student can use a reward when:
//   - it is a school reward and the student is in no active class, or is in an active class
//     that has not chosen its own rewards yet (the default is "every school reward"), or
//   - the reward is switched on in at least one active class the student is in.
// Custom rewards are only ever reachable through a class that switched them on.
//
// The student id is spliced in as an integer literal (never user text), which lets this one
// fragment be reused inside several statements without juggling bound parameters.

export function availableSql(studentId, alias = 'i') {
  const s = Number(studentId);
  if (!Number.isSafeInteger(s)) throw new Error('availableSql needs an integer student id');
  const active = `FROM class_members m JOIN classes c ON c.id = m.class_id WHERE m.student_id = ${s} AND c.archived = 0`;
  return `(${alias}.active = 1 AND (
    (${alias}.owner_id IS NULL AND (
      NOT EXISTS (SELECT 1 ${active})
      OR EXISTS (SELECT 1 ${active} AND c.rewards_configured = 0)))
    OR EXISTS (SELECT 1 FROM class_members m JOIN classes c ON c.id = m.class_id JOIN class_rewards r ON r.class_id = c.id
                WHERE m.student_id = ${s} AND c.archived = 0 AND r.item_id = ${alias}.id)))`;
}

export const isAdminUser = (user) => user.role === 'admin';
export const canManageItem = (user, item) => isAdminUser(user) || (item.owner_id !== null && item.owner_id === user.id);
export const canSeeItem = (user, item) => isAdminUser(user) || item.owner_id === null || item.owner_id === user.id;
