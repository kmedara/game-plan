/**
 * The emergency-info form keeps what was typed and saves only what is filled in.
 */

import { bodyFromDraft, draftFromInfo } from './medical-form';

describe('medical form', () => {
  it('adds an empty contact row and drops it again on save', () => {
    const draft = draftFromInfo({ userId: 'u', allergies: 'Peanuts', emergencyContacts: [] });
    expect(draft.contacts).toHaveLength(1);
    expect(bodyFromDraft(draft)).toEqual({ allergies: 'Peanuts', emergencyContacts: [] });
  });

  it('trims fields and keeps a relation only when given', () => {
    const draft = draftFromInfo({ userId: 'u', emergencyContacts: [] });
    draft.notes = '  inhaler in bag  ';
    draft.contacts = [{ name: ' Aunt May ', phone: '202 555 0100', relation: ' ' }];
    expect(bodyFromDraft(draft)).toEqual({
      notes: 'inhaler in bag',
      emergencyContacts: [{ name: 'Aunt May', phone: '202 555 0100' }],
    });
  });

  it('refuses a contact with a name but no phone', () => {
    const draft = draftFromInfo({ userId: 'u', emergencyContacts: [] });
    draft.contacts = [{ name: 'Aunt May', phone: '', relation: '' }];
    expect(() => bodyFromDraft(draft)).toThrow('contact_incomplete');
  });
});
