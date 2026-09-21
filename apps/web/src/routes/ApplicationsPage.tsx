import type { ApplicationView } from '@job-getter/contracts';
import { Badge, Button, EmptyState, Select, Spinner, Table } from '@job-getter/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from '../applications/labels';

/**
 * Applications: start one from a job, and see the ones already in flight.
 *
 * Starting an application is deliberately the smallest possible act — it
 * creates a record and nothing else. No CV is chosen, no answer is written and
 * nothing is sent, because every one of those is a decision the review screen
 * asks for explicitly.
 *
 * Creating twice for one job returns the first: the server resolves it on a
 * unique constraint, so this screen can simply navigate to whatever comes back
 * rather than guarding against a double click.
 */
export function ApplicationsPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');

  const applicationsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: ({ signal }) => api.listApplications({ query: { limit: 100 }, signal }),
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', 'applications'],
    queryFn: ({ signal }) => api.listJobs({ query: { limit: 100 }, signal }),
  });

  const create = useMutation({
    mutationFn: (job: string) => api.createApplication({ body: { job_id: job } }),
    onSuccess: async (application: ApplicationView) => {
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
      navigate(`/applications/${application.id}`);
    },
  });

  const applications = applicationsQuery.data?.items ?? [];
  const jobs = jobsQuery.data?.items ?? [];
  const tracked = new Set(applications.map((application) => application.job_id));
  const untracked = jobs.filter((job) => !tracked.has(job.id));

  return (
    <div className="flex flex-col gap-6" data-testid="applications-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('applications.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('applications.intro')}</p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4">
        <Select
          label={t('applications.startFor')}
          value={jobId}
          placeholder={t('applications.chooseJob')}
          options={untracked.map((job) => ({
            value: job.id,
            label: `${job.title} — ${job.company}`,
          }))}
          onChange={(event) => setJobId(event.currentTarget.value)}
        />
        <Button
          type="button"
          disabled={jobId === '' || create.isPending}
          onClick={() => create.mutate(jobId)}
        >
          {create.isPending ? t('applications.starting') : t('applications.start')}
        </Button>
        {untracked.length === 0 && jobs.length > 0 ? (
          <p className="text-sm text-slate-700" data-testid="all-jobs-tracked">
            {t('applications.allTracked')}
          </p>
        ) : null}
      </section>

      {create.error === null ? null : <ErrorNotice error={create.error} />}
      {applicationsQuery.isError ? <ErrorNotice error={applicationsQuery.error} /> : null}

      {applicationsQuery.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <Table<ApplicationView>
          caption={t('applications.tableCaption')}
          rows={applications}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title={t('applications.emptyTitle')}
              body={t('applications.emptyBody')}
              suggestions={[
                <Link key="jobs" className="underline" to="/jobs">
                  {t('applications.emptySuggestion')}
                </Link>,
              ]}
            />
          }
          columns={[
            {
              key: 'role',
              header: t('applications.columnRole'),
              rowHeader: true,
              cell: (row) => (
                <Link className="underline" to={`/applications/${row.id}`}>
                  {row.title} — {row.company}
                </Link>
              ),
            },
            {
              key: 'status',
              header: t('applications.columnStatus'),
              cell: (row) => (
                <Badge tone={APPLICATION_STATUS_TONE[row.status]}>
                  {t(APPLICATION_STATUS_LABEL[row.status])}
                </Badge>
              ),
            },
            {
              key: 'updated',
              header: t('applications.columnUpdated'),
              cell: (row) => formatDateTime(locale, row.updated_at),
            },
          ]}
        />
      )}
    </div>
  );
}
