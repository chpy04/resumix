import AuthGate from '@/components/AuthGate';
import ResumeGrid from '@/components/home/ResumeGrid';

export default function HomePage() {
  return (
    <AuthGate>
      <ResumeGrid />
    </AuthGate>
  );
}
