import AuthGate from '@/components/AuthGate';
import ResumeEditor from '@/components/editor/ResumeEditor';

interface ResumePageProps {
  params: Promise<{ id: string }>;
}

export default async function ResumePage({ params }: ResumePageProps) {
  const { id } = await params;

  return (
    <AuthGate>
      <ResumeEditor resumeId={id} />
    </AuthGate>
  );
}
