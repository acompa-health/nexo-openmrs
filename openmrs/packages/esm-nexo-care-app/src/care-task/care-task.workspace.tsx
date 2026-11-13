import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type KeyedMutator, useSWRConfig } from 'swr';
import { InlineLoading, InlineNotification, Tag } from '@carbon/react';
import { type Encounter, ExtensionSlot, showSnackbar, useConfig, useSession, Workspace2 } from '@openmrs/esm-framework';
import {
  type FormRendererProps,
  invalidateVisitAndEncounterData,
  type PatientWorkspace2DefinitionProps,
  type PatientWorkspaceGroupProps,
} from '@openmrs/esm-patient-common-lib';
import { type NexoCareConfig } from '../config-schema';
import { findStart, logUrl, recordEncounter, RefusedEntry, useCarePathway } from '../nexo.resource';
import { contextLines, formatInstant } from '../display';
import { dueStatus } from '../display-rules';
import { refreshVitals } from '../refresh-vitals';
import { type CareTaskWorkspaceProps } from './care-task.types';
import styles from './care-task.scss';

type Prefill = Record<string, { value: string; from: string }>;

/** After the form engine saves: recording in the log, or the reason the pathway did not record it. */
type Outcome = { state: 'recording' } | { state: 'failed'; encounterUuid: string; refused: boolean; reasons: Array<string> };

/**
 * A generated form for one step of the pathway: the task context from Nexo above the stock O3 form engine
 * (`form-widget-slot`). When the form engine saves the encounter, the host turns it into a Nexo log entry. Core
 * checks the entry first. If Core refuses it, the pathway log stores nothing (the O3 encounter stays in the chart), the
 * workspace stays open with Core's reasons, and the form reopens on the saved encounter so the person can correct it
 * and save again.
 */
const CareTaskWorkspace: React.FC<PatientWorkspace2DefinitionProps<CareTaskWorkspaceProps, object>> = ({
  workspaceProps,
  groupProps,
  closeWorkspace,
}) => {
  const { t } = useTranslation();
  const { recording, title, starts, formUuid, work: ref } = workspaceProps as CareTaskWorkspaceProps;
  const { patientUuid, patient, visitContext, mutateVisitContext } = groupProps as PatientWorkspaceGroupProps;
  const { protocolName } = useConfig<NexoCareConfig>();
  const { loaded, session, facts, error, isLoading } = useCarePathway(patientUuid, protocolName);
  const user = useSession()?.user?.uuid;
  const { mutate: globalMutate } = useSWRConfig();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | undefined>();

  const host = loaded?.host;
  const form = host?.forms.get(recording.formName);
  const task = useMemo(
    () => (ref && host && session ? host.tasks(session).find((x) => x.work.ref.id === ref.id && x.work.ref.occurrence === ref.occurrence) : undefined),
    [host, ref, session],
  );
  const startOpen = useMemo(
    () => (recording.how === 'start' && host && session ? !!findStart(host, session, recording.formName, recording.workflow, recording.choice) : true),
    [host, recording, session],
  );
  // An event form (a reading) stays usable when the task tile that offered it closes: the event does not complete it.
  const closed = !!session && !outcome && ((!!ref && !task && recording.how !== 'event') || !startOpen);

  // The prefill is fixed when the form opens, so a log refresh does not reset what the person typed.
  const [prefill, setPrefill] = useState<Prefill | undefined>();
  useEffect(() => {
    if (prefill || !host || !session || !form || closed) return;
    setPrefill(host.prefillWithSources(session, form, task?.work, recording.how === 'update' ? recording.object : undefined));
  }, [closed, form, host, prefill, recording, session, task]);
  const preFilledQuestions = useMemo(
    () => (prefill ? Object.fromEntries(Object.entries(prefill).map(([id, p]) => [id, p.value])) : undefined),
    [prefill],
  );

  // Recording finishes after the form engine returns. By then the person may have closed this workspace, or the same
  // workspace may show another task. `closeWorkspace` closes by name, so act only while this instance still shows
  // the props it had at submit.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentProps = useRef(workspaceProps);
  currentProps.current = workspaceProps;

  // The form engine calls this after it saves the encounter. It reads the latest values from a ref.
  const latest = useRef({ host, facts, user });
  latest.current = { host, facts, user };
  const handlePostResponse = useCallback(
    (encounter: Encounter) => {
      const { host: h, facts: f, user: u } = latest.current;
      const submittedWith = currentProps.current;
      const stillOpen = () => mounted.current && currentProps.current === submittedWith;
      mutateVisitContext?.();
      void refreshVitals(globalMutate, patientUuid).catch(() => {
        showSnackbar({ kind: 'warning', title: t('vitalsRefreshFailed', 'Vitals could not refresh. Reload the chart.') });
      });
      invalidateVisitAndEncounterData(globalMutate as unknown as KeyedMutator<unknown>, patientUuid);
      if (!h || !f) return;
      setOutcome({ state: 'recording' });
      recordEncounter(h, f, recording, encounter.uuid, u)
        .then(() => {
          globalMutate(logUrl(patientUuid));
          showSnackbar({ kind: 'success', title: t('stepRecorded', 'Step recorded in the care pathway'), subtitle: title });
          if (stillOpen()) closeWorkspace({ discardUnsavedChanges: true });
        })
        .catch((e: Error) => {
          globalMutate(logUrl(patientUuid));
          const refused = e instanceof RefusedEntry;
          const reasons = refused ? (e as RefusedEntry).reasons : [e.message];
          if (stillOpen()) {
            setOutcome({ state: 'failed', encounterUuid: encounter.uuid, refused, reasons });
          } else {
            showSnackbar({
              kind: 'error',
              isLowContrast: false,
              title: t('stepNotRecordedNamed', 'The care pathway did not record: {{title}}', { title }),
              subtitle: `${reasons.join('; ')} ${t('encounterStays', 'The encounter stays in the chart.')}`,
            });
          }
        });
    },
    [closeWorkspace, globalMutate, mutateVisitContext, patientUuid, recording, t, title],
  );

  // After a failure, the form edits the encounter that was already saved instead of making a second one.
  const savedEncounter = outcome?.state === 'failed' ? outcome.encounterUuid : undefined;
  const state = useMemo(
    () =>
      ({
        formUuid,
        patientUuid,
        patient,
        visit: visitContext ?? undefined,
        visitUuid: visitContext?.uuid,
        encounterUuid: savedEncounter ?? '',
        additionalProps: { mode: savedEncounter ? 'edit' : 'enter' },
        // On the saved encounter the form shows what was saved; a prefill would refill values the person cleared.
        preFilledQuestions: savedEncounter ? undefined : preFilledQuestions,
        handlePostResponse,
        closeWorkspace: () => closeWorkspace(),
        // The form engine calls this before `handlePostResponse`. The workspace stays open until the pathway has
        // recorded the step, so a refusal can be shown here; until then closing it prompts (see `unsaved` below).
        closeWorkspaceWithSavedChanges: () => undefined,
        setHasUnsavedChanges,
      }) satisfies FormRendererProps,
    [closeWorkspace, formUuid, handlePostResponse, patient, patientUuid, preFilledQuestions, savedEncounter, visitContext],
  );

  // From submit until the step is recorded, and after a refusal or failure, closing must prompt: the encounter is
  // saved in the chart, but the pathway has not recorded the step.
  const unsaved = hasUnsavedChanges || outcome !== undefined;

  const prefilledLines = useMemo(
    () => (form && prefill ? form.questions.filter((q) => prefill[q.id]).map((q) => `${q.label} ← ${prefill[q.id].from}`) : []),
    [form, prefill],
  );

  return (
    <Workspace2 title={title} hasUnsavedChanges={unsaved}>
      <div className={styles.container}>
        <div className={styles.context}>
          <p className={styles.kicker}>{t('carePathwayStep', 'Care pathway step')}</p>
          <h4 className={styles.title}>{task?.title ?? title}</h4>
          <div className={styles.meta}>
            {task?.roleLabel && (
              <Tag type="purple" size="sm">
                {task.roleLabel}
              </Tag>
            )}
            {task?.due && (
              <Tag type={dueStatus(task.due) === 'overdue' ? 'red' : 'gray'} size="sm">
                {dueStatus(task.due) === 'overdue' ? t('overdueSince', 'Overdue since') : dueStatus(task.due) === 'now' ? t('dueNow', 'Due now') : t('due', 'Due')} {formatInstant(task.due)}
              </Tag>
            )}
            {loaded && (
              <Tag type="warm-gray" size="sm">
                {t('draftShort', 'Draft · Simulation · Not for care')}
              </Tag>
            )}
          </div>
          {starts && (
            <p className={styles.note}>{t('startsPathway', 'Saving this form starts the pathway: {{name}}', { name: starts })}</p>
          )}
          {task && contextLines(task).length > 0 && (
            <>
              <p className={styles.subhead}>{t('fromThePathway', 'From the pathway')}</p>
              <dl className={styles.contextList}>
                {contextLines(task).map((c) => (
                  <React.Fragment key={c.key}>
                    <dt>{c.label}</dt>
                    <dd>{c.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </>
          )}
          {task && task.missing.length > 0 && (
            <p className={styles.note}>
              {t('missingInformation', 'Missing information')}: {task.missing.map((m) => m.label).join(', ')}
            </p>
          )}
          {prefilledLines.length > 0 && (
            <>
              <p className={styles.subhead}>{t('prefilledTitle', 'Prefilled. Check each value before you save')}</p>
              <ul className={styles.prefilled}>
                {prefilledLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        {outcome?.state === 'recording' && (
          <InlineLoading className={styles.status} description={t('recording', 'Recording the step in the care pathway...')} />
        )}
        {outcome?.state === 'failed' && (
          <InlineNotification
            className={styles.status}
            kind="error"
            lowContrast
            hideCloseButton
            title={
              outcome.refused
                ? t('stepRefused', 'Nexo Core did not accept this step, so the care pathway did not record it')
                : t('stepNotRecorded', 'The encounter was saved, but the care pathway did not record it')
            }
            subtitle={`${outcome.reasons.join('; ')} ${t(
              'correctAndSave',
              'The encounter stays in the chart, but the care pathway has not recorded this step. Correct the form and save it again: the same encounter is updated.',
            )}`}
          />
        )}
        {isLoading && !session && <InlineLoading description={t('loadingPathway', 'Loading the care pathway...')} />}
        {error && (
          <InlineNotification kind="error" lowContrast hideCloseButton title={t('pathwayError', 'The care pathway did not load')} subtitle={error.message} />
        )}
        {closed && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title={t('noLongerOpen', 'This step is no longer open')}
            subtitle={t('noLongerOpenDetail', 'Someone else may have recorded it. Close this form and look at the care pathway again.')}
          />
        )}
        {!form && loaded && (
          <InlineNotification kind="error" lowContrast hideCloseButton title={t('noForm', 'The protocol binding has no form {{name}}', { name: recording.formName })} />
        )}
        {preFilledQuestions && !closed && outcome?.state !== 'recording' && (
          <ExtensionSlot key={`${formUuid}/${savedEncounter ?? 'new'}`} name="form-widget-slot" state={state} />
        )}
      </div>
    </Workspace2>
  );
};

export default CareTaskWorkspace;
