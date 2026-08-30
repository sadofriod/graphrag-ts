export const applyNamespaceToWhere = <Args extends object>(
  args: Args,
  namespace: string,
): Omit<Args, 'where'> & { where: { namespace: string } & Record<string, unknown> } => ({
  ...args,
  where: {
    ...(('where' in args ? (args as { where?: object }).where : undefined) ?? {}),
    namespace,
  },
} as Omit<Args, 'where'> & { where: { namespace: string } & Record<string, unknown> });
