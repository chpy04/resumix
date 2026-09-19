import { withApiErrors } from '@/lib/http';
import { assembleLibrary } from '@/lib/queries/library';
import { requireUserId } from '@/lib/session';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === '1';
    const library = await assembleLibrary(userId, includeArchived);
    return Response.json(library);
  });
}
