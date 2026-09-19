import ApplicationEditor from '@/components/applications/ApplicationEditor';
import AuthGate from '@/components/AuthGate';

interface ApplicationPageProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationPage({ params }: ApplicationPageProps) {
  const { id } = await params;

  return (
    <AuthGate>
      <ApplicationEditor applicationId={id} />
    </AuthGate>
  );
}
