/**
 * Image picking, upload limits, and download URLs that ignore out-of-date responses.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { pickAndUploadImage, useDownloadUrl } from './media';
import { createTestQueryClient, queryWrapper } from './test-query';

const mockPresignDownload = jest.fn();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

const mockSaveAsync = jest.fn();
const mockManipulate = jest.fn();
const mockResize = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: (...args: unknown[]) => {
      mockManipulate(...args);
      return {
        resize: (...size: unknown[]) => mockResize(...size),
        renderAsync: async () => ({ saveAsync: (...save: unknown[]) => mockSaveAsync(...save) }),
      };
    },
  },
}));

jest.mock('./state', () => {
  const app = { api: { presignDownload: (...args: unknown[]) => mockPresignDownload(...args) } };
  return { useApp: () => app };
});

const pick = ImagePicker.launchImageLibraryAsync as jest.Mock;

const picked = (mimeType: string | undefined, width = 400, height = 300) => ({
  canceled: false,
  assets: [{ uri: 'file:///photo', mimeType, width, height }],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('pickAndUploadImage', () => {
  const presignUpload = jest.fn();
  const fetchMock = jest.fn();

  beforeEach(() => {
    pick.mockReset();
    mockManipulate.mockReset();
    mockResize.mockReset();
    mockSaveAsync.mockReset();
    presignUpload.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  /** First fetch reads the local file, second is the presigned PUT. */
  const stubFile = (size: number, uploadOk = true): void => {
    fetchMock
      .mockResolvedValueOnce({ blob: async () => ({ size }) })
      .mockResolvedValueOnce({ ok: uploadOk });
  };

  it('returns undefined when the picker is canceled', async () => {
    pick.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickAndUploadImage({ presignUpload })).resolves.toBeUndefined();
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('uploads with the picked type and returns the key and local uri', async () => {
    pick.mockResolvedValueOnce(picked('image/png'));
    stubFile(1000);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'users/u1/a.png' });

    await expect(pickAndUploadImage({ presignUpload }, { quality: 0.8 })).resolves.toEqual({
      key: 'users/u1/a.png',
      uri: 'file:///photo',
    });
    expect(pick).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 0.8 });
    expect(presignUpload).toHaveBeenCalledWith('image/png', 1000);
    expect(fetchMock).toHaveBeenLastCalledWith('https://upload', {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: { size: 1000 },
    });
  });

  it('uploads AVIF as is and re-encodes HEIC as JPEG', async () => {
    pick.mockResolvedValueOnce(picked('image/avif'));
    stubFile(10);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'a' });
    await expect(pickAndUploadImage({ presignUpload })).resolves.toEqual({ key: 'a', uri: 'file:///photo' });
    expect(presignUpload).toHaveBeenLastCalledWith('image/avif', 10);
    expect(mockManipulate).not.toHaveBeenCalled();

    pick.mockResolvedValueOnce(picked('image/heic'));
    mockSaveAsync.mockResolvedValueOnce({ uri: 'file:///photo.jpg' });
    stubFile(10);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'h' });
    await expect(pickAndUploadImage({ presignUpload }, { quality: 0.7 })).resolves.toEqual({
      key: 'h',
      uri: 'file:///photo.jpg',
    });
    expect(mockManipulate).toHaveBeenCalledWith('file:///photo');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7 });
    expect(fetchMock).toHaveBeenCalledWith('file:///photo.jpg');
    expect(presignUpload).toHaveBeenLastCalledWith('image/jpeg', 10);
  });

  it('scales the longest side down to maxDimension and keeps smaller images as they are', async () => {
    pick.mockResolvedValueOnce(picked('image/jpeg', 3000, 4000));
    mockSaveAsync.mockResolvedValueOnce({ uri: 'file:///small.jpg' });
    stubFile(10);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'p' });
    await expect(pickAndUploadImage({ presignUpload }, { quality: 0.8, maxDimension: 512 })).resolves.toEqual({
      key: 'p',
      uri: 'file:///small.jpg',
    });
    expect(mockResize).toHaveBeenCalledWith({ height: 512 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
    expect(presignUpload).toHaveBeenLastCalledWith('image/jpeg', 10);

    pick.mockResolvedValueOnce(picked('image/png', 2000, 1000));
    mockSaveAsync.mockResolvedValueOnce({ uri: 'file:///small.png' });
    stubFile(10);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'q' });
    await pickAndUploadImage({ presignUpload }, { maxDimension: 512 });
    expect(mockResize).toHaveBeenLastCalledWith({ width: 512 });
    expect(mockSaveAsync).toHaveBeenLastCalledWith({ format: 'png' });
    expect(presignUpload).toHaveBeenLastCalledWith('image/png', 10);

    mockManipulate.mockReset();
    pick.mockResolvedValueOnce(picked('image/jpeg', 512, 300));
    stubFile(10);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'r' });
    await expect(pickAndUploadImage({ presignUpload }, { maxDimension: 512 })).resolves.toEqual({
      key: 'r',
      uri: 'file:///photo',
    });
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('checks the allowed set against the type that would be uploaded', async () => {
    pick.mockResolvedValueOnce(picked('image/png'));
    await expect(
      pickAndUploadImage({ presignUpload }, { types: new Set(['image/jpeg']) }),
    ).resolves.toEqual({ error: 'bad_type' });
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('reports a failed re-encode as upload_failed', async () => {
    pick.mockResolvedValueOnce(picked('image/heic'));
    mockSaveAsync.mockRejectedValueOnce(new Error('decode'));
    await expect(pickAndUploadImage({ presignUpload })).resolves.toEqual({ error: 'upload_failed' });
  });

  it('reports files over the size limit without presigning', async () => {
    pick.mockResolvedValueOnce(picked(undefined));
    fetchMock.mockResolvedValueOnce({ blob: async () => ({ size: 11 }) });
    await expect(pickAndUploadImage({ presignUpload }, { maxBytes: 10 })).resolves.toEqual({ error: 'too_large' });
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('reports a failed PUT or presign as upload_failed', async () => {
    pick.mockResolvedValueOnce(picked('image/jpeg'));
    stubFile(10, false);
    presignUpload.mockResolvedValueOnce({ uploadUrl: 'https://upload', objectKey: 'k' });
    await expect(pickAndUploadImage({ presignUpload })).resolves.toEqual({ error: 'upload_failed' });

    pick.mockResolvedValueOnce(picked('image/jpeg'));
    fetchMock.mockResolvedValueOnce({ blob: async () => ({ size: 10 }) });
    presignUpload.mockRejectedValueOnce(new Error('http_500'));
    await expect(pickAndUploadImage({ presignUpload })).resolves.toEqual({ error: 'upload_failed' });
  });
});

describe('useDownloadUrl', () => {
  beforeEach(() => {
    mockPresignDownload.mockReset();
  });

  it('loads the URL with only the context fields that are set', async () => {
    mockPresignDownload.mockResolvedValueOnce({ downloadUrl: 'https://logo' });
    const { result } = renderHook(() => useDownloadUrl('teams/t1/logo', { teamId: 't1' }), {
      wrapper: queryWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current).toBe('https://logo'));
    expect(mockPresignDownload).toHaveBeenCalledWith('teams/t1/logo', { teamId: 't1' });
  });

  it('returns undefined without a request when there is no key', () => {
    const { result } = renderHook(() => useDownloadUrl(undefined), {
      wrapper: queryWrapper(createTestQueryClient()),
    });
    expect(result.current).toBeUndefined();
    expect(mockPresignDownload).not.toHaveBeenCalled();
  });

  it('never shows the previous key while the next one loads, and drops late responses', async () => {
    const first = deferred<{ downloadUrl: string }>();
    const second = deferred<{ downloadUrl: string }>();
    mockPresignDownload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useDownloadUrl(key, { teamId: 't' }),
      {
        initialProps: { key: 'a' },
        wrapper: queryWrapper(createTestQueryClient()),
      },
    );
    rerender({ key: 'b' });
    await act(async () => {
      first.resolve({ downloadUrl: 'https://a' });
    });
    expect(result.current).toBeUndefined();

    await act(async () => {
      second.resolve({ downloadUrl: 'https://b' });
    });
    await waitFor(() => expect(result.current).toBe('https://b'));
  });
});
