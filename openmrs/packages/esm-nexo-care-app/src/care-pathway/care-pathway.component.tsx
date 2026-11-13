import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineLoading,
  InlineNotification,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
  Tile,
} from '@carbon/react';
import { showSnackbar, useConfig, useSession } from '@openmrs/esm-framework';
import { CardHeader, ErrorState, useLaunchWorkspaceRequiringVisit } from '@openmrs/esm-patient-common-lib';
import type { Action, NexoHost, NexoSession, StartOption, TaskView } from '../../../nexo-forms/src/browser.ts';
import { type NexoCareConfig } from '../config-schema';
import { confirmTask, RefusedEntry, useCarePathway, type Recording } from '../nexo.resource';
import { type CareTaskWorkspaceProps, CARE_TASK_WORKSPACE } from '../care-task/care-task.types';
import { contextLines, formatInstant } from '../display';
import { clinicalDecisions, dueStatus } from '../display-rules';
import styles from './care-pathway.scss';

interface CarePathwayProps {
  patientUuid: string;
}

const CarePathway: React.FC<CarePathwayProps> = ({ patientUuid }) => {
  const { t } = useTranslation();
  const { protocolName } = useConfig<NexoCareConfig>();
  const { loaded, session, facts, error, isLoading, mutate } = useCarePathway(patientUuid, protocolName);
  const launchTaskWorkspace = useLaunchWorkspaceRequiringVisit<CareTaskWorkspaceProps>(patientUuid, CARE_TASK_WORKSPACE);
  const user = useSession()?.user?.uuid;
  const [busy, setBusy] = useState<string | undefined>();

  const host = loaded?.host;
  const view = useMemo(() => session?.view(), [session]);
  const work = useMemo(() => (host && session ? host.tasks(session) : []), [host, session]);
  // Protocol orders (laboratory, prescription) are tracked, not done from here: they get their own list.
  const tasks = useMemo(() => work.filter((w) => w.kind !== 'order'), [work]);
  const orders = useMemo(() => work.filter((w) => w.kind === 'order'), [work]);
  const starts = useMemo(() => (host && session ? host.starts(session) : []), [host, session]);
  const history = useMemo(() => (host && session ? [...host.history(session)].reverse() : []), [host, session]);

  const openStart = useCallback(
    (option: StartOption) => {
      const recording: Recording = { how: 'start', formName: option.form.name, workflow: option.workflow, choice: option.choice };
      launchTaskWorkspace({ recording, title: option.form.title, starts: option.label, formUuid: option.form.o3.uuid });
    },
    [launchTaskWorkspace],
  );

  const runAction = useCallback(
    async (task: TaskView, action: Action) => {
      if (!host || !facts) return;
      if (action.kind === 'confirm') {
        setBusy(task.work.ref.id);
        try {
          await confirmTask(host, facts, task.work.ref, user);
          await mutate();
          showSnackbar({ kind: 'success', title: t('taskDone', 'Task marked as done'), subtitle: task.title });
        } catch (e) {
          showSnackbar({
            kind: 'error',
            isLowContrast: false,
            title:
              e instanceof RefusedEntry
                ? t('stepRefusedShort', 'Nexo Core did not accept this step')
                : t('taskNotDone', 'The task was not marked as done'),
            subtitle: (e as Error).message,
          });
        } finally {
          setBusy(undefined);
        }
        return;
      }
      const recording: Recording =
        action.kind === 'form'
          ? { how: 'task', formName: action.form.name, work: task.work.ref }
          : action.kind === 'update'
            ? { how: 'update', formName: action.form.name, work: task.work.ref, object: action.object }
            : { how: 'event', formName: action.form.name };
      launchTaskWorkspace({ recording, title: action.kind === 'event' ? action.form.title : task.title, formUuid: action.form.o3.uuid, work: task.work.ref });
    },
    [facts, host, launchTaskWorkspace, mutate, t, user],
  );

  const header = t('nexoCarePathway', 'Nexo care pathway');

  if (isLoading && !session) {
    return (
      <div className={styles.widget}>
        <CardHeader title={header}>
          <span />
        </CardHeader>
        <InlineLoading description={t('loadingPathway', 'Loading the care pathway...')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState headerTitle={header} error={error} />;
  }
  if (!host || !session || !view || !loaded) return null;

  return (
    <div className={styles.widget}>
      <CardHeader title={header}>
        <span />
      </CardHeader>

      <InlineNotification
        className={styles.banner}
        kind="warning"
        lowContrast
        hideCloseButton
        title={t('draftBanner', 'Draft for clinical review · Simulation authority · Not for care')}
        subtitle={t('draftBannerDetail', 'Protocol {{id}}, revision {{revision}}. Nexo Core decides each step from this protocol.', {
          id: loaded.protocol.id,
          revision: loaded.protocol.revision,
        })}
      />

      <section className={styles.section} aria-labelledby="nexo-start">
        <h5 id="nexo-start" className={styles.sectionTitle}>
          {t('startPathway', 'Start a pathway')}
        </h5>
        {starts.length ? (
          <div className={styles.buttons}>
            {starts.map((option) => (
              <Button key={option.label} kind="tertiary" size="sm" onClick={() => openStart(option)}>
                {t('startLabel', 'Start: {{label}}', { label: option.label })}
              </Button>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>{t('allRunning', 'A care pathway is already running for this patient.')}</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="nexo-tasks">
        <h5 id="nexo-tasks" className={styles.sectionTitle}>
          {t('openTasks', 'Open tasks')} ({tasks.length})
        </h5>
        {tasks.length ? (
          tasks.map((task) => (
            <TaskTile key={`${task.work.ref.id}/${task.work.ref.occurrence}`} task={task} busy={busy === task.work.ref.id} onAction={runAction} />
          ))
        ) : (
          <p className={styles.empty}>{t('noTasks', 'No open tasks.')}</p>
        )}
      </section>

      {orders.length > 0 && (
        <section className={styles.section} aria-labelledby="nexo-orders">
          <h5 id="nexo-orders" className={styles.sectionTitle}>
            {t('ordersInProgress', 'Orders in progress')} ({orders.length})
          </h5>
          <ul className={styles.orders}>
            {orders.map((order) => (
              <li key={`${order.work.ref.id}/${order.work.ref.occurrence}`} className={styles.order}>
                <span className={styles.orderTitle}>{order.title}</span>
                {order.due && (
                  <Tag type={dueStatus(order.due) === 'overdue' ? 'red' : 'gray'} size="sm">
                    {dueStatus(order.due) === 'overdue' ? t('overdueSince', 'Overdue since') : dueStatus(order.due) === 'now' ? t('dueNow', 'Due now') : t('due', 'Due')} {formatInstant(order.due)}
                  </Tag>
                )}
                {contextLines(order).length > 0 && (
                  <span className={styles.orderContext}>
                    {contextLines(order)
                      .map((c) => `${c.label}: ${c.value}`)
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="nexo-workflows">
        <h5 id="nexo-workflows" className={styles.sectionTitle}>
          {t('workflows', 'Workflows')}
        </h5>
        {view.workflows.length ? (
          <StructuredListWrapper isCondensed className={styles.list}>
            <StructuredListHead>
              <StructuredListRow head>
                <StructuredListCell head>{t('workflow', 'Workflow')}</StructuredListCell>
                <StructuredListCell head>{t('stateOrOutcome', 'State or outcome')}</StructuredListCell>
                <StructuredListCell head>{t('execution', 'Execution')}</StructuredListCell>
              </StructuredListRow>
            </StructuredListHead>
            <StructuredListBody>
              {view.workflows.map((w) => (
                <StructuredListRow key={w.execution}>
                  <StructuredListCell>{host.label(w.workflow ?? '')}</StructuredListCell>
                  <StructuredListCell>
                    {w.ended ? (
                      <Tag type="green" size="sm">
                        {t('ended', 'Ended')}: {host.label(w.ended)}
                      </Tag>
                    ) : (
                      <Tag type="blue" size="sm">
                        {host.label(w.state ?? '')}
                      </Tag>
                    )}
                  </StructuredListCell>
                  <StructuredListCell className={styles.mono}>{w.execution}</StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
        ) : (
          <p className={styles.empty}>{t('noWorkflows', 'No workflow has started.')}</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="nexo-history">
        <h5 id="nexo-history" className={styles.sectionTitle}>
          {t('history', 'History: why each step happened')}
        </h5>
        {history.length ? (
          <ol className={styles.history}>
            {history.map((h) => (
              <li key={h.seq} className={styles.historyItem}>
                <div className={styles.historyHead}>
                  <span className={styles.historyTime}>{formatInstant(h.at)}</span>
                  <span className={styles.historyType}>{eventTitle(host, session, h)}</span>
                  <span className={styles.historySeq}>#{h.seq}</span>
                </div>
                {clinicalDecisions(h.decisions).length > 0 && (
                  <ul className={styles.decisions}>
                    {clinicalDecisions(h.decisions).map((d) => (
                      <li key={d.id}>
                        <span className={styles.rule}>
                          {d.description ?? <>{host.label(d.table)} → <strong>{host.label(d.rule)}</strong></>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>{t('noHistory', 'Nothing recorded yet.')}</p>
        )}
      </section>
    </div>
  );
};

/** The title of a log entry: the task it completed, or its event type. */
function eventTitle(host: NexoHost, session: NexoSession, h: { seq: number; type: string; task?: string }): string {
  const entry = session.log.find((e) => e.seq === h.seq);
  if (entry?.kind === 'launch') return `${host.label('workflow.started', 'Started')}: ${host.label(entry.execution.workflow)}`;
  if (h.task) return `${host.label('task.completed', 'Task completed')}: ${host.taskTitle(h.task)}`;
  return host.label(h.type);
}

const TaskTile: React.FC<{ task: TaskView; busy: boolean; onAction: (task: TaskView, action: Action) => void }> = ({ task, busy, onAction }) => {
  const { t } = useTranslation();
  return (
    <Tile className={styles.task}>
      <div className={styles.taskHead}>
        <h6 className={styles.taskTitle}>{task.title}</h6>
        <div className={styles.taskMeta}>
          {task.roleLabel && (
            <Tag type="purple" size="sm">
              {task.roleLabel}
            </Tag>
          )}
          {task.due && (
            <Tag type={dueStatus(task.due) === 'overdue' ? 'red' : 'gray'} size="sm">
              {dueStatus(task.due) === 'overdue' ? t('overdueSince', 'Overdue since') : dueStatus(task.due) === 'now' ? t('dueNow', 'Due now') : t('due', 'Due')} {formatInstant(task.due)}
            </Tag>
          )}
        </div>
      </div>
      {contextLines(task).length > 0 && (
        <div className={styles.context}>
          <p className={styles.contextTitle}>{t('fromThePathway', 'From the pathway')}</p>
          <dl className={styles.contextList}>
            {contextLines(task).map((c) => (
              <React.Fragment key={c.key}>
                <dt>{c.label}</dt>
                <dd>{c.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}
      {task.missing.length > 0 && (
        <p className={styles.missing}>
          {t('missingInformation', 'Missing information')}: {task.missing.map((m) => m.label).join(', ')}
        </p>
      )}
      <div className={styles.buttons}>
        {task.actions.map((action, i) => (
          <Button
            key={`${action.kind}-${i}`}
            kind={i === 0 ? 'primary' : 'tertiary'}
            size="sm"
            disabled={busy}
            onClick={() => onAction(task, action)}
          >
            {action.label}
          </Button>
        ))}
        {busy && <InlineLoading description={t('saving', 'Saving...')} />}
      </div>
    </Tile>
  );
};

export default CarePathway;
