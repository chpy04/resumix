import ReviewFlow from '@/components/applications/ReviewFlow';
import AuthGate from '@/components/AuthGate';

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

/** The review flow for one application: its resume, its letter, then the
 *  final approval that makes it ready (D-044). Needs review and Ready cards
 *  on the board open this rather than `/applications/[id]`. */
export default async function ReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;

  return (
    <AuthGate>
      <ReviewFlow applicationId={id} />
    </AuthGate>
  );
}
