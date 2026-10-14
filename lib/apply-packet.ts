/**
 * Loading the apply packet: what `get_apply_packet` answers, and what the
 * agent's files route serves from (C4, D-050). The reads are here, like
 * `application-approval.ts`; what the packet holds, and when there is one,
 * is decided in `lib/applications/apply-packet.ts`.
 */
import { buildApplyPacket, type ApplyPacketResult } from './applications/apply-packet.ts';
import { findLiveApplication } from './mcp/application.ts';
import { getApplicationDetail } from './queries/applications.ts';

/** The packet, or why there is none. Null when the application is missing,
 *  archived or someone else's, which all read the same. */
export async function loadApplyPacket(
  userId: string,
  id: string,
): Promise<ApplyPacketResult | null> {
  const row = await findLiveApplication(userId, id);
  if (!row) return null;

  // The detail names the pinned PDF but does not identify it; the row does.
  const detail = await getApplicationDetail(userId, id);
  if (!detail) return null;
  return buildApplyPacket(detail, row.resumePdfId);
}
