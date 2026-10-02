export function selectEntry(
  search: string,
  trialOnly: boolean,
): 'trial' | 'workspace' | 'workspace-unavailable' {
  const params = new URLSearchParams(search);
  if (params.get('workspace') !== '1') return 'trial';
  return trialOnly ? 'workspace-unavailable' : 'workspace';
}
