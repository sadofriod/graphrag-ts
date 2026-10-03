import type { Community, HierarchicalCommunity, WeightedGraphEdge } from '../types';

type CommunityPartition = (
  edges: WeightedGraphEdge[],
) => Promise<Community[]>;

const getInducedEdges = (
  edges: WeightedGraphEdge[],
  members: string[],
): WeightedGraphEdge[] => {
  const memberSet = new Set(members);

  return edges.filter(({ source, target }) => memberSet.has(source) && memberSet.has(target));
};

const isCompleteStrictPartition = (
  parent: Community,
  children: Community[],
): boolean => {
  if (children.length < 2) {
    return false;
  }

  const parentMembers = new Set(parent.members);
  const childMembers = children.flatMap(({ members }) => members);
  const uniqueChildMembers = new Set(childMembers);

  return childMembers.length === parent.members.length &&
    uniqueChildMembers.size === childMembers.length &&
    children.every(({ members }) =>
      members.length > 0 &&
      members.length < parent.members.length &&
      members.every((member) => parentMembers.has(member))
    ) &&
    parent.members.every((member) => uniqueChildMembers.has(member));
};

export const createCommunityHierarchyBuilder = (partition: CommunityPartition) =>
  async (
    edges: WeightedGraphEdge[],
    roots: Community[],
  ): Promise<HierarchicalCommunity[]> => {
    let nextId = roots.reduce((maximum, community) => Math.max(maximum, community.id), -1) + 1;

    const buildNode = async (
      community: Community,
      level: number,
      parentId: number | null,
      communityEdges: WeightedGraphEdge[],
    ): Promise<HierarchicalCommunity> => {
      const inducedEdges = getInducedEdges(communityEdges, community.members);
      const detectedChildren = inducedEdges.length > 0 ? await partition(inducedEdges) : [];
      const children = isCompleteStrictPartition(community, detectedChildren)
        ? await detectedChildren.reduce<Promise<HierarchicalCommunity[]>>(
          async (pendingChildren, child) => {
            const builtChildren = await pendingChildren;
            const childNode = await buildNode(
              { ...child, id: nextId++ },
              level + 1,
              community.id,
              inducedEdges,
            );

            return [...builtChildren, childNode];
          },
          Promise.resolve([]),
        )
        : [];

      return { ...community, level, parentId, children };
    };

    return roots.reduce<Promise<HierarchicalCommunity[]>>(
      async (pendingRoots, root) => {
        const builtRoots = await pendingRoots;
        const rootNode = await buildNode(root, 0, null, edges);

        return [...builtRoots, rootNode];
      },
      Promise.resolve([]),
    );
  };