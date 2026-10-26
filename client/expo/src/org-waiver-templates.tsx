/**
 * Organization waiver templates: an admin writes one, and each member team
 * attaches its own copy from its waivers screen. Needs the organization plan.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { effectivePlanTier } from '@gameplan/rules';
import type { OrgDetail, TeamRole, WaiverTemplate } from '@gameplan/types';
import {
  createOrgWaiverTemplateMutation,
  deleteOrgWaiverTemplateMutation,
  orgWaiverTemplatesQuery,
  updateOrgWaiverTemplateMutation,
} from './queries/waivers';
import { useApp } from './state';
import { Button, ErrorText, Field, SubmitButton } from './ui';
import { AudiencePicker } from './waivers';

/** Which template the form edits: `new`, an existing one, or none (form closed). */
type Editing = 'new' | WaiverTemplate | undefined;

export const OrgWaiverTemplates = ({ org, message }: { org: OrgDetail; message: (err: unknown) => string }) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const paid = effectivePlanTier(org.plan) === 'organization';
  const templates = useQuery({ ...orgWaiverTemplatesQuery(api, org.orgId), enabled: paid });
  const remove = useMutation(deleteOrgWaiverTemplateMutation(api, queryClient, org.orgId));
  const [editing, setEditing] = useState<Editing>();
  const [confirming, setConfirming] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  return (
    <View className="mb-8">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('waivers.templates')}</Text>
      {!paid ? (
        <Text className="text-muted">{t('waivers.templatesNeedPlan')}</Text>
      ) : (
        <>
          <Text className="mb-2 text-muted">{t('waivers.templatesHint')}</Text>
          <ErrorText message={error} />
          {templates.data?.templates.map((template) => (
            <View key={template.templateId} className="mb-2 rounded-xl bg-inset p-3">
              <Text className="font-semibold text-ink">{template.title}</Text>
              <Text className="text-muted">{template.audience.map((role) => t(`role.${role}`)).join(', ')}</Text>
              <View className="mt-1 flex-row">
                <Pressable accessibilityRole="button" className="mr-4 py-1" onPress={() => setEditing(template)}>
                  <Text style={{ color: brand.secondary }}>{t('waivers.edit')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  className="mr-4 py-1"
                  onPress={() => {
                    if (confirming !== template.templateId) {
                      setConfirming(template.templateId);
                      return;
                    }
                    setError(undefined);
                    remove.mutate(template.templateId, {
                      onSuccess: () => setConfirming(undefined),
                      onError: (err) => setError(message(err)),
                    });
                  }}
                >
                  <Text style={{ color: brand.secondary }}>
                    {confirming === template.templateId ? t('waivers.deleteConfirm') : t('waivers.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
          {editing === undefined ? (
            <Button label={t('waivers.newTemplate')} tone="secondary" onPress={() => setEditing('new')} />
          ) : (
            <TemplateForm
              key={editing === 'new' ? 'new' : editing.templateId}
              orgId={org.orgId}
              template={editing === 'new' ? undefined : editing}
              message={message}
              onDone={() => setEditing(undefined)}
            />
          )}
        </>
      )}
    </View>
  );
};

/** Title, body, and audience for a new or existing template. */
const TemplateForm = ({
  orgId,
  template,
  message,
  onDone,
}: {
  orgId: string;
  template: WaiverTemplate | undefined;
  message: (err: unknown) => string;
  onDone: () => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const create = useMutation(createOrgWaiverTemplateMutation(api, queryClient, orgId));
  const update = useMutation(updateOrgWaiverTemplateMutation(api, queryClient, orgId));
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [audience, setAudience] = useState<TeamRole[]>(template?.audience ?? ['player']);
  const roles: [TeamRole, ...TeamRole[]] = [audience[0] ?? 'player', ...audience.slice(1)];

  return (
    <View className="mb-2 rounded-xl border border-line bg-raised p-3">
      <Field label={t('waivers.titleField')} value={title} onChangeText={setTitle} placeholder={t('waivers.titleHint')} />
      <Field label={t('waivers.bodyField')} value={body} onChangeText={setBody} multiline />
      <AudiencePicker value={audience} onChange={setAudience} />
      {template !== undefined ? <Text className="mb-3 text-sm text-muted">{t('waivers.templateEditNote')}</Text> : null}
      <SubmitButton
        label={template === undefined ? t('waivers.addTemplate') : t('common.save')}
        disabled={title.trim().length === 0 || body.trim().length === 0}
        loadedText=""
        onPress={async () => {
          const fields = { title: title.trim(), body: body.trim(), audience: roles };
          if (template === undefined) await create.mutateAsync(fields);
          else await update.mutateAsync({ templateId: template.templateId, body: fields });
          onDone();
          return true;
        }}
        message={message}
      />
      <Button label={t('common.cancel')} tone="secondary" onPress={onDone} />
    </View>
  );
};
