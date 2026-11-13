/** Typed title descriptors are neither a catalogue grade nor permission to
 * discard the next token. Unknown designations after a descriptor still count.
 * Values here never infer fuel,drive,trim or a displacement/cylinder mapping. */
export function titleDescriptorSpans(text: string): { start: number; end: number }[] {
  const patterns = [
    /\b[1-9]\s*(?:dr|doors?|seats?|seaters?|st)\b/g,
    /\b(?:service history|maintenance records?|service records?|log ?books?)\b/g,
    /\b(?:suv|sedan|wagon|hatchback|hatch|coupe|convertible|cabriolet|ute|utility|pickup|van)\b/g,
    /\b\d+(?:\.\d+)?\s*(?:litres?|liters?|l|cc)\b/g,
  ];
  return patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m) => ({ start: m.index, end: m.index + m[0].length })),
  );
}
/** Agency relations belong to an individual make/model mention, not its whole
 * sentence. A service provider in a sale-reason clause is not a new vehicle.
 * Call only with an independent detected vehicle model elsewhere. */
export function serviceProviderMention(
  text: string,
  start: number,
  end: number,
  segmentStart = 0,
  field: string = 'make',
): boolean {
  const clauseStart =
    Math.max(
      text.lastIndexOf(';', start),
      text.lastIndexOf('.', start),
      text.lastIndexOf('!', start),
      text.lastIndexOf('?', start),
      text.lastIndexOf(',', start),
    ) + 1;
  const prefix = text.slice(Math.max(clauseStart, segmentStart), start),
    suffix = text.slice(end);
  const service =
    /\b(?:servic(?:e|ed|ing)|maintain(?:ed|ing)|maintenance|repair(?:ed|s)?|inspect(?:ed|ion)|logbooks?|history|dealer(?:ship)?|workshop|mechanic)\b/.test(
      prefix,
    );
  const agent = /\b(?:by|through|at|with)\s+(?:[a-z]+\s+){0,2}$/.test(prefix);
  // Postnominal agency heads cover 'Toyota dealership/service history' while
  // 'Toyota Camry' remains an ordinary vehicle identity.
  const targetGovernor =
    /\b(?:selling|sell|sale|actually|correction)\s+(?:(?:my|this|the|an?)\s+)?$/.test(prefix);
  const agencyHead =
    /^\s+(?:dealership|dealer|workshop|service (?:history|centre|center)|warranty)\b/.test(suffix);
  return !targetGovernor && ((service && agent) || (field === 'make' && agencyHead));
}
