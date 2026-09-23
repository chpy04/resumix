import AuthGate from '@/components/AuthGate';
import CoverLetterGrid from '@/components/cover-letters/CoverLetterGrid';

export default function CoverLettersPage() {
  return (
    <AuthGate>
      <CoverLetterGrid />
    </AuthGate>
  );
}
