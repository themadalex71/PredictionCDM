import type { MppBacktestInput } from './mppBacktest';

export const MPP_WORLD_CUP_STORAGE_KEY = 'mpp-worldcup-backtest-records-v2';
export const LEGACY_MPP_WORLD_CUP_STORAGE_KEY = 'mpp-worldcup-backtest-records-v1';

export type WorldCupFixtureLike = {
  id?: string | number;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral?: boolean;
  homeScore?: number;
  awayScore?: number;
  time?: string;
  kickoffTime?: string;
};

export type EditableMppRecord = {
  matchKey: string;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;

  homeMppPoints: string;
  drawMppPoints: string;
  awayMppPoints: string;

  actualHomeScore: string;
  actualAwayScore: string;
};

export type MppRecordsByKey = Record<string, EditableMppRecord>;

export function parseMppNumber(value: string): number {
  const normalized = value.replace(',', '.').trim();

  if (normalized === '') {
    return NaN;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : NaN;
}

export function getWorldCupFixtureKey(fixture: WorldCupFixtureLike): string {
  return String(
    fixture.id ?? `${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`
  );
}

export function getWorldCupFixtureTime(fixture: WorldCupFixtureLike): string {
  return fixture.time ?? fixture.kickoffTime ?? '';
}

export function formatWorldCupFixtureLabel(fixture: WorldCupFixtureLike): string {
  const time = getWorldCupFixtureTime(fixture);

  return `${fixture.date}${time ? ` ${time}` : ''} · Groupe ${
    fixture.group ?? '-'
  } · ${fixture.homeTeam} - ${fixture.awayTeam}`;
}

export function buildMppRecordFromFixture(
  fixture: WorldCupFixtureLike
): EditableMppRecord {
  return {
    matchKey: getWorldCupFixtureKey(fixture),
    date: fixture.date,
    group: fixture.group,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    neutral: fixture.neutral ?? true,

    homeMppPoints: '',
    drawMppPoints: '',
    awayMppPoints: '',

    actualHomeScore: Number.isFinite(fixture.homeScore)
      ? String(fixture.homeScore)
      : '',

    actualAwayScore: Number.isFinite(fixture.awayScore)
      ? String(fixture.awayScore)
      : '',
  };
}

function sanitizeRecord(record: EditableMppRecord): EditableMppRecord {
  return {
    matchKey: String(record.matchKey),
    date: String(record.date ?? ''),
    group: record.group ? String(record.group) : undefined,
    homeTeam: String(record.homeTeam ?? ''),
    awayTeam: String(record.awayTeam ?? ''),
    neutral: record.neutral ?? true,
    homeMppPoints: String(record.homeMppPoints ?? ''),
    drawMppPoints: String(record.drawMppPoints ?? ''),
    awayMppPoints: String(record.awayMppPoints ?? ''),
    actualHomeScore: String(record.actualHomeScore ?? ''),
    actualAwayScore: String(record.actualAwayScore ?? ''),
  };
}

function parseStoredRecords(raw: string | null): MppRecordsByKey {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const records: MppRecordsByKey = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;

      const record = sanitizeRecord(value as EditableMppRecord);
      records[String(key)] = record;
    }

    return records;
  } catch {
    return {};
  }
}

export function loadMppWorldCupRecords(): MppRecordsByKey {
  const current = parseStoredRecords(
    localStorage.getItem(MPP_WORLD_CUP_STORAGE_KEY)
  );

  if (Object.keys(current).length > 0) {
    return current;
  }

  const legacy = parseStoredRecords(
    localStorage.getItem(LEGACY_MPP_WORLD_CUP_STORAGE_KEY)
  );

  if (Object.keys(legacy).length > 0) {
    saveMppWorldCupRecords(legacy);
  }

  return legacy;
}

export function saveMppWorldCupRecords(records: MppRecordsByKey) {
  localStorage.setItem(MPP_WORLD_CUP_STORAGE_KEY, JSON.stringify(records));
  localStorage.setItem(LEGACY_MPP_WORLD_CUP_STORAGE_KEY, JSON.stringify(records));
}

export function getMppRecordForFixture(
  records: MppRecordsByKey,
  fixture: WorldCupFixtureLike
): EditableMppRecord | undefined {
  const direct = records[getWorldCupFixtureKey(fixture)];

  if (direct) {
    return direct;
  }

  return Object.values(records).find(
    (record) =>
      record.date === fixture.date &&
      record.homeTeam === fixture.homeTeam &&
      record.awayTeam === fixture.awayTeam
  );
}

export function mergeMppRecordWithFixture(
  record: EditableMppRecord | undefined,
  fixture: WorldCupFixtureLike
): EditableMppRecord {
  const base = buildMppRecordFromFixture(fixture);

  if (!record) {
    return base;
  }

  return {
    ...base,
    ...record,
    matchKey: base.matchKey,
    date: base.date,
    group: base.group,
    homeTeam: base.homeTeam,
    awayTeam: base.awayTeam,
    neutral: base.neutral,
  };
}

export function upsertMppRecordForFixture(
  records: MppRecordsByKey,
  fixture: WorldCupFixtureLike,
  patch: Partial<EditableMppRecord>
): MppRecordsByKey {
  const key = getWorldCupFixtureKey(fixture);
  const current = mergeMppRecordWithFixture(records[key], fixture);

  return {
    ...records,
    [key]: {
      ...current,
      ...patch,
      matchKey: key,
      date: fixture.date,
      group: fixture.group,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      neutral: fixture.neutral ?? true,
    },
  };
}

export function hasMppPoints(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    Number.isFinite(parseMppNumber(record.homeMppPoints)) &&
    Number.isFinite(parseMppNumber(record.drawMppPoints)) &&
    Number.isFinite(parseMppNumber(record.awayMppPoints))
  );
}

export function hasActualScore(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    record.actualHomeScore.trim() !== '' &&
    record.actualAwayScore.trim() !== '' &&
    Number.isFinite(parseMppNumber(record.actualHomeScore)) &&
    Number.isFinite(parseMppNumber(record.actualAwayScore))
  );
}

export function isMppRecordStarted(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    record.homeMppPoints.trim() !== '' ||
    record.drawMppPoints.trim() !== '' ||
    record.awayMppPoints.trim() !== '' ||
    record.actualHomeScore.trim() !== '' ||
    record.actualAwayScore.trim() !== ''
  );
}

export function isMppRecordComplete(record: EditableMppRecord): boolean {
  return hasMppPoints(record) && hasActualScore(record);
}

export function isMppRecordReadyForPrediction(
  record: EditableMppRecord | undefined
): boolean {
  return hasMppPoints(record);
}

export function convertMppRecordToBacktestInput(
  record: EditableMppRecord
): MppBacktestInput {
  return {
    matchKey: record.matchKey,
    date: record.date,
    group: record.group,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    neutral: record.neutral,

    homeMppPoints: parseMppNumber(record.homeMppPoints),
    drawMppPoints: parseMppNumber(record.drawMppPoints),
    awayMppPoints: parseMppNumber(record.awayMppPoints),

    actualHomeScore: parseMppNumber(record.actualHomeScore),
    actualAwayScore: parseMppNumber(record.actualAwayScore),
  };
}

export function getMppOddsFromRecord(record: EditableMppRecord) {
  return {
    teamAWin: parseMppNumber(record.homeMppPoints),
    draw: parseMppNumber(record.drawMppPoints),
    teamBWin: parseMppNumber(record.awayMppPoints),
  };
}
