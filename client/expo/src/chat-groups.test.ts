/**
 * Chat sections keep each team's chats under that team.
 */

import type { ChatSummary } from '@gameplan/types';
import { groupChatsByTeam } from './chat-groups';

const chat = (chatId: string, kind: ChatSummary['kind'], teamId?: string): ChatSummary => ({
  chatId,
  kind,
  name: chatId,
  ...(teamId !== undefined ? { teamId } : {}),
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('groupChatsByTeam', () => {
  it('keeps team chats under their team and private chats separate', () => {
    const grouped = groupChatsByTeam(
      [{ teamId: 'east', name: 'East' }, { teamId: 'west', name: 'West' }],
      [
        chat('west-channel', 'channel', 'west'),
        chat('dm', 'private'),
        chat('east-team', 'default', 'east'),
        chat('west-team', 'default', 'west'),
        chat('east-channel', 'channel', 'east'),
      ],
    );

    expect(grouped.sections.map((section) => section.team.name)).toEqual(['East', 'West']);
    expect(grouped.sections[0]?.chats.map((item) => item.chatId)).toEqual(['east-team', 'east-channel']);
    expect(grouped.sections[1]?.chats.map((item) => item.chatId)).toEqual(['west-team', 'west-channel']);
    expect(grouped.privateChats.map((item) => item.chatId)).toEqual(['dm']);
  });
});
