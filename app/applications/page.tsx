import ApplicationsBoard from '@/components/applications/ApplicationsBoard';
import AuthGate from '@/components/AuthGate';

export default function ApplicationsPage() {
  return (
    <AuthGate>
      <ApplicationsBoard />
    </AuthGate>
  );
}
