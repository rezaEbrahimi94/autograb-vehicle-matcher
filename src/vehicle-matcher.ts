import { required } from './invariant.js';
import { additiveCoordinator, conditionBoundary, closedGradeExtension } from './nominal-context.js';
import { titleDescriptorSpans, serviceProviderMention } from './mention-context.js';
import { structuredListingText } from './listing-structure.js';
import { modificationModifierSpans, subordinateEquipmentBoundary } from './evidence-composition.js';
import {
  presentationEnd,
  entityRelations,
  equipmentRelations,
  RELATION_MODEL_METADATA,
  type RelationSpan,
} from './interpretation-relations.js';
import { claimScope, componentSpans } from './evidence-scope.js';
import { CandidateEvidenceIndex } from './candidate-evidence.js';
import type { Vehicle } from './db.js';
import { normalize, type MatchResult } from './matcher.js';
type Field = 'make' | 'model' | 'badge' | 'transmission_type' | 'fuel_type' | 'drive_type';
type Counts = (ids: string[]) => Promise<Map<string, number>>;
export interface MatcherOptions {
  cacheSize?: number;
}
export interface VehicleMatchResult extends MatchResult {
  retrievedCandidateIds: string[];
}
type Analysis = Omit<VehicleMatchResult, 'vehicleId'>;
type Entry = {
  field: Field;
  value: string;
  ids: Set<string>;
  phrase: string[];
};
type Trie = {
  next: Map<string, Trie>;
  entries: Entry[];
};
type Token = {
  word: string;
  start: number;
  end: number;
};
type Role =
  | 'neutral'
  | 'target'
  | 'correction'
  | 'reported'
  | 'rejected'
  | 'donor'
  | 'desired'
  | 'history'
  | 'accessory';
type Segment = {
  start: number;
  end: number;
  text: string;
  role: Role;
};
type Evidence = {
  entry: Entry;
  start: number;
  end: number;
  segment: number;
  negative: boolean;
  quality: number;
};
const FIELDS: Field[] = ['make', 'model', 'badge', 'transmission_type', 'fuel_type', 'drive_type'];

const COLOURS = new Set([
  'black',
  'blue',
  'white',
  'red',
  'silver',
  'grey',
  'gray',
  'green',
  'gold',
]);
const GRAMMAR = new Set(
  'a an the my i am is are was were it its this that for sale selling with and in of to from but as car vehicle sedan gearbox transmission version standard factory definitely actually correction listing title wrong website did let me select sorry painted colour color interior exterior included now automatic manual petrol diesel hybrid unspecified details runs well on rear window both do know which correct not no non never word caption says mistake advert heading incorrectly actual engine donor wanted exchange previous owned comes fitted swap would at'.split(
    ' ',
  ),
);
const PROSE = new Set(
  'has have having had been being equipped features includes including available good excellent condition maintained reliable badge trim currently offered offer offers our'.split(
    ' ',
  ),
);
// These cues describe linguistic roles, and are independent of vehicle names/IDs.
const HISTORY =
  /\b(?:(?:my|the|our) (?:old|last|previous) (?:car|vehicle)|(?:i |we )?(?:previously|formerly) (?:owned|drove)|(?:i |we )?used to (?:own|drive))\b/g;
const DONOR =
  /\b(?:(?:(?:with|using) (?:an? )?)?(?:engine|motor) (?:swap |sourced |taken |borrowed )?from|(?:engine|motor) donor|(?:the )?(?:engine|motor) (?:came|comes) from)\b/g;
const TRADE =
  /\b(?:wanted(?: in exchange)?|(?:will|would) trade for|(?:would )?swap for|in exchange for|interested in (?:a )?swap for|looking for)\b/g;
const TARGET =
  /\b(?:(?:this|the) (?:listing|advert) (?:is )?for|(?:my|the|our) current (?:car|vehicle)(?: is)?|(?:now |currently )?(?:(?:i am|we are) )?selling|(?:vehicle |car )?offered for sale)\b/g;
const UNOWNED = /\b(?:is|are) not (mine|ours)\s*$/;
const OWNED_REFERENCE = /^\s*(?:(?:but|however|whereas)\s+)?(mine|ours) (?:is|are)\b/;
// Source-backed model codes, not arbitrary alphanumeric removal. Continental's
// 2025 application catalogue identifies these Camry codes and fuel families;
// sources/limits are recorded in evaluation/v6-research.txt. No trim is inferred.
const MODEL_CODES: Record<
  string,
  {
    make: string;
    model: string;
    fuel: string;
  }
> = {
  axvh71r: { make: 'toyota', model: 'camry', fuel: 'hybrid petrol' },
  axvh70: { make: 'toyota', model: 'camry', fuel: 'hybrid petrol' },
  asv70r: { make: 'toyota', model: 'camry', fuel: 'petrol' },
};
// Narrow, source-reviewed model associations, NOT fuel/trim/chassis decoding.
// Primary dealer records and the absence of inferred fields are documented in
// docs/ASSUMPTIONS.md. Unknown/mismatched codes stay unknown.
const MODEL_METADATA: Record<
  string,
  {
    make: string;
    model: string;
  }
> = {
  '2h': { make: 'volkswagen', model: 'amarok' },
  axvh70r: { make: 'toyota', model: 'camry' },
};
const matches = (pattern: RegExp, text: string) => new RegExp(pattern.source).test(text);
function maskMetadata(text: string): string {
  // Preserve offsets and genuine numeric models; only explicitly labelled
  // numbers/measurements are masked. No catalogue value is substituted.
  const patterns = [
    /\b(?:stock|lot|reference|ref|item|postcode|zip)(?:\s+(?:no\.?|number))?\s*[:#-]?\s*\d[\d -]*/g,
    /\b(?:odometer|mileage)\s*:?\s*\d[\d,]*(?:\s*(?:km|kms|miles))?\b/g,
    /\b\d[\d,]*\s*(?:km|kms|miles)\b/g,
  ];
  for (const pattern of patterns) text = text.replace(pattern, (match) => ' '.repeat(match.length));
  return text;
}
const EXCLUDED = new Set<Role>(['rejected', 'donor', 'desired', 'history', 'accessory']);
const tokens = (text: string): Token[] =>
  [...text.matchAll(/[a-z0-9]+/g)].map((m) => ({
    word: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
const keyOf = (text: string): string =>
  tokens(normalize(text))
    .map((t) => t.word)
    .join(' ');
const node = (): Trie => ({ next: new Map(), entries: [] });
type PackageItem = {
  start: number;
  end: number;
  listStart: number;
};
/** Parse only nominal equipment-list items, retaining offsets. Prices and
 * separators belong to the list grammar; arbitrary assertions do not. */
function enumeratedEquipment(text: string, end: number): boolean {
  const tail = /^\s*:\s*([^;.!?]{1,120})/.exec(text.slice(end));
  if (!tail) return false;
  const first = required(required(tail[1]).split(/[|,]/)[0]);
  return (
    componentSpans(first, true, true, true).length > 0 &&
    !/\b(?:grade|trim|model|engine|gearbox|transmission|petrol|diesel|hybrid)\b/.test(first)
  );
}
function packageItems(
  text: string,
  extended = false,
  descriptive = false,
  labelFirst = false,
  components = false,
  ontology = false,
  learningContext = false,
  composition = false,
  nominal = false,
): PackageItem[] {
  const items: PackageItem[] = [];
  const starts = extended
    ? /(?:^|[;.!?|])\s*|\b(?:options?|extras?|equipment|factory fitted)(?:\s+include[ds]?)?\s*:\s*|\b(?:with|including|equipped with|fitted with|factory)\s+(?:optional\s+)?/g
    : /(?:^|[;.!?])\s*|\b(?:options?|extras?|equipment|factory fitted)(?:\s+include[ds]?)?\s*:\s*|\b(?:with|including|equipped with|fitted with)\s+(?:optional\s+)?/g;
  const decoration = /^[\s*•\-–—\p{S}\uFE0F]*/u;
  const price = extended
    ? /^\s*(?:\(\s*(?:(?:aud|usd|nzd)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?\s*k?\s*\)|(?:(?:aud|usd|nzd)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?\s*k?\b)/
    : /^\s*(?:\(\s*(?:(?:aud|usd|nzd)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?\s*\)|(?:(?:aud|usd|nzd)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?)/;
  const cues = descriptive
    ? new RegExp(starts.source.replace('[;.!?|]', '[;.!?|/]'), starts.flags)
    : starts;
  const labelCue =
    '\\b(?:(?:factory\\s+)?(?:options?|extras?|equipment)|factory fitted)(?:\\s+include[ds]?)?\\s*:\\s*|';
  const structuredCue = learningContext
    ? '\\b(?:with|including|(?:all\\s+)?packages?)\\s*:\\s*|'
    : '';
  const orderedCues = labelFirst
    ? new RegExp(
        structuredCue +
          labelCue +
          (components ? '\\b(?:factory\\s+)?options?\\s+(?!include\\b)(?=[a-z0-9])|' : '') +
          cues.source,
        'g',
      )
    : cues;
  for (const cue of text.matchAll(orderedCues)) {
    const listStart = cue.index;
    let cursor = cue.index + cue[0].length;
    for (let count = 0; count < 32; count++) {
      cursor += decoration.exec(text.slice(cursor))![0].length;
      const name = /^([a-z0-9][a-z0-9& -]{0,80}?)\s+(?:package|pack)\b/.exec(text.slice(cursor));
      if (!name || tokens(required(name[1])).length > 8) break;
      const end = cursor + name[0].length;
      let tail = end;
      const amount = price.exec(text.slice(tail));
      if (amount) {
        tail += amount[0].length;
        if (descriptive) tail += /^\s*(?:rrp|msrp)\b/.exec(text.slice(tail))?.[0].length ?? 0;
      }
      const rest = text.slice(tail),
        separator = (
          ontology
            ? /^\s*(?:[:+*,;&|/]|\s-\s|\band\b)\s*/
            : components
              ? /^\s*(?:[+*,;&|/]|\s-\s|\band\b)\s*/
              : descriptive
                ? /^\s*(?:[+,;&|/]|\s-\s|\band\b)\s*/
                : extended
                  ? /^\s*(?:[+,;&|]|\s-\s|\band\b)\s*/
                  : /^\s*(?:[+,;&]|\band\b)\s*/
        ).exec(rest);
      const adjacent = extended && /^\s+[a-z0-9][a-z0-9& -]{0,80}?\s+(?:package|pack)\b/.test(rest);
      const attached = extended && /^\s+(?:added|fitted|included)\s+(?:to|on|with)\b/.test(rest);
      // "Sport Package is the actual trim" is an assertion, not a list item.
      if (
        !separator &&
        !adjacent &&
        !attached &&
        !(nominal && conditionBoundary(rest)) &&
        !(composition && subordinateEquipmentBoundary(rest)) &&
        !(descriptive && /^\s+with\b/.test(rest)) &&
        !/^\s*(?:[.!?)]|$)/.test(rest)
      )
        break;
      items.push({ start: cursor, end, listStart });
      if (!separator && !adjacent) break;
      cursor = tail + (separator?.[0].length ?? rest.match(/^\s+/)![0].length);
    }
  }
  return extended
    ? items.filter(
        (item) => !items.some((other) => other.start > item.start && other.end === item.end),
      )
    : items;
}
/** Surface aliases. Codes retain their digits, including unsupported
 * designations, so repetition cannot silently replace an absent engine grade.
 * Line breaks stay clause boundaries; no field is inferred from year/cylinders. */
function prepareListing(input: string, revised = false): string {
  const prepared = revised
    ? input
        .replace(/\bCVT\b/gi, 'automatic')
        .replace(/\bPET(?=\s+(?:[2-5][ -]?DR|CVT|automatic|auto|manual)\b)/gi, 'petrol')
    : input;
  return prepared
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\r?\n/g, '; ')
    .replace(/\b(\d{2,4})[ -]+(tsi|tdi)\b/gi, '$1$2')
    .replace(/\b(tsi|tdi)[ -]+(\d{2,4})\b/gi, '$1$2')
    .replace(/\ball[ -]wheel[ -]drive\b/gi, 'four wheel drive')
    .replace(/\b4[ -]?motion\b/gi, 'four wheel drive')
    .replace(/\b(?:premium[ -]+)?unleaded(?:[ -]+petrol)?\b/gi, 'petrol');
}
function edits(word: string): string[] {
  return [
    word,
    ...Array.from({ length: word.length }, (_, i) => word.slice(0, i) + word.slice(i + 1)),
  ];
}
function editOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++n > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return n + Number(i < a.length || j < b.length) <= 1;
}
function adjacentSwap(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const mismatches: Array<number> = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches.push(i);
  return (
    mismatches.length === 2 &&
    mismatches[1] === required(mismatches[0]) + 1 &&
    a[required(mismatches[0])] === b[mismatches[1]] &&
    a[mismatches[1]] === b[required(mismatches[0])]
  );
}
function roleOf(text: string, enhanced = false): Role {
  if (
    /\b(?:word|title|heading|caption|label|advert)\b/.test(text) &&
    /\b(?:wrong|incorrect\w*|mistake|error|inaccurate)\b/.test(text)
  )
    return 'rejected';
  if (
    /\b(?:owner'?s? manual|instruction (?:book|manual)|manual (?:included|supplied)|sticker|decal)\b/.test(
      text,
    )
  )
    return 'accessory';
  if (enhanced) {
    if (
      matches(DONOR, text) ||
      /\b(?:supplied|donated) (?:the |an? )?(?:engine|motor)\b/.test(text)
    )
      return 'donor';
    if (matches(TRADE, text)) return 'desired';
    if (
      matches(HISTORY, text) ||
      /\bwas (?:my|the|our) (?:old|last|previous) (?:car|vehicle)\b/.test(text)
    )
      return 'history';
    if (
      /\b(?:brochure|marketing|advertising)\b.*\b(?:compares?|comparison|like|similar)\b/.test(text)
    )
      return 'accessory';
  }
  if (
    /\b(?:engine donor|(?:engine|motor) (?:swap )?from|(?:engine|motor) (?:came|comes) from)\b/.test(
      text,
    )
  )
    return 'donor';
  if (/\b(?:wanted in exchange|in exchange for|would swap for|swap for|looking for)\b/.test(text))
    return 'desired';
  if (/\b(?:(?:my|the) previous (?:car|vehicle)|previously owned|used to own)\b/.test(text))
    return 'history';
  if (/\b(?:actually|correction|actual (?:car|vehicle)|in fact)\b/.test(text)) return 'correction';
  if (enhanced && matches(TARGET, text)) return 'target';
  if (/\b(?:selling|for sale|this advert is for|the car i am selling is)\b/.test(text))
    return 'target';
  return 'neutral';
}
/** Fixed context grammar produces annotated spans; it never deletes all text
 * after a keyword or applies a donor's attributes globally to the target. */
function segments(
  text: string,
  context: boolean,
  enhanced = false,
  provenance = false,
  designationAware = false,
  discourseAware = false,
  learningContext = false,
): Segment[] {
  if (!context) return [{ start: 0, end: text.length, text, role: 'neutral' }];
  const result: Segment[] = [];
  for (const clause of text.matchAll(enhanced ? /[^,.;!?()]+/g : /[^.;!?()]+/g)) {
    const body = clause[0],
      offset = clause.index,
      boundaries = new Set([0, body.length]);
    const markers = [
      /\b(?:but|however|whereas|actually|correction|in fact)\b/g,
      /\b(?:in exchange for|would swap for|swap for|wanted in exchange|looking for|(?:my|the) previous (?:car|vehicle)|previously owned|used to own)\b/g,
      /\b(?:(?:with (?:an? )?|fitted with an? )?engine swap from|(?:the )?(?:engine|motor) (?:came|comes) from|(?:engine|motor) from)\b/g,
      /\b(?:with|comes with|including)\b(?=[^.;]*(?:\bsticker\b|\bdecal\b|\b(?:owner'?s? )?manual (?:included|supplied)\b|\bgolf cart\b))/g,
    ];
    if (enhanced) markers.push(HISTORY, DONOR, TRADE, TARGET);
    if (learningContext)
      markers.push(/\b(?:replaced|replacing|replace) (?:it|this|the (?:car|vehicle)) with\b/g);
    if (discourseAware)
      markers.push(
        /\b(?:reason|motive|purpose) for (?:selling|sale)\b/g,
        /\b(?:must|need to|have to) sell\b/g,
      );
    if (designationAware) markers.push(/\b(?:due to|because|as (?:we|i) now have)\b/g);
    if (provenance)
      markers.push(
        /\bto replace\b/g,
        /\b(?:the )?(?:advert|listing|title|caption|website) (?:says|said|shows|showed|lists|listed)\b/g,
      );
    for (const marker of markers)
      for (const match of body.matchAll(marker)) {
        let start = match.index;
        if (discourseAware && /\b(?:reason|motive|purpose) for\s+$/.test(body.slice(0, start)))
          continue;
        // Keep a preceding negator inside the new span: splitting at "selling"
        // alone would turn "not selling this car" into a positive sale target.
        if (enhanced) {
          const negator = body.slice(0, start).match(/\b(?:not|never)\s*$/);
          if (negator) start = negator.index!;
        }
        boundaries.add(start);
      }
    const sorted = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const part = body.slice(sorted[i], sorted[i + 1]);
      if (enhanced && !part.trim()) continue;
      let role = roleOf(part, enhanced);
      if (
        learningContext &&
        /\b(?:replaced|replacing|replace) (?:it|this|the (?:car|vehicle)) with\b/.test(part)
      )
        role = 'desired';
      if (discourseAware && /^\s*(?:reason|motive|purpose) for (?:selling|sale)\b/.test(part))
        role = 'neutral';
      if (discourseAware && /^\s*(?:must|need to|have to) sell\b/.test(part)) role = 'target';
      if (
        designationAware &&
        /^\s*(?:due to|because|as (?:we|i) now have)\b/.test(part) &&
        /\b(?:purchas(?:e|ed|ing)|bought|company car|replacement vehicle)\b/.test(part)
      )
        role = 'desired';
      if (
        provenance &&
        /^\s*(?:ignore|disregard)\b/.test(part) &&
        /\b(?:ad|advert|listing|title|caption|website)\b/.test(part)
      )
        role = 'rejected';
      if (
        provenance &&
        role === 'neutral' &&
        /\b(?:advert|listing|title|caption|website) (?:says|said|shows|showed|lists|listed)\b/.test(
          part,
        )
      )
        role = 'reported';
      // A purchased replacement and the vehicle it replaces are separate mentions.
      if (
        provenance &&
        /\b(?:bought|purchased|buying)\b/.test(part) &&
        /^to replace\b/.test(body.slice(sorted[i + 1]))
      )
        role = 'desired';
      if (/\b(?:comes with|including)\b/.test(part) && /\b(?:cart|scooter)\b/.test(part))
        role = 'accessory';
      result.push({
        start: offset + required(sorted[i]),
        end: offset + required(sorted[i + 1]),
        text: part,
        role,
      });
    }
  }
  for (let i = 1; i < result.length; i++) {
    const previous = required(result[i - 1]),
      current = required(result[i]);
    if (
      provenance &&
      previous.role === 'reported' &&
      /^\s*(?:it(?:'s| is)|this is|the (?:car|vehicle) is)\b/.test(current.text) &&
      current.role === 'neutral'
    )
      current.role = 'correction';
    if (
      /\bcorrection\b/.test(previous.text) &&
      /^\s*(?:this|it|the car|the vehicle)\b/.test(current.text) &&
      current.role === 'neutral'
    )
      current.role = 'correction';
    // An explicit back-reference rejects the named heading/caption, rather
    // than adding its quoted attribute as a fact about the vehicle.
    if (
      /\b(?:that|this|it)\b.*\b(?:wrong|incorrect|mistake|error)\b/.test(current.text) &&
      /\b(?:word|title|heading|caption|label|says)\b/.test(previous.text)
    )
      previous.role = 'rejected';
  }
  return result;
}
/** Deterministic catalogue matcher. All catalogue work is amortized into indexes.
 * Strong field contradictions are constraints; uncertain evidence contributes
 * to a field-weighted score. Popularity is consulted only for exact score ties. */
export class VehicleMatcher {
  readonly version: string;
  readonly stats = {
    analysisComputations: 0,
    cacheHits: 0,
    coalescedRequests: 0,
    countCalls: 0,
    candidateVisits: 0,
    trieSteps: 0,
  };
  private readonly trie = node();
  private readonly entries = new Map<string, Entry>();
  private readonly vocabulary = new Set<string>();
  private readonly identityWords = new Map<string, Entry[]>();
  private readonly spelling = new Map<string, Set<string>>();
  private readonly ids = new Set<string>();
  private readonly completeBadges = new Map<string, Set<string>>();
  private readonly candidateIndex: CandidateEvidenceIndex | undefined;
  private readonly numericDesignations = new Map<string, Map<string, Set<string>>>();
  private readonly badgeSignatures = new Map<string, string>();
  private readonly cache = new Map<string, Analysis>();
  private readonly pending = new Map<string, Promise<VehicleMatchResult>>();
  private readonly cacheSize: number;
  private maxIdentityLength = 0;
  constructor(
    vehicles: Vehicle[],
    private readonly counts: Counts,
    options: MatcherOptions = {},
  ) {
    this.cacheSize = options.cacheSize ?? 256;
    this.candidateIndex = new CandidateEvidenceIndex(vehicles.map((v) => keyOf(v.badge)));
    this.version = 'deterministic';
    if (!Number.isSafeInteger(this.cacheSize) || this.cacheSize < 0)
      throw new Error('cacheSize must be a nonnegative safe integer');
    const add = (field: Field, value: string, words: string[], id?: string) => {
      const key = `${field}:${value}:${words.join(' ')}`;
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { field, value, ids: new Set(), phrase: words };
        this.entries.set(key, entry);
      }
      if (id !== undefined) entry.ids.add(id);
    };
    for (const v of vehicles) {
      if (typeof v.id !== 'string' || !v.id || this.ids.has(v.id))
        throw new Error('Catalogue IDs must be unique nonempty strings');
      this.ids.add(v.id);
      for (const field of FIELDS) {
        if (typeof v[field] !== 'string' || !v[field].trim())
          throw new Error(`Invalid catalogue field ${field}`);
        const value = keyOf(v[field]),
          sequence = value.split(' ');
        for (const word of sequence) this.vocabulary.add(word);
        if (field === 'badge') {
          {
            const signature = [...new Set(sequence)].sort().join(' ');
            this.badgeSignatures.set(v.id, signature);
            let set = this.completeBadges.get(signature);
            if (!set) {
              set = new Set();
              this.completeBadges.set(signature, set);
            }
            set.add(v.id);
          }
          for (const word of sequence.filter((w) => /^[a-z]{5,12}$/.test(w)))
            for (let cut = 1; cut < word.length; cut++)
              add(field, word, [word.slice(0, cut), word.slice(cut)], v.id);
          for (const code of v.badge.match(/\b[A-Z]{2,5}\b/g) ?? []) {
            const word = code.toLowerCase();
            for (let cut = 1; cut < word.length; cut++)
              add(field, word, [word.slice(0, cut), word.slice(cut)], v.id);
          }
          sequence.forEach((word, i) => {
            if (!COLOURS.has(word)) add(field, word, [word], v.id);
            else {
              if (i > 0) add(field, word, [required(sequence[i - 1]), word], v.id);
              if (i + 1 < sequence.length)
                add(field, word, [word, required(sequence[i + 1])], v.id);
            }
          });
        } else add(field, value, sequence, v.id);
        if (field === 'model') {
          const split = sequence.flatMap((word) => word.match(/[a-z]+|[0-9]+/g) ?? [word]);
          if (split.join('') === sequence.join('') && split.length > sequence.length)
            add(field, value, split, v.id);
        }
        if (field === 'transmission_type' && value === 'automatic')
          add(field, value, ['dsg'], v.id);
        if (field === 'fuel_type' && sequence.includes('hybrid'))
          add(field, '@hybrid', ['hybrid'], v.id);
        if (field === 'drive_type' && ['front wheel drive', 'rear wheel drive'].includes(value)) {
          add(field, '@2wd', ['2wd'], v.id);
          add(field, '@2wd', ['two', 'wheel', 'drive'], v.id);
        }
        {
          // A model alias is not evidence for the similarly named GT trim.
          if (field === 'model' && keyOf(v.make) === 'toyota' && value === '86')
            add(field, value, ['gt86'], v.id);
          if (field === 'fuel_type' && sequence.includes('hybrid'))
            for (const fuel of ['petrol', 'diesel']) {
              if (sequence.includes(fuel)) add(field, value, [fuel, 'electric', 'hybrid'], v.id);
            }
          if (field === 'badge')
            for (const word of sequence) {
              const match = /^(?:([a-z]{2,5})([0-9]{2,4})|([0-9]{2,4})([a-z]{2,5}))$/.exec(word);
              if (!match) continue;
              const digits = required(match[2] ?? match[3]);
              for (const companion of sequence.filter((w) => w !== word && /^[a-z]+$/.test(w))) {
                let numbers = this.numericDesignations.get(companion);
                if (!numbers)
                  this.numericDesignations.set(
                    companion,
                    (numbers = new Map<string, Set<string>>()),
                  );
                let ids = numbers.get(digits);
                if (!ids) numbers.set(digits, (ids = new Set()));
                ids.add(v.id);
              }
            }
          if (field === 'badge')
            sequence.forEach((word, i) => {
              const number = /^[a-z]{2,5}(\d{2,4})$/.exec(word)?.[1],
                companion = sequence[i + 1];
              // A bare number is never enough: require the catalogue's adjoining
              // trim word, retaining all compatible expansions if ambiguous.
              if (number && companion && /^[a-z]+$/.test(companion))
                add(field, `@number:${number}`, [number, companion], v.id);
            });
        }
      }
    }
    for (const fuel of ['petrol', 'diesel']) {
      const value = `hybrid ${fuel}`;
      for (const phrase of [
        [fuel, 'hybrid'],
        ['hybrid', fuel],
      ]) {
        add('fuel_type', value, phrase);
        for (const v of vehicles)
          if (keyOf(v.fuel_type) === value) add('fuel_type', value, phrase, v.id);
      }
    }
    {
      add('drive_type', '@2wd', ['2wd']);
      add('drive_type', '@2wd', ['two', 'wheel', 'drive']);
    }
    for (const [code, definition] of Object.entries(MODEL_CODES)) {
      if (
        !vehicles.some(
          (v) => keyOf(v.make) === definition.make && keyOf(v.model) === definition.model,
        )
      )
        continue;
      add('fuel_type', definition.fuel, [code]);
      for (const v of vehicles)
        if (
          keyOf(v.make) === definition.make &&
          keyOf(v.model) === definition.model &&
          keyOf(v.fuel_type) === definition.fuel
        )
          add('fuel_type', definition.fuel, [code], v.id);
    }
    {
      // A closed fuel assertion is meaningful even when this catalogue lacks it.
      const fuels: Record<string, string[][]> = {
        '@hybrid': [['hybrid'], ['hybrid', 'electric']],
        'dual fuel': [
          ['dual', 'fuel'],
          ['dual', 'fuel', 'lpg', 'and', 'petrol'],
          ['lpg', 'and', 'petrol'],
          ['petrol', 'and', 'lpg'],
          ['lpg', 'petrol'],
          ['petrol', 'lpg'],
        ],
        lpg: [['lpg']],
        cng: [['cng']],
        hydrogen: [['hydrogen']],
        electric: [['electric']],
      };
      for (const [value, phrases] of Object.entries(fuels))
        for (const phrase of phrases) {
          add('fuel_type', value, phrase);
          for (const v of vehicles)
            if (
              keyOf(v.fuel_type) === value ||
              (value === '@hybrid' && keyOf(v.fuel_type).split(' ').includes('hybrid'))
            )
              add('fuel_type', value, phrase, v.id);
        }
    }
    for (const entry of this.entries.values()) {
      let current = this.trie;
      for (const word of entry.phrase) {
        let next = current.next.get(word);
        if (!next) {
          next = node();
          current.next.set(word, next);
        }
        current = next;
      }
      current.entries.push(entry);
      if ((entry.field === 'make' || entry.field === 'model') && entry.phrase.length === 1) {
        const word = required(entry.phrase[0]);
        this.identityWords.set(word, [...(this.identityWords.get(word) ?? []), entry]);
      }
    }
    for (const word of this.identityWords.keys())
      if (/^[a-z]{5,40}$/.test(word)) {
        this.maxIdentityLength = Math.max(this.maxIdentityLength, word.length);
        for (const deletion of edits(word)) {
          let set = this.spelling.get(deletion);
          if (!set) {
            set = new Set();
            this.spelling.set(deletion, set);
          }
          set.add(word);
        }
      }
  }
  async match(input: string): Promise<VehicleMatchResult> {
    if (typeof input !== 'string') throw new TypeError('Description must be a string');
    if (input.length > 10000) throw new RangeError('Description exceeds 10000 characters');
    const key = `${this.version}:${input}`;
    const previous = this.pending.get(key);
    if (previous) {
      this.stats.coalescedRequests++;
      return this.copy(await previous);
    }
    const task = this.resolve(key, input);
    this.pending.set(key, task);
    try {
      return this.copy(await task);
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key);
    }
  }
  private copy(r: VehicleMatchResult): VehicleMatchResult {
    return {
      ...r,
      candidateIds: [...r.candidateIds],
      retrievedCandidateIds: [...r.retrievedCandidateIds],
      notes: [...r.notes],
    };
  }
  private async resolve(key: string, input: string): Promise<VehicleMatchResult> {
    let analysis = this.cache.get(key);
    if (analysis) {
      this.stats.cacheHits++;
      this.cache.delete(key);
      this.cache.set(key, analysis);
    } else {
      this.stats.analysisComputations++;
      analysis = this.analyze(input);
      if (this.cacheSize) {
        this.cache.set(key, analysis);
        if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
      }
    }
    const ids = [...analysis.candidateIds].sort();
    let vehicleId = ids[0] ?? null;
    const notes = [...analysis.notes];
    if (ids.length > 1) {
      this.stats.countCalls++;
      const counts = await this.counts([...ids]);
      for (const id of ids) {
        const count = counts.get(id);
        if (count === undefined || !Number.isSafeInteger(count) || count < 0)
          throw new Error(`Missing or invalid listing count for candidate ${id}`);
      }
      vehicleId = ids.reduce((best, id) => (counts.get(id)! > counts.get(best)! ? id : best));
      notes.push(
        'Exact evidence-score tie resolved by fresh listing counts; equal counts use ascending string ID.',
      );
    }
    return { vehicleId, ...analysis, candidateIds: ids, notes };
  }
  private listingEquipment(
    item: PackageItem,
    items: PackageItem[],
    evidence: Evidence[],
    parts: Segment[],
    text: string,
    onValidated?: () => void,
  ): Evidence[] {
    const inside = evidence.filter((e) => e.start >= item.start && e.end <= item.end);
    if (inside.some((e) => !['badge', 'make', 'model'].includes(e.entry.field) || e.negative))
      return [];
    // A nominal equipment item may repeat the same model and a partial base
    // badge. Its evidence must agree with an independently complete base.
    const outside = evidence.filter(
      (e) => !e.negative && !items.some((p) => e.start >= p.start && e.end <= p.end),
    );
    const anchors = [
      ...new Set(outside.filter((e) => e.entry.field === 'model').map((e) => e.segment)),
    ].sort(
      (a, b) =>
        Math.abs(required(parts[a]).start - item.start) -
        Math.abs(required(parts[b]).start - item.start),
    );
    for (const segment of anchors) {
      const part = required(parts[segment]);
      if (!['neutral', 'target', 'correction'].includes(part.role)) continue;
      const base = outside.filter(
        (e) =>
          e.segment === segment ||
          (e.segment === segment + 1 &&
            e.end <= item.start &&
            required(parts[e.segment]).role === 'neutral' &&
            !outside.some(
              (p) => p.segment === e.segment && ['make', 'model'].includes(p.entry.field),
            )),
      );
      const identity = base.filter((e) => ['make', 'model'].includes(e.entry.field));
      const signature = [
        ...new Set(base.filter((e) => e.entry.field === 'badge').map((e) => e.entry.value)),
      ]
        .sort()
        .join(' ');
      let possible = [...(this.completeBadges.get(signature) ?? [])].filter((id) =>
        base.every((e) => e.entry.ids.has(id)),
      );
      // A uniquely resolved partial grade may support an explicitly attached
      // option, while ambiguous fragments (e.g. Touring Plus/Extra) remain tied.
      if (
        !possible.length &&
        true &&
        base.some((e) => e.entry.field === 'badge') &&
        (/\b(?:with|options?|extras?|equipment|fitted|including)\b/.test(
          text.slice(item.listStart, item.start),
        ) ||
          /\b(?:packages?|optioned)\b/.test(text.slice(item.listStart, item.start)))
      ) {
        const seed = base.reduce((best, e) => (e.entry.ids.size < best.entry.ids.size ? e : best));
        const compatible = [...seed.entry.ids].filter((id) =>
          base.every((e) => e.entry.ids.has(id)),
        );
        if (new Set(compatible.map((id) => this.badgeSignatures.get(id))).size === 1)
          possible = compatible;
      }
      if (
        !possible.length &&
        true &&
        !base.some((e) => e.entry.field === 'badge') &&
        identity.some((e) => e.entry.field === 'model') &&
        enumeratedEquipment(text, item.end)
      ) {
        const words = tokens(text.slice(item.start, item.end)).map((t) =>
          t.word === 'pack' ? 'package' : t.word,
        );
        const actualGrade = [...this.badgeSignatures].some(
          ([id, sig]) =>
            identity.every((e) => e.entry.ids.has(id)) &&
            words.every((w) => sig.split(' ').includes(w)),
        );
        if (!actualGrade) {
          const seed = identity.reduce((a, b) => (a.entry.ids.size < b.entry.ids.size ? a : b));
          possible = [...seed.entry.ids].filter((id) => base.every((e) => e.entry.ids.has(id)));
        }
      }
      if (!possible.length) continue;
      const after = identity.every((e) => e.start >= item.end);
      // Forward attachment requires an explicit relationship ("added to"),
      // not an arbitrary later vehicle mention.
      if (
        after &&
        !/^\s+(?:added|fitted|included)\s+(?:to|on|with)\b/.test(text.slice(item.end, part.end))
      ) {
        const itemWords = tokens(text.slice(item.start, item.end)).map((t) => t.word);
        const actualNamedGrade = [...this.badgeSignatures].some(
          ([id, signature]) =>
            identity.every((e) => e.entry.ids.has(id)) &&
            itemWords.every((word) => signature.split(' ').includes(word)),
        );
        const labelled =
          (!actualNamedGrade && /\b(?:package|pack)\s*$/.test(text.slice(item.start, item.end))) ||
          /^\s*(?:factory\s+)?(?:options?|extras?|equipment|factory fitted)(?:\s+include[ds]?)?\s*:/.test(
            text.slice(item.listStart, item.start),
          );
        const future = outside.filter(
          (e) => e.start >= item.end && ['make', 'model'].includes(e.entry.field),
        );
        const unambiguous = ['make', 'model'].every(
          (field) =>
            new Set(future.filter((e) => e.entry.field === field).map((e) => e.entry.value)).size <=
            1,
        );
        if (
          !labelled ||
          !unambiguous ||
          outside.some((e) => e.end <= item.listStart && ['make', 'model'].includes(e.entry.field))
        )
          continue;
      }
      const start = Math.min(part.start, item.start),
        end = Math.max(part.start, item.start);
      if (
        parts.some(
          (p) =>
            p !== part &&
            p.start > start &&
            p.start < end &&
            ['target', 'correction'].includes(p.role),
        )
      )
        continue;
      const intervening = evidence.filter(
        (e) => e.start > start && e.start < end && ['make', 'model'].includes(e.entry.field),
      );
      if (
        [...inside.filter((e) => ['make', 'model'].includes(e.entry.field)), ...intervening].some(
          (e) => possible.every((id) => !e.entry.ids.has(id)),
        )
      )
        continue;
      if (!identity.some((e) => e.entry.field === 'model')) continue;
      onValidated?.();
      return inside.filter(
        (e) => e.entry.field === 'badge' && possible.every((id) => !e.entry.ids.has(id)),
      );
    }
    return [];
  }
  private analyze(input: string): Analysis {
    const relationSpans: RelationSpan[] = [];

    const surface = structuredListingText(input);
    const source = prepareListing(surface, true);
    const prepared = source.replace(/\r?\n(?=[^\r\n]*\b(?:package|pack)\b)/gi, '; ');
    const text = maskMetadata(normalize(prepared)),
      stream = tokens(text),
      parts = segments(text.replace(/(?<=\d)\.(?=\d)/g, ' '), true, true, true, true, true, true);
    const notes: string[] = [];
    let scopedIdentityIds: string[] = [];
    const empty = (
      confidence: number,
      note: string,
      retrievedCandidateIds: string[] = scopedIdentityIds,
      _code = 'unresolved',
    ): Analysis => {
      return {
        candidateIds: [],
        retrievedCandidateIds,
        confidence,
        notes: [...notes, note],
        needsSemanticReview: true,
      };
    };
    if (!stream.length) return empty(0, 'No identity evidence.');
    if (stream.length > 512)
      return empty(
        0,
        'More than 512 tokens exceed the bounded interpretation budget; manual review is required.',
        undefined,
        'input-limit',
      );
    const evidence: Evidence[] = [];
    const segmentFor = (at: number) => parts.findIndex((part) => at >= part.start && at < part.end);
    const polarity = (start: number, part: Segment, field: Field) => {
      let prefix = text.slice(part.start, start);
      {
        const affirmative = presentationEnd(prefix);
        if (affirmative !== undefined) prefix = prefix.slice(affirmative);
      }
      // Reset negation after a colon without losing roles such as "engine donor:".
      const colon = prefix.lastIndexOf(':');
      const scopedAlternative =
        colon >= 0 &&
        !/\b(?:selling|sell|sale|trade|swap|wanted|looking|never)\b/.test(prefix.slice(0, colon)) &&
        evidence.some(
          (e) =>
            e.segment === parts.indexOf(part) &&
            e.negative &&
            e.entry.field !== 'make' &&
            e.entry.field !== 'model' &&
            e.end <= part.start + colon,
        );
      const before = tokens(scopedAlternative ? prefix.slice(colon + 1) : prefix);
      if (before.at(-1)?.word === 'non') return true;
      let neg = -1;
      for (let i = before.length - 1; i >= 0; i--)
        if (['not', 'never', 'no'].includes(required(before[i]).word)) {
          neg = i;
          break;
        }
      if (
        neg >= 0 &&
        before.slice(neg + 1).some((token) => /^(?:ignore|disregard)$/.test(token.word))
      )
        return false;
      if (neg >= 0 && !/\b(?:selling|sell|sale|trade|swap|wanted|looking|never)\b/.test(prefix)) {
        const negEnd = part.start + (scopedAlternative ? colon + 1 : 0) + required(before[neg]).end;
        // A completed attribute exclusion does not negate an immediately
        // following attribute from a different field. Conjunctions/verbs break
        // this adjacency; "not hybrid or automatic" keeps its broad scope.
        if (
          evidence.some(
            (e) =>
              e.segment === parts.indexOf(part) &&
              e.negative &&
              e.start >= negEnd &&
              e.end <= start &&
              !['make', 'model'].includes(e.entry.field) &&
              e.entry.field !== field &&
              /^\s*$/.test(text.slice(e.end, start)),
          )
        )
          return false;
      }
      return (
        neg >= 0 &&
        !before.slice(neg + 1).some((token) => token.word === 'and') &&
        !before.slice(neg + 1).some((token) => token.word === 'only' || token.word === 'sure')
      );
    };
    for (let i = 0; i < stream.length; i++) {
      let current = this.trie;
      const segment = segmentFor(required(stream[i]).start);
      if (segment < 0 || false) continue;
      for (
        let j = i;
        j < stream.length && required(stream[j]).start < required(parts[segment]).end;
        j++
      ) {
        this.stats.trieSteps++;
        const next = current.next.get(required(stream[j]).word);
        if (!next) break;
        current = next;
        for (const entry of current.entries) {
          if (
            entry.field === 'badge' &&
            entry.phrase.length === 2 &&
            entry.value === entry.phrase.join('') &&
            entry.value.length >= 5 &&
            !/^\s*-\s*$/.test(text.slice(required(stream[i]).end, required(stream[j]).start))
          )
            continue;
          // "It's the edition" names a category, not another named Edition badge.
          if (
            entry.field === 'badge' &&
            entry.phrase.length === 1 &&
            /^(?:edition|trim|package)$/.test(entry.value) &&
            /\b(?:it'?s|it is|that'?s|that is)\s+(?:the|an?)\s*$/.test(
              text.slice(required(parts[segment]).start, required(stream[i]).start),
            )
          )
            continue;
          // Unhyphenated negative component lists are ambiguous; preserve both
          // literal exclusions. A positive contiguous compound or explicit
          // hyphenated negative compound has a single fuel meaning.
          if (
            entry.field === 'fuel_type' &&
            ['petrol', 'diesel'].includes(required(entry.phrase[0])) &&
            entry.phrase[1] === 'hybrid' &&
            polarity(required(stream[i]).start, required(parts[segment]), entry.field) &&
            !text.slice(required(stream[i]).end, required(stream[j]).start).includes('-')
          )
            continue;
          evidence.push({
            entry,
            start: required(stream[i]).start,
            end: required(stream[j]).end,
            segment,
            negative: polarity(required(stream[i]).start, required(parts[segment]), entry.field),
            quality: 1,
          });
        }
      }
    }
    for (const token of stream) {
      if (
        !/^[0-9]{2,4}$/.test(token.word) ||
        /^(?:19|20)[0-9]{2}$/.test(token.word) ||
        evidence.some((e) => token.start >= e.start && token.end <= e.end)
      )
        continue;
      // Measurements, prices and thousands groups are not abbreviated grades.
      if (
        /(?:[0-9.,/]|[$£€]\s*)$/.test(text.slice(Math.max(0, token.start - 4), token.start)) ||
        /^[0-9.,/]/.test(text.slice(token.end)) ||
        /^\s+(?:km|kms|kilometres|miles|nm|kw|hp|kg|cc|litres|dollars|months|days|mm|inch|inches)\b/.test(
          text.slice(token.end),
        )
      )
        continue;
      const segment = segmentFor(token.start),
        identity = evidence.filter(
          (e) => e.segment === segment && !e.negative && ['make', 'model'].includes(e.entry.field),
        );
      if (!identity.some((e) => e.entry.field === 'model')) continue;
      for (const companion of evidence.filter(
        (e) =>
          e.segment === segment &&
          !e.negative &&
          e.entry.field === 'badge' &&
          this.numericDesignations.has(e.entry.value),
      )) {
        const start = Math.min(companion.start, token.start),
          end = Math.max(companion.end, token.end),
          between = stream.filter((t) => t.start >= start && t.end <= end);
        if (between.length > 8 || !/^[a-z0-9 -]+$/.test(text.slice(start, end))) continue;
        if (
          between.some(
            (t) =>
              t !== token &&
              !/^(?:v[468]|i[346])$/.test(t.word) &&
              !evidence.some((e) => e.segment === segment && t.start >= e.start && t.end <= e.end),
          )
        )
          continue;
        const family = this.numericDesignations.get(companion.entry.value)!;
        if (
          ![...family.values()].some((ids) =>
            [...ids].some((id) => identity.every((e) => e.entry.ids.has(id))),
          )
        )
          continue;
        const ids = new Set(
          [...(family.get(token.word) ?? [])].filter((id) =>
            identity.every((e) => e.entry.ids.has(id)),
          ),
        );
        evidence.push({
          entry: { field: 'badge', value: `@number:${token.word}`, phrase: [token.word], ids },
          start: token.start,
          end: token.end,
          segment,
          negative: polarity(token.start, required(parts[segment]), 'badge'),
          quality: 1,
        });
        break;
      }
    }
    // Full fuel phrases override contained component labels (Hybrid-Diesel is
    // not simultaneous positive Hybrid-Diesel and Diesel evidence).
    let found = evidence.filter(
      (e) =>
        !evidence.some(
          (other) =>
            other !== e &&
            other.entry.field === e.entry.field &&
            e.entry.field !== 'badge' &&
            other.start <= e.start &&
            other.end >= e.end &&
            other.end - other.start > e.end - e.start,
        ),
    );
    found = found.filter(
      (e) =>
        !found.some(
          (other) =>
            other !== e &&
            e.entry.field === 'badge' &&
            other.entry.field === 'badge' &&
            other.entry.phrase.length === 2 &&
            other.entry.value === other.entry.phrase.join('') &&
            other.start <= e.start &&
            other.end >= e.end &&
            other.end - other.start > e.end - e.start,
        ),
    );
    found = found.filter((e) => {
      const code =
        e.entry.field === 'fuel_type' && e.entry.phrase.length === 1
          ? MODEL_CODES[required(e.entry.phrase[0])]
          : undefined;
      return (
        !code ||
        (found.some(
          (p) =>
            p.segment === e.segment &&
            !p.negative &&
            p.entry.field === 'model' &&
            p.entry.value === code.model,
        ) &&
          !found.some(
            (p) =>
              p.segment === e.segment &&
              !p.negative &&
              p.entry.field === 'make' &&
              p.entry.value !== code.make,
          ))
      );
    });
    {
      const hasModel = found.some((e) => e.entry.field === 'model' && !e.negative);
      for (let i = 0; i < stream.length; i++) {
        const token = required(stream[i]),
          segment = segmentFor(token.start);
        if (
          segment < 0 ||
          EXCLUDED.has(required(parts[segment]).role) ||
          token.word.length > this.maxIdentityLength + 1 ||
          !/^[a-z]{5,40}$/.test(token.word) ||
          this.vocabulary.has(token.word) ||
          GRAMMAR.has(token.word) ||
          COLOURS.has(token.word)
        )
          continue;
        const choices = new Set<string>();
        for (const deletion of edits(token.word))
          for (const candidate of this.spelling.get(deletion) ?? [])
            if (editOne(token.word, candidate) || adjacentSwap(token.word, candidate))
              choices.add(candidate);
        if (choices.size !== 1) continue;
        const entries = this.identityWords.get(required([...choices][0]))!;
        for (const entry of entries) {
          const priorMake = found.some(
            (e) =>
              e.entry.field === 'make' &&
              e.segment === segment &&
              e.end <= token.start &&
              token.start - e.end < 8,
          );
          const hasBadge = found.some((e) => e.entry.field === 'badge' && e.segment === segment);
          if (entry.field === 'make' ? !hasModel : !priorMake && (hasModel || !hasBadge)) continue;
          found.push({
            entry,
            start: token.start,
            end: token.end,
            segment,
            negative: polarity(token.start, required(parts[segment]), entry.field),
            quality: 0.7,
          });
        }
      }
    }

    const nominalLexicalEvidence = [...found];
    const discardedContext: Evidence[] = [];
    let namedGradeIds: Set<string> | undefined;
    const scopedPackageItems: PackageItem[] = [];
    {
      const providers = found.filter(
        (e) =>
          ['make', 'model'].includes(e.entry.field) &&
          serviceProviderMention(
            text,
            e.start,
            e.end,
            required(parts[e.segment]).start,
            e.entry.field,
          ) &&
          found.some(
            (p) =>
              p !== e &&
              p.entry.field === 'model' &&
              !p.negative &&
              !EXCLUDED.has(required(parts[p.segment]).role) &&
              !serviceProviderMention(
                text,
                p.start,
                p.end,
                required(parts[p.segment]).start,
                p.entry.field,
              ),
          ),
      );
      discardedContext.push(...providers);
      found = found.filter((e) => !providers.includes(e));
      if (providers.length)
        notes.push(
          `Mention role: ${providers.length} service-provider identity observation(s) excluded before target priority; other facts in those clauses remain available.`,
        );
    }
    {
      // Detection is lexical; relation assignment precedes all identity/ranking
      // constraints, so another object's model/fuel never poisons retrieval.
      const active = found.filter(
        (e) => !e.negative && !EXCLUDED.has(required(parts[e.segment]).role),
      );
      relationSpans.push(
        ...entityRelations(
          text,
          active.filter((e) => e.entry.field === 'model'),
          active.map((e) => ({ start: e.start, end: e.end, field: e.entry.field })),
        ),
        ...equipmentRelations(text, true),
      );
      const excluded = found.filter(
        (e) =>
          EXCLUDED.has(required(parts[e.segment]).role) ||
          relationSpans.some(
            (span) =>
              e.start >= span.start &&
              e.end <= span.end &&
              (span.role === 'other-entity' ||
                !['make', 'model', 'badge'].includes(e.entry.field) ||
                active.some((p) => p.entry.field === 'model' && p.end <= span.start)),
          ),
      );
      discardedContext.push(...excluded);
      found = found.filter((e) => !excluded.includes(e));
      for (const role of ['other-entity', 'equipment'] as const) {
        const count = excluded.filter((e) =>
          relationSpans.some((s) => s.role === role && e.start >= s.start && e.end <= s.end),
        ).length;
        if (count)
          notes.push(
            `Relation attachment: ${count} observation(s) assigned to ${role} complements/heads before candidate constraints.`,
          );
      }
    }
    {
      // Engine codes and grade names are separate catalogue-derived dimensions.
      // An explicit category head can close a complete grade name without
      // inventing the omitted engine code; longer named editions stay distinct.
      for (const category of found.filter(
        (e) => e.entry.field === 'badge' && e.entry.value === 'edition' && !e.negative,
      )) {
        const prior = found.filter(
          (e) =>
            e.entry.field === 'badge' &&
            !e.negative &&
            e.end <= category.start &&
            e.segment === category.segment,
        );
        const last = prior.at(-1);
        if (!last || !/^\s+$/.test(text.slice(last.end, category.start))) continue;
        const identity = found.filter(
          (e) => !e.negative && ['make', 'model'].includes(e.entry.field),
        );
        const signature = [
          ...new Set(
            prior.map((e) => e.entry.value).filter((v) => !this.candidateIndex!.isDesignation(v)),
          ),
        ]
          .sort()
          .join(' ');
        const ids = [...this.badgeSignatures]
          .filter(
            ([id, badge]) =>
              identity.every((e) => e.entry.ids.has(id)) &&
              badge.split(' ').some((w) => this.candidateIndex!.isDesignation(w)) &&
              badge
                .split(' ')
                .filter((w) => !this.candidateIndex!.isDesignation(w))
                .join(' ') === signature,
          )
          .map(([id]) => id);
        if (ids.length) {
          namedGradeIds = new Set(ids);
          discardedContext.push(category);
          found = found.filter((e) => e !== category);
        }
      }
    }
    {
      {
        // Retention predicates describe a different ownership/disposal subject.
        // They are only excluded beside an independently asserted sale target;
        // explicitly retained gearbox/engine components remain target evidence.
        const sale = parts.filter((p) => p.role === 'target');
        const retained = parts.filter(
          (p) =>
            p.role === 'neutral' &&
            !/\b(?:engine|motor|gearbox|transmission|clutch)\b/.test(p.text) &&
            (/\b(?:stays|is staying|will stay)(?:\s+(?:with (?:me|us)|here))?\s*$/.test(p.text) ||
              /^\s*(?:(?:i|we)(?: am| are)?\s+)?(?:keep|keeping|retaining)\s+/.test(p.text)) &&
            sale.some(
              (target) =>
                target !== p &&
                found.some(
                  (e) =>
                    e.entry.field === 'model' && e.start >= target.start && e.end <= target.end,
                ),
            ),
        );
        const owned = found.filter((e) =>
          retained.some((p) => e.start >= p.start && e.end <= p.end),
        );
        discardedContext.push(...owned);
        found = found.filter((e) => !owned.includes(e));
        if (owned.length)
          notes.push(
            'A retained ownership subject is distinct from the independently asserted sale target.',
          );
      }
      const spans = componentSpans(text, true, true, true);
      const equipment = found.filter((e) =>
        spans.some(
          (span) =>
            e.start >= span.start &&
            e.end <= span.end &&
            // A donor identity needs an independent earlier target identity.
            (!['make', 'model', 'badge'].includes(e.entry.field) ||
              found.some((p) => p.entry.field === 'model' && p.end <= span.start)),
        ),
      );
      discardedContext.push(...equipment);
      found = found.filter((e) => !equipment.includes(e));
      if (equipment.length)
        notes.push('Complete component noun spans own their modifiers and donor identities.');
      // A catalogue grade word can instead modify a transmission head when
      // that grade is impossible for the target identity and a full base exists.
      const identities = found.filter(
        (e) => !e.negative && ['make', 'model'].includes(e.entry.field),
      );
      const modifiers = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          e.entry.value === 'sport' &&
          !e.negative &&
          /^\s+(?:automatic|manual)\b/.test(text.slice(e.end)) &&
          identities.some((p) => p.entry.field === 'model') &&
          ![...e.entry.ids].some((id) => identities.every((p) => p.entry.ids.has(id))) &&
          (() => {
            const base = found.filter((p) => p !== e && !p.negative);
            const signature = [
              ...new Set(base.filter((p) => p.entry.field === 'badge').map((p) => p.entry.value)),
            ]
              .sort()
              .join(' ');
            return [...(this.completeBadges.get(signature) ?? [])].some((id) =>
              base.every((p) => p.entry.ids.has(id)),
            );
          })(),
      );
      discardedContext.push(...modifiers);
      found = found.filter((e) => !modifiers.includes(e));
    }
    {
      const scopes = found.map((e) => ({
        e,
        scope: claimScope(
          text,
          e.start,
          e.end,
          e.entry.field,
          required(parts[e.segment]),
          true,
          found.some(
            (p) =>
              p.segment === e.segment && !p.negative && ['make', 'model'].includes(p.entry.field),
          ),
          found.filter((p) => p !== e),
        ),
      }));
      const excluded = scopes.filter((x) => x.scope.role !== 'target');
      discardedContext.push(...excluded.map((x) => x.e));
      found = found.filter((e) => !excluded.some((x) => x.e === e));
      for (const role of ['equipment', 'comparison', 'desired', 'attribute-modifier']) {
        const n = excluded.filter((x) => x.scope.role === role).length;
        if (n)
          notes.push(
            `Claim scope: ${n} observation(s) belong to ${role}, not the target vehicle attribute.`,
          );
      }
      // Preposed category syntax "limited edition <grade>" is descriptive only
      // when the named grade independently identifies a compatible catalogue
      // badge and the catalogue has no matching full Limited/Edition assertion.
      const categories = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          e.entry.value === 'edition' &&
          !e.negative &&
          /\blimited\s+$/.test(text.slice(required(parts[e.segment]).start, e.start)) &&
          found.some(
            (p) =>
              p.entry.field === 'badge' &&
              p.start >= e.end &&
              /^\s*$/.test(text.slice(e.end, p.start)),
          ) &&
          found.some((p) => p.entry.field === 'model' && p.start > e.end) &&
          ![...e.entry.ids].some((id) =>
            found
              .filter((p) => !p.negative && ['make', 'model', 'badge'].includes(p.entry.field))
              .every((p) => p.entry.ids.has(id)),
          ),
      );
      const categoryWords = found.filter((e) =>
        categories.some(
          (category) =>
            e === category ||
            (e.entry.field === 'badge' &&
              e.entry.value === 'limited' &&
              e.end <= category.start &&
              /^\s+$/.test(text.slice(e.end, category.start))),
        ),
      );
      discardedContext.push(...categoryWords);
      found = found.filter((e) => !categoryWords.includes(e));
    }
    {
      // Appositive type descriptions cannot replace a separately complete grade
      // with a mere catalogue fragment. A complete conflicting named grade or
      // explicit grade/engine assertion remains authoritative evidence.
      for (const part of parts.filter(
        (p) =>
          p.role === 'neutral' &&
          /\b(?:the|an?)\b/.test(p.text) &&
          /\b(?:model|version|vehicle|car)\b/.test(p.text) &&
          !/\b(?:badge|grade|trim|actually|correction)\b/.test(p.text),
      )) {
        const inside = found.filter((e) => e.start >= part.start && e.end <= part.end);
        if (
          !inside.length ||
          inside.some(
            (e) =>
              e.negative ||
              e.entry.field !== 'badge' ||
              this.candidateIndex!.isDesignation(e.entry.value),
          )
        )
          continue;
        const category = inside.filter((e) =>
          /^\s+(?:model|version|vehicle|car)\b/.test(text.slice(e.end, part.end)),
        );
        if (!category.length) continue;
        const outside = found.filter((e) => !inside.includes(e) && !e.negative);
        const identity = outside.filter((e) => ['make', 'model'].includes(e.entry.field));
        const insideSignature = [...new Set(inside.map((e) => e.entry.value))].sort().join(' ');
        if (
          [...(this.completeBadges.get(insideSignature) ?? [])].some((id) =>
            identity.every((e) => e.entry.ids.has(id)),
          )
        )
          continue;
        const signature = [
          ...new Set(outside.filter((e) => e.entry.field === 'badge').map((e) => e.entry.value)),
        ]
          .sort()
          .join(' ');
        if (
          identity.some((e) => e.entry.field === 'model') &&
          [...(this.completeBadges.get(signature) ?? [])].some((id) =>
            outside.every((e) => e.entry.ids.has(id)),
          )
        ) {
          discardedContext.push(...inside);
          found = found.filter((e) => !inside.includes(e));
          notes.push(
            'A partial grade word in an appositive type description does not replace the independently complete vehicle grade.',
          );
        }
      }
    }
    {
      // A benefit clause ending "... make(s) this <vehicle>" describes why
      // the vehicle appeals. It does not assert a preceding catalogue grade.
      // Do not apply this role across another identity or an explicit trim claim.
      const first = found
        .filter((e) => !e.negative && ['make', 'model'].includes(e.entry.field))
        .sort((a, b) => a.start - b.start)[0];
      if (
        first &&
        /\bmake(?:s)?\s+(?:this|the)\s+(?:(?:19|20)\d{2}\s+)?$/.test(text.slice(0, first.start)) &&
        !/\b(?:badge|grade|trim|edition)\s+(?:is|was|:)\b/.test(text.slice(0, first.start))
      ) {
        const introductory = found.filter(
          (e) => e.end <= first.start && e.entry.field === 'badge' && !e.negative,
        );
        discardedContext.push(...introductory);
        found = found.filter((e) => !introductory.includes(e));
        if (introductory.length)
          notes.push('Introductory benefit-clause modifiers are not asserted target designations.');
      }
    }
    {
      // "with the <modifier> <ordinary noun>" is an attribute phrase only
      // after an independently complete vehicle designation. Catalogue names,
      // explicit grade nouns and scalar assertions never qualify as that noun.
      const attributes = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          !e.negative &&
          /\bwith\s+(?:the|an?)\s+$/.test(text.slice(required(parts[e.segment]).start, e.start)) &&
          (() => {
            const head = stream.find((t) => t.start >= e.end && segmentFor(t.start) === e.segment);
            if (
              !head ||
              !/^\s+$/.test(text.slice(e.end, head.start)) ||
              !/^[a-z]{4,}$/.test(head.word) ||
              GRAMMAR.has(head.word) ||
              /^(?:badge|trim|grade|edition|model|variant|package|pack)$/.test(head.word) ||
              found.some((p) => p.start <= head.start && p.end >= head.end)
            )
              return false;
            const base = found.filter((p) => p !== e && !p.negative);
            const identity = base.filter((p) => ['make', 'model'].includes(p.entry.field));
            const signature = [
              ...new Set(base.filter((p) => p.entry.field === 'badge').map((p) => p.entry.value)),
            ]
              .sort()
              .join(' ');
            return (
              identity.some((p) => p.entry.field === 'model') &&
              [...(this.completeBadges.get(signature) ?? [])].some((id) =>
                base.every((p) => p.entry.ids.has(id)),
              )
            );
          })(),
      );
      discardedContext.push(...attributes);
      found = found.filter((e) => !attributes.includes(e));
      if (attributes.length)
        notes.push(
          'An ordinary-noun attribute phrase is distinct from the independently complete target designation.',
        );
    }
    {
      const marketing = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          !e.negative &&
          /^\s+(?:comfort|quality|condition|features|finish|performance)\b/.test(
            text.slice(e.end),
          ) &&
          found.some((p) => p.entry.field === 'model' && p.start > e.end),
      );
      discardedContext.push(...marketing);
      found = found.filter((e) => !marketing.includes(e));
    }
    {
      // In "the <grade> edition", edition can be a category noun. Retain it
      // when that complete designation is supported for the stated identity.
      const descriptors = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          e.entry.value === 'edition' &&
          !e.negative &&
          /\bthe\s+(?:[a-z0-9-]+\s+){1,4}$/.test(
            text.slice(required(parts[e.segment]).start, e.start),
          ) &&
          found.some(
            (p) =>
              p.segment === e.segment &&
              p.entry.field === 'badge' &&
              p.end <= e.start &&
              /^\s*$/.test(text.slice(p.end, e.start)),
          ) &&
          found.some((p) => p.segment === e.segment && p.entry.field === 'model') &&
          ![...e.entry.ids].some((id) =>
            found
              .filter(
                (p) =>
                  p.segment === e.segment &&
                  !p.negative &&
                  (['make', 'model'].includes(p.entry.field) ||
                    (p.entry.field === 'badge' &&
                      p.end <= e.end &&
                      p.start > text.lastIndexOf('package', e.start))),
              )
              .every((p) => p.entry.ids.has(id)),
          ),
      );
      discardedContext.push(...descriptors);
      found = found.filter((e) => !descriptors.includes(e));
    }
    {
      const coordinators = found.filter(
        (e) =>
          e.entry.field === 'badge' &&
          e.entry.value === 'plus' &&
          !e.negative &&
          additiveCoordinator(
            text,
            e.start,
            e.end,
            (() => {
              const base = found.filter(
                (p) => !p.negative && p.end <= e.start && p.segment === e.segment,
              );
              const signature = [
                ...new Set(base.filter((p) => p.entry.field === 'badge').map((p) => p.entry.value)),
              ]
                .sort()
                .join(' ');
              return (
                base.some((p) => p.entry.field === 'model') &&
                [...(this.completeBadges.get(signature) ?? [])].some((id) =>
                  base.every((p) => p.entry.ids.has(id)),
                )
              );
            })(),
          ),
      );
      discardedContext.push(...coordinators);
      found = found.filter((e) => !coordinators.includes(e));
    }
    {
      let listed = packageItems(text, true, true, true, true, true, true, true, true);
      {
        // A complete, compatible base is also a valid attachment anchor for a
        // following package list, even without a literal "with" cue.
        const additions: PackageItem[] = [];
        for (const end of new Set(
          found
            .filter((e) => (e.entry.field === 'badge' || e.entry.field === 'model') && !e.negative)
            .map((e) => e.end),
        )) {
          const base = found.filter((e) => !e.negative && e.end <= end);
          const identity = base.filter((e) => ['make', 'model'].includes(e.entry.field));
          if (!identity.some((e) => e.entry.field === 'model')) continue;
          const signature = [
            ...new Set(base.filter((e) => e.entry.field === 'badge').map((e) => e.entry.value)),
          ]
            .sort()
            .join(' ');
          const complete = [...(this.completeBadges.get(signature) ?? [])].some((id) =>
            base.every((e) => e.entry.ids.has(id)),
          );
          if (!complete && !!base.some((e) => e.entry.field === 'badge')) continue;
          for (const item of packageItems(
            text.slice(end),
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
          )) {
            if (item.listStart !== 0) continue;
            const shifted = { start: item.start + end, end: item.end + end, listStart: end };
            const words = tokens(text.slice(shifted.start, shifted.end)).map((t) =>
              t.word === 'pack' ? 'package' : t.word,
            );
            const actualGrade = [...this.badgeSignatures].some(
              ([id, sig]) =>
                identity.every((e) => e.entry.ids.has(id)) &&
                words.every((w) => sig.split(' ').includes(w)),
            );
            if (!actualGrade && (complete || enumeratedEquipment(text, shifted.end)))
              additions.push(shifted);
          }
        }
        listed = [...listed, ...additions].filter(
          (item, i, all) =>
            !all.some((other) => other.start > item.start && other.end === item.end) &&
            all.findIndex((other) => other.start === item.start && other.end === item.end) === i,
        );
      }
      for (const group of text.matchAll(
        /(?:^|[;:|]|\s-\s|\bwith\s+)\s*([a-z0-9](?:[a-z0-9&+ ]|-(?!\s)){0,100}?)\s+(?:packages|packs)\b/g,
      )) {
        const start = group.index + group[0].indexOf(required(group[1]));
        if (tokens(required(group[1])).length <= 12)
          listed.push({ start, end: group.index + group[0].length, listStart: group.index });
      }
      {
        // An explicitly labelled option can clarify an earlier repeated name.
        // Only a complete independent base supports that reference resolution.
        for (const item of listed) {
          if (
            !/\b(?:factory|options?|equipment|extras?|fitted)\b/.test(
              text.slice(item.listStart, item.start),
            )
          )
            continue;
          const values = new Set(
            found
              .filter(
                (e) => e.entry.field === 'badge' && e.start >= item.start && e.end <= item.end,
              )
              .map((e) => e.entry.value),
          );
          const occurrences = found.filter(
            (e) => e.entry.field === 'badge' && !e.negative && values.has(e.entry.value),
          );
          const base = found.filter((e) => !occurrences.includes(e) && !e.negative);
          const precedingModel = base
            .filter((e) => e.entry.field === 'model' && e.end <= item.start)
            .at(-1);
          if (
            precedingModel &&
            parts.some(
              (p) =>
                p.start > precedingModel.end &&
                p.start < item.start &&
                ['target', 'correction'].includes(p.role),
            )
          )
            continue;
          const signature = [
            ...new Set(base.filter((e) => e.entry.field === 'badge').map((e) => e.entry.value)),
          ]
            .sort()
            .join(' ');
          if (
            base.some((e) => e.entry.field === 'model') &&
            [...(this.completeBadges.get(signature) ?? [])].some((id) =>
              base.every((e) => e.entry.ids.has(id)),
            )
          ) {
            discardedContext.push(...occurrences);
            found = found.filter((e) => !occurrences.includes(e));
          }
        }
      }
      const beforeRemoval = found;
      for (const item of listed) {
        {
          let validated = false;
          const removable = this.listingEquipment(item, listed, beforeRemoval, parts, text, () => {
            validated = true;
          });
          if (removable.length || validated) scopedPackageItems.push(item);
          if (removable.length) {
            const firstIdentity = beforeRemoval
              .filter((e) => ['make', 'model'].includes(e.entry.field))
              .sort((a, b) => a.start - b.start)[0];
            if (firstIdentity && firstIdentity.start >= item.end) {
              const headingClose = required(parts[firstIdentity.segment]).start;
              const prelude = beforeRemoval.filter(
                (e) =>
                  headingClose >= item.end &&
                  headingClose <= firstIdentity.start &&
                  e.end <= headingClose &&
                  !removable.includes(e),
              );
              if (
                !prelude.some((e) => e.negative || !['badge'].includes(e.entry.field)) &&
                !/\b(?:badge|grade|trim|edition|actually|correction)\b/.test(
                  text.slice(
                    item.end,
                    headingClose >= item.end ? headingClose : firstIdentity.start,
                  ),
                )
              ) {
                const adjectives = prelude.filter(
                  (e) => !this.candidateIndex!.isDesignation(e.entry.value),
                );
                discardedContext.push(...adjectives);
                found = found.filter((e) => !adjectives.includes(e));
              }
            }
          }
          discardedContext.push(...removable);
          found = found.filter((e) => !removable.includes(e));
          continue;
        }
      }
      if (discardedContext.length)
        notes.push(
          'Nominal package-list items are equipment for a separately established compatible base trim; prices and list separators do not change vehicle fields.',
        );
    }
    {
      // The immediately preceding designation modifies the component, e.g.
      // "GTS brakes". Walk only contiguous identity/badge words, stopping at
      // transmission/fuel, prose, punctuation or a clause boundary.
      for (const component of text.matchAll(
        /\b(?:brakes|wheels|rims|(?:tail |head )?lights|seats|spoiler)\b/g,
      )) {
        let cursor = component.index;
        const segment = segmentFor(cursor);
        const removed: Evidence[] = [];
        while (true) {
          const candidates = found.filter(
            (e) =>
              e.segment === segment &&
              e.end <= cursor &&
              /^\s*$/.test(text.slice(e.end, cursor)) &&
              ['make', 'model', 'badge'].includes(e.entry.field),
          );
          if (!candidates.length) break;
          const start = Math.min(...candidates.map((e) => e.start));
          removed.push(...candidates);
          cursor = start;
        }
        if (removed.length) {
          discardedContext.push(...removed);
          found = found.filter((e) => !removed.includes(e));
        }
      }
      if (discardedContext.length)
        notes.push(
          'A designation immediately modifying a component is accessory provenance, not a vehicle attribute.',
        );
    }
    // An explicit ownership contrast is a reference link, not a general
    // last-attribute-wins rule. Only adjacent clauses with the same possessive
    // and one unambiguous antecedent may share their vehicle designation.
    // The other owner's transmission/fuel/drive are never inherited.
    const discardedOwnership: Evidence[] = discardedContext;
    {
      const sources = parts
        .map((part, index) => ({
          index,
          owner: part.role === 'neutral' ? UNOWNED.exec(part.text)?.[1] : undefined,
        }))
        .filter((s) => s.owner);
      const references = parts
        .map((part, index) => ({
          index,
          owner: part.role === 'neutral' ? OWNED_REFERENCE.exec(part.text)?.[1] : undefined,
        }))
        .filter((s) => s.owner);
      const retainedSources = new Set<number>();
      for (const reference of references) {
        const adjacent = sources.filter(
          (source) =>
            source.owner === reference.owner && Math.abs(source.index - reference.index) === 1,
        );
        if (adjacent.length !== 1) continue;
        const source = required(adjacent[0]),
          target = found.filter((e) => e.segment === reference.index);
        const antecedent = found.filter((e) => e.segment === source.index);
        if (
          target.some((e) => !e.negative && (e.entry.field === 'make' || e.entry.field === 'model'))
        ) {
          // A fully stated new vehicle does not inherit any old designation.
          required(parts[reference.index]).role = 'target';
          continue;
        }
        const clearIdentity =
          antecedent.some((e) => !e.negative && e.entry.field === 'model') &&
          (['make', 'model'] as Field[]).every(
            (field) =>
              new Set(
                antecedent
                  .filter((e) => !e.negative && e.entry.field === field)
                  .map((e) => e.entry.value),
              ).size <= 1,
          );
        const clearReference =
          target.some((e) => !e.negative) &&
          stream
            .filter((t) => segmentFor(t.start) === reference.index)
            .every(
              (t) =>
                target.some((e) => t.start >= e.start && t.end <= e.end) ||
                GRAMMAR.has(t.word) ||
                ['mine', 'ours', 'one', 'ones', 'but', 'however', 'whereas'].includes(t.word),
            );
        if (!clearIdentity || !clearReference) continue;
        const retained = antecedent.filter(
          (e) =>
            (e.entry.field === 'make' || e.entry.field === 'model' || e.entry.field === 'badge') &&
            !target.some((t) => t.entry.field === e.entry.field && !t.negative),
        );
        discardedOwnership.push(...antecedent.filter((e) => !retained.includes(e)));
        found = found.filter((e) => e.segment !== source.index || retained.includes(e));
        retainedSources.add(source.index);
        required(parts[source.index]).role = 'target';
        required(parts[reference.index]).role = 'target';
        notes.push(
          'Resolved an adjacent explicit ownership contrast; only the shared vehicle designation is inherited.',
        );
      }
      for (const source of sources)
        if (!retainedSources.has(source.index)) required(parts[source.index]).role = 'rejected';
      found = found.filter((e) => !EXCLUDED.has(required(parts[e.segment]).role));
    }
    const positiveIdentity = found.filter(
      (e) => !e.negative && (e.entry.field === 'make' || e.entry.field === 'model'),
    );
    if (!positiveIdentity.length)
      return empty(2, 'No supported target identity; this does not establish confident absence.');
    const priority = (role: Role) => (role === 'correction' ? 3 : role === 'target' ? 2 : 1);
    const winningPriority = Math.max(
      ...positiveIdentity.map((e) => priority(required(parts[e.segment]).role)),
    );
    const targetSegments = new Set(
      positiveIdentity
        .filter((e) => priority(required(parts[e.segment]).role) === winningPriority)
        .map((e) => e.segment),
    );
    {
      const selectedModels = positiveIdentity.filter(
        (e) => e.entry.field === 'model' && targetSegments.has(e.segment),
      );
      const carry = new Set<number>();
      for (const e of positiveIdentity.filter(
        (e) => e.entry.field === 'model' && !targetSegments.has(e.segment),
      )) {
        // Carry an earlier trim only from an unambiguous repeated model mention.
        if (
          winningPriority < 3 &&
          selectedModels.length &&
          selectedModels.every((s) => s.entry.value === e.entry.value) &&
          !positiveIdentity.some(
            (p) =>
              p.segment === e.segment &&
              p.entry.field === 'make' &&
              positiveIdentity.some(
                (s) =>
                  targetSegments.has(s.segment) &&
                  s.entry.field === 'make' &&
                  s.entry.value !== p.entry.value,
              ),
          ) &&
          positiveIdentity
            .filter((p) => p.segment === e.segment && p.entry.field === 'model')
            .every((p) => p.entry.value === e.entry.value)
        )
          carry.add(e.segment);
      }
      // Explicit target fields supersede earlier attributes; never mix two trims.
      found = found.filter(
        (e) =>
          !carry.has(e.segment) ||
          (e.entry.field === 'badge' &&
            /^(?:\d+(?:tsi|tdi)|(?:tdi|tsi)\d+)$/.test(e.entry.value)) ||
          !found.some(
            (p) => targetSegments.has(p.segment) && p.entry.field === e.entry.field && !p.negative,
          ),
      );
      for (const segment of carry) targetSegments.add(segment);
    }
    // A correction containing a new identity supersedes the old vehicle as a
    // whole. Attribute-only corrections remain attached to the selected target.
    found = found.filter(
      (e) =>
        targetSegments.has(e.segment) ||
        !found.some(
          (other) =>
            other.segment === e.segment &&
            !other.negative &&
            (other.entry.field === 'model' || other.entry.field === 'make'),
        ),
    );
    for (const field of FIELDS) {
      if (
        found.some(
          (e) =>
            e.entry.field === field &&
            required(parts[e.segment]).role === 'correction' &&
            !e.negative,
        )
      )
        found = found.filter(
          (e) => e.entry.field !== field || required(parts[e.segment]).role === 'correction',
        );
    }
    const retainedEvidence = found;
    const unique = new Map<string, Evidence>();
    for (const e of found) {
      const key = `${e.entry.field}:${e.entry.value}:${e.negative}`;
      if ((unique.get(key)?.quality ?? 0) < e.quality) unique.set(key, e);
    }
    found = [...unique.values()];
    const positive = found.filter((e) => !e.negative),
      negative = found.filter((e) => e.negative);
    {
      const anchors = positive.filter((e) => ['make', 'model'].includes(e.entry.field));
      if (anchors.length) {
        const seed = anchors.reduce((a, b) => (a.entry.ids.size < b.entry.ids.size ? a : b));
        scopedIdentityIds = [...seed.entry.ids].filter((id) =>
          anchors.every((e) => e.entry.ids.has(id)),
        );
      }
      notes.push(
        `Stage trace: ${scopedIdentityIds.length} identity candidates before constraints; ${positive.length} target-positive and ${negative.length} target-negative observations; ${discardedContext.length} scoped observations excluded.`,
      );
    }
    // Reject contradictory assertions rather than fabricate an interpretation.
    for (const field of [
      'make',
      'model',
      'transmission_type',
      'fuel_type',
      'drive_type',
    ] as Field[]) {
      let assertions = positive.filter((e) => e.entry.field === field).map((e) => e.entry.value);
      // Generic hybrid is a compatible superclass of a verified hybrid fuel
      // family, while petrol versus hybrid-petrol remains a contradiction.
      if (field === 'fuel_type' && assertions.some((value) => value.split(' ').includes('hybrid')))
        assertions = assertions.filter((value) => value !== '@hybrid');
      if (
        field === 'drive_type' &&
        assertions.some((value) => ['front wheel drive', 'rear wheel drive'].includes(value))
      )
        assertions = assertions.filter((value) => value !== '@2wd');
      if (new Set(assertions).size > 1)
        return empty(1, `Unresolved competing ${field} assertions.`, undefined, 'contradiction');
    }
    const activeTokens = stream.filter((token) => {
      if (
        relationSpans.some(
          (span) =>
            span.role === 'other-entity' && token.start >= span.start && token.end <= span.end,
        )
      )
        return false;
      const segment = segmentFor(token.start);
      return (
        segment >= 0 &&
        !EXCLUDED.has(required(parts[segment]).role) &&
        (targetSegments.has(segment) || !positiveIdentity.some((e) => e.segment === segment))
      );
    });
    const metadata: Record<string, { make: string; model: string }> = {
      ...MODEL_METADATA,
      ...RELATION_MODEL_METADATA,
      ...{ '5n': { make: 'volkswagen', model: 'tiguan' } },
      gsu70r: { make: 'toyota', model: 'kluger' },
    };
    const years = (word: string) =>
      (/^(?:18|19|20)\d{2}$/.test(word) || /^my(?:\d{2}|(?:19|20)\d{2})$/.test(word)) &&
      !this.identityWords.has(word);
    const consumed = (token: Token) =>
      retainedEvidence.some((e) => token.start >= e.start && token.end <= e.end) ||
      discardedOwnership.some((e) => token.start >= e.start && token.end <= e.end);
    const titleDescriptors = titleDescriptorSpans(text);
    const titleDescriptor = (token: Token) =>
      titleDescriptors.some((span) => token.start >= span.start && token.end <= span.end);
    const modificationSpans = modificationModifierSpans(text);
    const spare = activeTokens.filter(
      (token) =>
        !scopedPackageItems.some((item) => token.start >= item.start && token.end <= item.end) &&
        !titleDescriptor(token) &&
        !(
          modificationSpans.some((span) => token.start >= span.start && token.end <= span.end) &&
          !this.candidateIndex!.isDesignation(token.word) &&
          !this.candidateIndex!.isDesignationFamily(token.word)
        ) &&
        !consumed(token) &&
        !years(token.word) &&
        !GRAMMAR.has(token.word) &&
        !PROSE.has(token.word) &&
        !(token.word === 'only') &&
        !/^(?:v[468]|i[346])$/.test(token.word) &&
        !COLOURS.has(token.word),
    );
    for (const badge of retainedEvidence.filter((e) => !e.negative && e.entry.field === 'badge')) {
      if (
        !positive.some(
          (e) =>
            e.entry.field === 'model' && [...badge.entry.ids].some((id) => e.entry.ids.has(id)),
        )
      )
        continue;
      const suffix = closedGradeExtension(text, badge.end);
      const suffixTokens = suffix
        ? activeTokens.filter((t) => t.start >= suffix.start && t.end <= suffix.end)
        : [];
      if (
        suffix &&
        suffixTokens.length > 0 &&
        suffixTokens.every(
          (t) =>
            spare.includes(t) &&
            !nominalLexicalEvidence.some((e) => t.start >= e.start && t.end <= e.end),
        ) &&
        !scopedPackageItems.some((item) => suffix.start >= item.start && suffix.end <= item.end) &&
        !discardedContext.some((e) => suffix.start >= e.start && suffix.end <= e.end)
      )
        return empty(
          2,
          'Unsupported named extension attached to a recognized vehicle grade.',
          undefined,
          'unsupported',
        );
    }
    for (const model of positive.filter((e) => e.entry.field === 'model')) {
      // A separator does not establish a complete title when its only grade
      // could be the following unknown bare nominal (e.g. model — variant).
      if (positive.some((e) => e.entry.field === 'badge' && e.segment === model.segment)) continue;
      const continuation = parts[model.segment + 1];
      if (!continuation || EXCLUDED.has(continuation.role)) continue;
      const words = activeTokens.filter(
        (t) => t.start >= continuation.start && t.end <= continuation.end,
      );
      if (
        words.length === 1 &&
        spare.includes(required(words[0])) &&
        /^[a-z]{2,20}$/.test(required(words[0]).word)
      )
        return empty(
          2,
          'An incomplete title continues with an unsupported bare designation after a structural separator.',
          undefined,
          'unsupported',
        );
    }
    for (const e of positive.filter((e) => e.entry.field === 'make' || e.entry.field === 'model')) {
      const unresolvedTitle = !retainedEvidence.some(
        (p) => p.entry.field === 'badge' && !p.negative && p.end <= e.start,
      );
      const next = activeTokens.find(
        (token) =>
          token.start >= e.end &&
          !(
            unresolvedTitle &&
            retainedEvidence.some(
              (p) => p.entry.field !== 'badge' && token.start >= p.start && token.end <= p.end,
            )
          ) &&
          !titleDescriptor(token) &&
          !years(token.word) &&
          !(
            /^(?:v[468]|i[346])$/.test(token.word) &&
            !retainedEvidence.some((p) => p.start === token.start)
          ) &&
          segmentFor(token.start) === e.segment,
      );
      if (next && spare.includes(next)) {
        if (e.entry.field === 'make' && !positive.some((other) => other.entry.field === 'model'))
          return empty(
            4,
            'Explicit unrecognized model phrase; a familiar badge cannot replace it.',
            undefined,
            'unsupported',
          );
        if (
          e.entry.field === 'model' &&
          true &&
          /[a-z]/.test(next.word) &&
          /\d/.test(next.word) &&
          !!metadata[next.word] &&
          required(metadata[next.word]).model === e.entry.value &&
          !positive.some(
            (p) => p.entry.field === 'make' && p.entry.value !== required(metadata[next.word]).make,
          ) &&
          positive.some(
            (b) => b.entry.field === 'badge' && [...b.entry.ids].some((id) => e.entry.ids.has(id)),
          )
        )
          continue;
        if (e.entry.field === 'model' && /^[a-z0-9]{2,40}$/.test(next.word))
          return empty(2, 'Unrecognized designation immediately after the model requires review.');
      }
    }
    {
      // Coordinated unnamed title extensions cannot silently collapse to a
      // supported base. Explicit equipment lists were already scoped above.
      for (const marker of text.matchAll(/\b(?:pack|package|edition)\s*(?:[+&]|and)\s*/g)) {
        const start = marker.index + marker[0].length,
          segment = segmentFor(marker.index);
        if (scopedPackageItems.some((item) => start >= item.start && start < item.end)) continue;
        if (!positive.some((e) => e.entry.field === 'model' && e.segment === segment)) continue;
        const tail = activeTokens.filter(
          (t) => t.start >= start && segmentFor(t.start) === segment,
        );
        const extension = [];
        for (const t of tail) {
          if (consumed(t) || GRAMMAR.has(t.word) || PROSE.has(t.word)) break;
          extension.push(t);
        }
        if (extension.some((t) => spare.includes(t) && /^[a-z]{2,20}$/.test(t.word)))
          return empty(
            2,
            'Unsupported named extension coordinated with a vehicle designation.',
            undefined,
            'unsupported',
          );
      }
    }
    {
      // Catalogue engine-code families define a designation run. Known badge
      // words may be reordered; an unknown grade cannot vanish after them.
      // Scalar fields, prose boundaries and unmodelled body types end the run.
      const bodies = new Set(
        'hatch hatchback wagon ute utility coupe suv sedan convertible cabriolet van pickup'.split(
          ' ',
        ),
      );
      const badgeTokenStarts = new Set(
        activeTokens
          .filter((t) =>
            evidence.some((e) => e.entry.field === 'badge' && e.start <= t.start && e.end >= t.end),
          )
          .map((t) => t.start),
      );
      const scannedThrough = new Map<number, number>();
      for (const code of retainedEvidence
        .filter(
          (e) =>
            !e.negative &&
            e.entry.field === 'badge' &&
            this.candidateIndex!.isDesignation(e.entry.value),
        )
        .sort((a, b) => a.start - b.start)) {
        if ((scannedThrough.get(code.segment) ?? -1) >= code.end) continue;
        let cursor = code.end;
        for (const token of activeTokens.filter(
          (t) => t.start >= code.end && segmentFor(t.start) === code.segment,
        )) {
          if (!/^\s+$/.test(text.slice(cursor, token.start))) break;
          cursor = token.end;
          if (years(token.word) || COLOURS.has(token.word)) continue;
          if (badgeTokenStarts.has(token.start)) continue;
          if (
            consumed(token) ||
            GRAMMAR.has(token.word) ||
            PROSE.has(token.word) ||
            bodies.has(token.word)
          )
            break;
          if (spare.includes(token) && /^[a-z]{2,20}$/.test(token.word))
            return empty(
              2,
              'Unsupported term in a catalogue-derived engine/grade designation run.',
              undefined,
              'unsupported',
            );
          break;
        }
        scannedThrough.set(code.segment, cursor);
      }
    }
    {
      for (const column of text.matchAll(/[^|;]+/g)) {
        const start = column.index,
          end = start + column[0].length;
        const scalar = positive
          .filter(
            (e) =>
              e.start >= start &&
              e.end <= end &&
              ['transmission_type', 'fuel_type', 'drive_type'].includes(e.entry.field),
          )
          .sort((a, b) => a.start - b.start)[0];
        if (!scalar) continue;
        const before = activeTokens.filter((t) => t.start >= start && t.end <= scalar.start);
        const unknown = before.filter((t) => spare.includes(t) && /^[a-z]{2,20}$/.test(t.word));
        const nearestBadge = retainedEvidence
          .filter((e) => !e.negative && e.entry.field === 'badge' && e.end <= start)
          .at(-1);
        const adjacentBadge = nearestBadge && /^[\s|;]*$/.test(text.slice(nearestBadge.end, start));
        if (
          before.length <= 3 &&
          unknown.length === 1 &&
          adjacentBadge &&
          !before.some((t) => /^[vi][3-9]$/.test(t.word))
        )
          return empty(
            2,
            'An unsupported designation occupies a delimited vehicle-title slot.',
            undefined,
            'unsupported',
          );
      }
    }
    {
      const identities = positive.filter(
        (e) => e.entry.field === 'make' || e.entry.field === 'model',
      );
      for (const model of positive.filter((e) => e.entry.field === 'model')) {
        const next = activeTokens.find(
          (t) => t.start >= model.end && segmentFor(t.start) === model.segment && !years(t.word),
        );
        if (
          next &&
          positive.some(
            (e) =>
              e.entry.field === 'badge' &&
              e.start === next.start &&
              ![...e.entry.ids].some((id) => identities.every((p) => p.entry.ids.has(id))),
          )
        )
          return empty(
            2,
            'Explicit badge is unsupported for the stated model.',
            undefined,
            'unsupported',
          );
      }
      if (spare.some((t) => this.candidateIndex!.isDesignation(t.word)))
        return empty(
          6,
          'Explicit code from a catalogue designation family is unsupported.',
          undefined,
          'unsupported',
        );
    }
    for (const compound of text.matchAll(/\b([a-z]{2,4})-([a-z])\b/g)) {
      const start = compound.index,
        end = start + compound[0].length;
      if (
        positive.some(
          (e) =>
            e.entry.field === 'badge' &&
            e.start === start &&
            e.end === start + required(compound[1]).length,
        ) &&
        activeTokens.some((t) => t.start >= start && t.end <= end && spare.includes(t))
      )
        return empty(
          2,
          'Unsupported hyphenated badge suffix requires review.',
          undefined,
          'unsupported',
        );
    }
    if (spare.some((token) => /^(?:\d+(?:tsi|tdi)|(?:tdi|tsi)\d+)$/.test(token.word)))
      return empty(6, 'Explicit unsupported engine designation.', undefined, 'unsupported');
    const identity = positive.filter((e) => e.entry.field === 'make' || e.entry.field === 'model');
    if (!identity.length) return empty(1, 'Target selection removed all usable identity evidence.');
    // A complete canonical badge in the identified model is stronger evidence
    // than a longer badge sharing its prefix. Incomplete fragments with no
    // exact badge retain their compatible ties. Check before scalar fields so
    // an absent exact trim/gearbox combination cannot become a longer edition.
    const badgeSignature = [
      ...new Set(positive.filter((e) => e.entry.field === 'badge').map((e) => e.entry.value)),
    ]
      .sort()
      .join(' ');
    const exactBadgeIds = this.completeBadges.get(badgeSignature);
    const completeBadge =
      namedGradeIds ??
      (exactBadgeIds && [...exactBadgeIds].some((id) => identity.every((e) => e.entry.ids.has(id)))
        ? exactBadgeIds
        : undefined);

    // Hold references to prebuilt postings; never copy a large attribute posting
    // only to intersect it with a one-row model posting.
    let retrievedCandidateIds: string[];

    let winners: string[];
    const comparableNegative = negative.filter(
      (e) =>
        !(e.entry.field === 'make' || e.entry.field === 'model') ||
        !positive.some((p) => p.entry.field === e.entry.field && p.entry.value === e.entry.value),
    );
    {
      const comparison = this.candidateIndex!.compare(
        positive,
        comparableNegative,
        completeBadge,
        true,
      );
      retrievedCandidateIds = comparison.retrievedCandidateIds;
      winners = comparison.candidateIds;
      this.stats.candidateVisits += retrievedCandidateIds.length;
      notes.push(
        `Compared ${retrievedCandidateIds.length} model-compatible records; all retained designation assertions and explicit contradictions are enforced. Only provenance-verified incidental evidence is excluded.`,
      );
    }
    const complexity = parts.some((part) => part.role !== 'neutral') || negative.length > 0;
    if (complexity)
      notes.push(
        'Field evidence is scoped to target/correction spans; unrelated or rejected spans are excluded.',
      );
    if (spare.length) notes.push('Unconsumed prose remains outside the supported grammar.');
    if (completeBadge)
      notes.push(
        'Complete canonical badge preferred over longer badges sharing its words; incomplete badge fragments retain ties.',
      );
    if (!winners.length)
      return empty(
        spare.length || complexity ? 2 : 7,
        'No candidate satisfies the supported identity and explicit field constraints.',
        retrievedCandidateIds,
      );
    const coverage = new Set(positive.map((e) => e.entry.field)).size;
    let confidence = Math.min(9, 3 + coverage);
    if (winners.length > 1)
      confidence = Math.min(confidence, Math.max(2, 6 - Math.floor(Math.log2(winners.length))));
    const fuzzy = positive.some((e) => e.quality < 1);
    const modelCode = positive.some(
      (e) =>
        e.entry.field === 'fuel_type' &&
        e.entry.phrase.length === 1 &&
        MODEL_CODES[required(e.entry.phrase[0])],
    );
    if (modelCode) {
      confidence = Math.min(confidence, 6);
      notes.push(
        'Used a verified model code only with its compatible model; its fuel family is a constraint, not an inferred trim.',
      );
    }
    const shorthand = positive.some((e) => e.entry.value.startsWith('@number:'));
    if (shorthand) {
      confidence = Math.min(confidence, 6);
      notes.push(
        'Used a catalogue-supported numeric engine-code shorthand with its adjoining trim; ambiguous expansions remain tied.',
      );
    }
    if (fuzzy || complexity) confidence = Math.min(confidence, 6);
    const uncertain =
      spare.length > 0 || /\b(?:maybe|perhaps|either|not sure|do not know)\b/.test(text);
    if (uncertain) confidence = Math.min(confidence, 3);
    notes.push(
      `Examined ${retrievedCandidateIds.length} candidate(s); ${winners.length} share the highest compatible evidence score across ${coverage} field(s).`,
    );
    if (fuzzy)
      notes.push(
        'Used bounded, catalogue-supported spelling evidence; no numeric model or short-code correction.',
      );
    return {
      candidateIds: winners,
      retrievedCandidateIds,
      confidence,
      notes,
      needsSemanticReview:
        uncertain || fuzzy || complexity || shorthand || modelCode || discardedContext.length > 0,
    };
  }
}
