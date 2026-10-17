/**
 * Presigned download URLs. These expire, so they are never written to device storage.
 */

import { queryOptions } from '@tanstack/react-query';
import type { ApiClient } from '../api';
import { queryKeys, type DownloadContext } from './keys';

/** Reuse a URL until shortly before the 15-minute signature expires. */
export const DOWNLOAD_STALE_MS = 10 * 60 * 1000;

/** Drop unused URLs when the signature would have expired. */
export const DOWNLOAD_GC_MS = 15 * 60 * 1000;

export const downloadQuery = (
  api: Pick<ApiClient, 'presignDownload'>,
  key: string,
  context: DownloadContext,
) =>
  queryOptions({
    queryKey: queryKeys.download(key, context),
    queryFn: async () => {
      const download = await api.presignDownload(key, {
        ...(context.chatId !== undefined ? { chatId: context.chatId } : {}),
        ...(context.userId !== undefined ? { userId: context.userId } : {}),
        ...(context.teamId !== undefined ? { teamId: context.teamId } : {}),
      });
      return download.downloadUrl;
    },
    staleTime: DOWNLOAD_STALE_MS,
    gcTime: DOWNLOAD_GC_MS,
  });
