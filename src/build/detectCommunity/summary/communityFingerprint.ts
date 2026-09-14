import { createHash } from 'node:crypto';

import type { CommunityContextInput } from './buildCommunityContext';

export const computeCommunityFingerprint = (input: CommunityContextInput): string => {
  const sortedMembers = [...input.members].sort();
  const sortedEntities = [...input.entities]
    .map((e) => `${e.name}:${e.description ?? ''}`)
    .sort();

  const sortedEdges = [...input.edges]
    .map((e) => `${e.source}->${e.target}:${e.relationshipDesc}`)
    .sort();

  const sortedClaims = [...input.claims]
    .map((c) => `${c.subject}->${c.object ?? ''}:${c.description}`)
    .sort();

  const payload = JSON.stringify({
    members: sortedMembers,
    entities: sortedEntities,
    edges: sortedEdges,
    claims: sortedClaims,
  });

  return createHash('sha256').update(payload, 'utf8').digest('hex');
};
