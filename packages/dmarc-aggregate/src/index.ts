export { Batch, type DocumentInput, type ReportSummary } from './batch.ts';
export {
  type Cause,
  type Classification,
  classify,
  type Facts,
  inconsistent,
  type Path,
  type PathRule,
  recordFacts,
} from './classify.ts';
export {
  compareFilename,
  type FilenamePart,
  type ParsedFilename,
  parseFilename,
} from './filename.ts';
export { type Finding, type FindingId, Findings } from './findings.ts';
export {
  type ContentHint,
  type DkimAuth,
  type ExtensionCount,
  type Format,
  type FormatFinding,
  type Policy,
  type ReadRecord,
  type ReadReport,
  type Reason,
  readReport,
  type SpfAuth,
} from './format/read.ts';
export {
  type Budget,
  INPUT_LIMITS,
  type InputEvent,
  type InputFinding,
  type InputKind,
  type InputLimits,
  newBudget,
  readInput,
} from './input.ts';
export {
  type XmlDocument,
  type XmlElement,
  type XmlFinding,
  type XmlOutput,
  XmlReader,
} from './xml/reader.ts';
