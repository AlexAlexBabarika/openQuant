export function selectEntry(
  search: string,
  trialOnly: boolean,
): 'trial' | 'workspace' | 'workspace-unavailable' {
  const params = new URLSearchParams(search);
  if (params.get('workspace') === '1') {
    return trialOnly ? 'workspace-unavailable' : 'workspace';
  }
  return trialOnly || params.get('trial') === '1' ? 'trial' : 'workspace';
}

export function trialSearch(search: string, open: boolean): string {
  const params = new URLSearchParams(search);
  params.delete('workspace');
  if (open) {
    params.set('trial', '1');
  } else {
    for (const key of ['trial', 'v', 'strategy', 'commission', 'slippage']) {
      params.delete(key);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
