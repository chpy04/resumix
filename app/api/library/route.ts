import { withApiErrors } from '@/lib/http';
import { assembleLibrary } from '@/lib/queries/library';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === '1';
    const library = await assembleLibrary(includeArchived);
    return Response.json(library);
  });
}
