/**
 * Unit tests for fan-out enqueue helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSqsSend, MockSQSClient } = vi.hoisted(() => {
  const mockSqsSend = vi.fn();
  const MockSQSClient = vi.fn(function () {
    return { send: mockSqsSend };
  });
  return { mockSqsSend, MockSQSClient };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: MockSQSClient,
  SendMessageCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
}));

const { enqueueFanout, resetFanoutSqsClient } = await import(
  './fanout-enqueue.js'
);

const sampleJob = {
  type: 'schedule_changed' as const,
  teamId: 't1',
  eventId: 'e1',
};

describe('enqueueFanout', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetFanoutSqsClient();
    MockSQSClient.mockClear();
    mockSqsSend.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    process.env = { ...envBackup };
    delete process.env.FANOUT_QUEUE_URL;
    delete process.env.FANOUT_DELIVER_URL;
  });

  afterEach(() => {
    process.env = envBackup;
    vi.unstubAllGlobals();
    resetFanoutSqsClient();
  });

  it('does nothing when neither queue nor deliver URL is configured', async () => {
    await enqueueFanout(sampleJob);

    expect(MockSQSClient).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a message when FANOUT_QUEUE_URL is set', async () => {
    process.env.FANOUT_QUEUE_URL = 'https://sqs.example/queue';
    mockSqsSend.mockResolvedValueOnce({});

    await enqueueFanout(sampleJob);

    expect(MockSQSClient).toHaveBeenCalledOnce();
    expect(mockSqsSend).toHaveBeenCalledOnce();
    expect(mockSqsSend.mock.calls[0][0].input).toMatchObject({
      QueueUrl: 'https://sqs.example/queue',
      MessageBody: JSON.stringify(sampleJob),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts to the deliver URL when the queue URL is unset', async () => {
    process.env.FANOUT_DELIVER_URL = 'http://localhost:9000/fanout/deliver';
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    await enqueueFanout(sampleJob);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://localhost:9000/fanout/deliver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleJob),
    });
    expect(MockSQSClient).not.toHaveBeenCalled();
  });

  it('throws when the deliver URL returns a non-success status', async () => {
    process.env.FANOUT_DELIVER_URL = 'http://localhost:9000/fanout/deliver';
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    await expect(enqueueFanout(sampleJob)).rejects.toThrow(
      'fanout_deliver_failed_503',
    );
  });

  it('creates a fresh SQS client after resetFanoutSqsClient', async () => {
    process.env.FANOUT_QUEUE_URL = 'https://sqs.example/queue';
    mockSqsSend.mockResolvedValue({});

    await enqueueFanout(sampleJob);
    resetFanoutSqsClient();
    await enqueueFanout(sampleJob);

    expect(MockSQSClient).toHaveBeenCalledTimes(2);
  });
});
