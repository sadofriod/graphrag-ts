import type { Community, LeidenResult } from '../types';

/** Groups per-vertex community membership into communities with member names. */
export const groupByCommunity = ({ membership }: LeidenResult, vertices: string[]): Community[] => {
  const groups = new Map<number, string[]>();

  membership.forEach((communityId, vertexId) => {
    const vertexName = vertices[vertexId];

    if (vertexName === undefined) {
      return;
    }

    const members = groups.get(communityId) ?? [];
    groups.set(communityId, [...members, vertexName]);
  });

  return Array.from(groups.entries()).map(([id, members]) => ({ id, members }));
};
