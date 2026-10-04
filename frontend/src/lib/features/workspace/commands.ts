export type ResearchCommand = {
  id: string;
  title: string;
  group: string;
  detail?: string;
  action: () => void;
};

export function filterCommands(
  commands: ResearchCommand[],
  query: string,
): ResearchCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command =>
    terms.every(term =>
      `${command.title} ${command.group} ${command.detail ?? ''}`
        .toLowerCase()
        .includes(term),
    ),
  );
}

export function isCommandShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'shiftKey'
    | 'isComposing'
    | 'repeat'
  >,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'k' &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.repeat
  );
}
