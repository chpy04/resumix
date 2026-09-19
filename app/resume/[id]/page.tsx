import AuthGate from '@/components/AuthGate';
import ResumeEditor from '@/components/editor/ResumeEditor';

interface ResumePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ application?: string }>;
}

/**
 * `?application=<id>` puts the editor in application mode: the back link
 * returns to that application rather than the resume list, and saving writes
 * the PDF to the application instead of just snapshotting the resume. Read
 * here rather than with `useSearchParams` so the client component needs no
 * Suspense boundary.
 */
export default async function ResumePage({ params, searchParams }: ResumePageProps) {
  const [{ id }, { application }] = await Promise.all([params, searchParams]);

  return (
    <AuthGate>
      <ResumeEditor resumeId={id} applicationId={application} />
    </AuthGate>
  );
}
