/**
 * Draft state for the emergency-info form, and the body it saves.
 */

import { MAX_EMERGENCY_CONTACTS, type MedicalInfo, type MedicalInfoBody } from '@gameplan/types';

/** Text fields on the form. */
export const MEDICAL_TEXT_FIELDS = ['allergies', 'conditions', 'medications', 'insurance', 'notes'] as const;

/** One of {@link MEDICAL_TEXT_FIELDS}. */
export type MedicalTextField = (typeof MEDICAL_TEXT_FIELDS)[number];

/** An emergency contact as typed. */
export type ContactDraft = { name: string; phone: string; relation: string };

/** The whole form as typed. */
export type MedicalDraft = Record<MedicalTextField, string> & { contacts: ContactDraft[] };

/**
 * The form filled from a saved record, with room for one more contact.
 *
 * @param info - The saved record.
 * @returns The draft.
 */
export const draftFromInfo = (info: MedicalInfo): MedicalDraft => {
  const contacts = info.emergencyContacts.map((contact) => ({
    name: contact.name,
    phone: contact.phone,
    relation: contact.relation ?? '',
  }));
  return {
    allergies: info.allergies ?? '',
    conditions: info.conditions ?? '',
    medications: info.medications ?? '',
    insurance: info.insurance ?? '',
    notes: info.notes ?? '',
    contacts: contacts.length < MAX_EMERGENCY_CONTACTS ? [...contacts, { name: '', phone: '', relation: '' }] : contacts,
  };
};

/**
 * The body to save: blank fields left out, empty contact rows dropped.
 *
 * @param draft - The form.
 * @returns The request body.
 * @throws `contact_incomplete` when a contact has a name or phone but not both.
 */
export const bodyFromDraft = (draft: MedicalDraft): MedicalInfoBody => {
  const text = Object.fromEntries(
    MEDICAL_TEXT_FIELDS.flatMap((field) => {
      const value = draft[field].trim();
      return value.length > 0 ? [[field, value]] : [];
    }),
  ) as Partial<Record<MedicalTextField, string>>;
  const contacts = draft.contacts
    .map((contact) => ({ name: contact.name.trim(), phone: contact.phone.trim(), relation: contact.relation.trim() }))
    .filter((contact) => contact.name.length > 0 || contact.phone.length > 0);
  if (contacts.some((contact) => contact.name.length === 0 || contact.phone.length === 0)) {
    throw new Error('contact_incomplete');
  }
  return {
    ...text,
    emergencyContacts: contacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      ...(contact.relation.length > 0 ? { relation: contact.relation } : {}),
    })) as MedicalInfoBody['emergencyContacts'],
  };
};
