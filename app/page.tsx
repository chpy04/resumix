import ApplicationsBoard from '@/components/applications/ApplicationsBoard';
import AuthGate from '@/components/AuthGate';

/** The front door is the applications board: the resume library is a tool for
 *  filling it in, not the thing being tracked. */
export default function HomePage() {
  return (
    <AuthGate>
      <ApplicationsBoard />
    </AuthGate>
  );
}
