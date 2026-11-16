import type { DisputeStatus, ProposalChanges, ProposalStatus } from '../entities/types';

export type MachineProposal = {
  id: string;
  proposerId: string;
  proposedChanges: ProposalChanges;
  status: ProposalStatus;
  createdAt: string;
  respondedAt: string | null;
};

export type DisputeState = {
  status: DisputeStatus;
  involvedUserIds: string[];
  proposals: MachineProposal[];
};

export type MachineEvent =
  | { type: 'propose'; actorId: string; proposal: MachineProposal }
  | { type: 'reject'; actorId: string; proposalId: string; respondedAt: string }
  | { type: 'accept'; actorId: string; proposalId: string; respondedAt: string };

export type MachineOutcome =
  | { ok: true; state: DisputeState }
  | { ok: false; code: string; message: string };

function pendingProposal(state: DisputeState): MachineProposal | undefined {
  return state.proposals.find((proposal) => proposal.status === 'pending');
}

function isInvolved(state: DisputeState, actorId: string): boolean {
  return state.involvedUserIds.includes(actorId);
}

export function applyDisputeEvent(state: DisputeState, event: MachineEvent): MachineOutcome {
  if (state.status === 'resolved') {
    return { ok: false, code: 'dispute_closed', message: 'Esta disputa já foi encerrada.' };
  }
  if (!isInvolved(state, event.actorId)) {
    return { ok: false, code: 'forbidden', message: 'Você não participa desta disputa.' };
  }

  if (event.type === 'propose') {
    const pending = pendingProposal(state);
    if (pending && pending.proposerId !== event.actorId) {
      return {
        ok: false,
        code: 'proposal_pending',
        message: 'Já existe uma proposta aguardando resposta. Recuse-a antes de fazer outra.',
      };
    }
    const proposals = state.proposals.map((proposal) =>
      proposal.status === 'pending' ? { ...proposal, status: 'superseded' as const, respondedAt: event.proposal.createdAt } : proposal,
    );
    return {
      ok: true,
      state: {
        ...state,
        status: 'proposal_pending',
        proposals: [...proposals, { ...event.proposal, status: 'pending' }],
      },
    };
  }

  const pending = pendingProposal(state);
  if (!pending || pending.id !== event.proposalId || state.status !== 'proposal_pending') {
    return { ok: false, code: 'proposal_missing', message: 'A proposta não está mais pendente.' };
  }
  const uniqueActors = new Set(state.involvedUserIds);
  const actorIsProposer = pending.proposerId === event.actorId;

  if (event.type === 'reject') {
    if (actorIsProposer && uniqueActors.size > 1) {
      return { ok: false, code: 'forbidden', message: 'Quem recebeu a proposta precisa recusá-la.' };
    }
    return {
      ok: true,
      state: {
        ...state,
        status: 'open',
        proposals: state.proposals.map((proposal) =>
          proposal.id === pending.id ? { ...proposal, status: 'rejected', respondedAt: event.respondedAt } : proposal,
        ),
      },
    };
  }

  if (actorIsProposer && uniqueActors.size > 1) {
    return { ok: false, code: 'forbidden', message: 'Outro participante precisa aceitar a proposta.' };
  }
  return {
    ok: true,
    state: {
      ...state,
      status: 'resolved',
      proposals: state.proposals.map((proposal) =>
        proposal.id === pending.id ? { ...proposal, status: 'accepted', respondedAt: event.respondedAt } : proposal,
      ),
    },
  };
}
