'use server';

import { write, toId } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { approveBacklog, setEnquiryOutcome } from '@/modules/enquiry/server/intake';

// Rev 2 §2 E5: Admin (Puja) gives a backlog enquiry its docket number, or closes an enquiry
// (PO received / Lost / Regret with a reason), or reopens it.

export async function approveBacklogAction(id: unknown) {
  return write((user) => approveBacklog(toId(id, 'enquiry'), user), { roles: ADMIN_ROLES });
}

export async function setEnquiryOutcomeAction(id: unknown, outcome: unknown, note: unknown) {
  return write(
    (user) => setEnquiryOutcome(toId(id, 'enquiry'), typeof outcome === 'string' && outcome ? outcome : null, typeof note === 'string' ? note : null, user),
    { roles: ADMIN_ROLES },
  );
}
