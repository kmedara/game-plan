/**
 * Team dues queries and the writes that update them.
 *
 * Nothing here is persisted to device storage: payment status must come from
 * the server so a stale "unpaid" never invites a second payment.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { CreateChargeBody, UpdateDueBody } from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const paymentAccountQuery = (api: Pick<ApiClient, 'getPaymentAccount'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.paymentAccount(teamId), queryFn: () => api.getPaymentAccount(teamId) });

export const chargesQuery = (api: Pick<ApiClient, 'listCharges'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.charges(teamId), queryFn: () => api.listCharges(teamId) });

export const chargeQuery = (api: Pick<ApiClient, 'getCharge'>, teamId: string, chargeId: string) =>
  queryOptions({ queryKey: queryKeys.charge(teamId, chargeId), queryFn: () => api.getCharge(teamId, chargeId) });

export const myDuesQuery = (api: Pick<ApiClient, 'listMyDues'>) =>
  queryOptions({ queryKey: queryKeys.myDues, queryFn: () => api.listMyDues() });

/**
 * Refetches everything a payment can change: the team's charges and the
 * caller's own dues.
 *
 * @param queryClient - The app client.
 * @param teamId - The team, when known.
 */
export const refreshPayments = (queryClient: QueryClient, teamId?: string): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.myDues }),
    ...(teamId === undefined
      ? []
      : [
          queryClient.invalidateQueries({ queryKey: queryKeys.paymentAccount(teamId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.charges(teamId) }),
          queryClient.invalidateQueries({ queryKey: ['charge', teamId] }),
        ]),
  ]);

export const createChargeMutation = (api: Pick<ApiClient, 'createCharge'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (body: CreateChargeBody) => api.createCharge(teamId, body),
    onSuccess: () => refreshPayments(queryClient, teamId),
  });

export const updateDueMutation = (
  api: Pick<ApiClient, 'updateDue'>,
  queryClient: QueryClient,
  teamId: string,
  chargeId: string,
) =>
  mutationOptions({
    mutationFn: ({ memberId, status }: { memberId: string; status: UpdateDueBody['status'] }) =>
      api.updateDue(teamId, chargeId, memberId, { status }),
    onSuccess: () => refreshPayments(queryClient, teamId),
  });
