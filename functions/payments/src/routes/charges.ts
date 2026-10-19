/**
 * Charges staff create, and the per-member dues behind them.
 */

import { createChargeBodySchema, updateDueBodySchema } from '@gameplan/schemas';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  chargeDetail,
  createCharge,
  getStripeAccount,
  listCharges,
  setDueStatusByStaff,
} from '../payments-store.js';
import { withPaymentsErrors } from './errors.js';

/**
 * `POST /payments/teams/:teamId/charges`
 *
 * Asks the listed members to pay. The team's Stripe account must be able to
 * take charges first, so nobody is asked for money they cannot pay.
 */
export const handleCreateCharge = route(
  'POST',
  '/payments/teams/:teamId/charges',
  withPaymentsErrors(),
  requireUser(),
  withBodyValidation(createChargeBodySchema),
  requireMembership(),
  requirePermission('manage_payments'),
  async ({ teamId, user, body }) => {
    const account = await getStripeAccount(teamId);
    if (account?.chargesEnabled !== true) throw new Error('payments_not_enabled');
    return json(201, await createCharge({ teamId, createdBy: user.userId, body }));
  },
);

/** `GET /payments/teams/:teamId/charges` */
export const handleListCharges = route(
  'GET',
  '/payments/teams/:teamId/charges',
  withPaymentsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_payments'),
  async ({ teamId }) => json(200, { teamId, charges: await listCharges(teamId) }),
);

/** `GET /payments/teams/:teamId/charges/:chargeId` */
export const handleGetCharge = route(
  'GET',
  '/payments/teams/:teamId/charges/:chargeId',
  withPaymentsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_payments'),
  async ({ teamId, chargeId }) => json(200, await chargeDetail(teamId, chargeId)),
);

/**
 * `PATCH /payments/teams/:teamId/charges/:chargeId/dues/:memberId`
 *
 * Staff record cash or another app, waive a due, or undo either.
 */
export const handleUpdateDue = route(
  'PATCH',
  '/payments/teams/:teamId/charges/:chargeId/dues/:memberId',
  withPaymentsErrors(),
  requireUser(),
  withBodyValidation(updateDueBodySchema),
  requireMembership(),
  requirePermission('manage_payments'),
  async ({ teamId, chargeId, memberId, user, body }) =>
    json(
      200,
      await setDueStatusByStaff({ teamId, chargeId, memberId, status: body.status, staffId: user.userId }),
    ),
);
