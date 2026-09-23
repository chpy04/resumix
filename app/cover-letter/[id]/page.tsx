import AuthGate from '@/components/AuthGate';
import CoverLetterEditor from '@/components/cover-letters/CoverLetterEditor';

interface CoverLetterPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ application?: string }>;
}

/** `?application=<id>` only changes where the back link goes — there is
 *  nothing to save *to* the application, because the link to this letter is
 *  already the record of what it will send (D-035). */
export default async function CoverLetterPage({ params, searchParams }: CoverLetterPageProps) {
  const { id } = await params;
  const { application } = await searchParams;

  return (
    <AuthGate>
      <CoverLetterEditor coverLetterId={id} applicationId={application} />
    </AuthGate>
  );
}
