import AuthGate from '@/components/AuthGate';
import ResumeGrid from '@/components/home/ResumeGrid';

export default function ResumesPage() {
  return (
    <AuthGate>
      <ResumeGrid />
    </AuthGate>
  );
}
