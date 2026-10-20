/**
 * Emergency and medical info for the caller and the children they are a
 * guardian of. Team staff read it through `GET /teams/:teamId/members/:userId/medical`.
 */

import { canEditMedicalInfo, canReadOwnMedicalInfo } from '@gameplan/rules';
import { medicalInfoBodySchema } from '@gameplan/schemas';
import type { MedicalPerson } from '@gameplan/schemas';
import { getProfile, requireUser } from '../../../lib/auth/index.js';
import { listChildIds } from '../../../lib/guardians.js';
import { json } from '../../../lib/http.js';
import { getMedicalInfo, medicalSubject, putMedicalInfo } from '../../../lib/medical.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { withIdentityErrors } from './session.js';

/**
 * One person's entry for the caller.
 *
 * @param callerId - The caller.
 * @param userId - The person.
 * @returns Their entry, or `undefined` when the caller may not read it.
 */
const personFor = async (callerId: string, userId: string): Promise<MedicalPerson | undefined> => {
  const [profile, subject] = await Promise.all([getProfile(userId), medicalSubject(userId)]);
  if (profile === undefined || subject === undefined || !canReadOwnMedicalInfo(callerId, subject)) return undefined;
  return {
    userId,
    displayName: profile.displayName,
    accountKind: profile.accountKind,
    canEdit: canEditMedicalInfo(callerId, subject),
    info: await getMedicalInfo(userId),
  };
};

/** `GET /identity/medical` — the caller's own record and each child's. */
export const handleListMedical = route(
  'GET',
  '/identity/medical',
  withIdentityErrors(),
  requireUser(),
  async ({ user }) => {
    const ids = [user.userId, ...(await listChildIds(user.userId))];
    const people = (await Promise.all(ids.map((id) => personFor(user.userId, id)))).filter(
      (person): person is MedicalPerson => person !== undefined,
    );
    return json(200, { people });
  },
);

/** `PUT /identity/medical/:userId` — an adult saves their own record; a guardian saves a child's. */
export const handlePutMedical = route(
  'PUT',
  '/identity/medical/:userId',
  withIdentityErrors(),
  requireUser(),
  withBodyValidation(medicalInfoBodySchema),
  async ({ userId, user, body }) => {
    const subject = await medicalSubject(userId);
    if (subject === undefined) throw new Error('profile_not_found');
    if (!canEditMedicalInfo(user.userId, subject)) throw new Error('forbidden');
    return json(200, await putMedicalInfo(userId, body, user.userId));
  },
);
