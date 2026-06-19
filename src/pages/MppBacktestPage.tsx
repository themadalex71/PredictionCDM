import { useEffect, useMemo, useState } from 'react';
import { worldCup2026Fixtures } from '../data/worldcup2026/fixtures';
import type { MatchResult, ModelSettings, PredictionContext } from '../types/football';
import type { MppBacktestInput, MppBacktestResult } from '../utils/mppBacktest';
import { runMppBacktest } from '../utils/mppBacktest';
import type { MppAnalysis, MppOdds, MppScoreAdvice } from '../types/mpp';
import { analyzeMppPrediction } from '../utils/mppScoring';
import { predictScoreDistribution } from '../utils/predictionModel';

type MppBacktestPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
  onSettingsChange?: (settings: ModelSettings) => void;
  records?: Record<string, EditableMppRecord>;
  onRecordsChange?: (records: Record<string, EditableMppRecord>) => void;
};

type FixtureLike = {
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

type EditableMppRecord = {
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

type MppModelCalibrationRow = {
  id: string;
  label: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
  settings: ModelSettings;
  summary: MppBacktestResult['summaries'][number] | null;
};

type RemainingProjectionRow = {
  matchKey: string;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  record: EditableMppRecord;
  odds: MppOdds;
  analysis: MppAnalysis;
  recommendedPick: MppScoreAdvice;
  safestPick: MppScoreAdvice;
  bestExpectedPick: MppScoreAdvice;
  upsidePick: MppScoreAdvice;
};

type RemainingProjectionResult = {
  rows: RemainingProjectionRow[];
  skippedWithoutOdds: number;
  alreadyWon: number;
  alreadyMatches: number;
  expectedTotal: number;
  expectedWithBestX2: number;
  potentialOutcomeOnlyTotal: number;
  potentialExactTotal: number;
  bestX2Row?: RemainingProjectionRow;
  safestX2Row?: RemainingProjectionRow;
};

const STORAGE_KEY = 'mpp-worldcup-backtest-records-v1';

const MPP_MODEL_CALIBRATION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
}> = [
  {
    id: 'current',
    label: 'Réglage actuel',
    description: 'Paramètres actuellement utilisés dans l’application.',
    settingsPatch: {},
  },
  {
    id: 'result_model_v1',
    label: 'Nouveau modèle résultat v1',
    description: 'Pondération compétition avancée + adversaire Elo + prudence données faibles + calibration scores classiques.',
    settingsPatch: {
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.2,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.18,
    },
  },
  {
    id: 'result_model_prudent',
    label: 'Modèle résultat prudent',
    description: 'Version plus prudente : davantage de shrink des données faibles et contrôle plus fort des favoris.',
    settingsPatch: {
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.55,
      dataConfidenceWeight: 1.35,
      scoreCalibration: 'worldcup_prudent',
      favoriteControlWeight: 0.28,
    },
  },
  {
    id: 'result_model_temp110',
    label: 'Temp 1.10 + modèle résultat v1',
    description: 'Nouveau moteur statistique avec distribution plus plate, à comparer au meilleur preset MPP actuel.',
    settingsPatch: {
      scoreTemperature: 1.1,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.2,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.18,
    },
  },
  {
    id: 'stable_no_draw',
    label: 'Stable sans boost nul',
    description: 'Témoin statistique : pas de boost supplémentaire des nuls.',
    settingsPatch: {
      smartDrawBoost: false,
      drawMultiplier: 1,
      lowScoreDrawBoost: 0,
      drawBoostCloseMatch: 0,
      drawBoostLowTotal: 0,
      drawBoostMax: 1.05,
      smartDrawMaxBoost: 1.05,
    },
  },
  {
    id: 'smart_draw_light',
    label: 'Smart Draw léger',
    description: 'Boost nul doux, uniquement quand le match paraît serré/fermé.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'smart_draw_medium',
    label: 'Smart Draw moyen',
    description: 'Réglage recommandé : corrige les nuls sans trop casser les victoires A/B.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
  {
    id: 'smart_draw_mpp',
    label: 'Temp 1.10 + Smart Draw MPP',
    description: 'Preset orienté MPP : distribution plus plate et boost intelligent des nuls.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: true,
      drawMultiplier: 1.1,
      lowScoreDrawBoost: 0.09,
      drawBoostCloseMatch: 0.065,
      drawBoostLowTotal: 0.045,
      drawBoostMax: 1.32,
      smartDrawMaxBoost: 1.32,
      smartDrawFavoritePenalty: 0.72,
    },
  },
  {
    id: 'smart_draw_mpp_prudent',
    label: 'Temp 1.10 + Smart Draw prudent',
    description: 'Même logique MPP, mais pénalise plus fortement les nuls si un favori clair existe.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.24,
      smartDrawMaxBoost: 1.24,
      smartDrawFavoritePenalty: 0.95,
    },
  },
  {
    id: 'draw_medium_legacy',
    label: 'Temp 1.10 + nuls moyen classique',
    description: 'Ancien réglage qui avait marqué beaucoup de points MPP, conservé pour comparaison.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: false,
      drawMultiplier: 1.12,
      lowScoreDrawBoost: 0.1,
      drawBoostCloseMatch: 0.06,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.75,
      smartDrawMaxBoost: 1.75,
    },
  },
  {
    id: 'elo65_smart_draw',
    label: 'Elo 65 % + Smart Draw moyen',
    description: 'Elo plus présent, avec correction intelligente des nuls.',
    settingsPatch: {
      externalEloImpact: 0.65,
      internalEloImpact: 0.65,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
  {
    id: 'v3_mpp_prudent',
    label: 'v3 MPP prudent',
    description: 'Elo dynamique + modèle 1/N/2 séparé + recalibrage score exact, orienté points MPP.',
    settingsPatch: {
      scoreModel: 'ensemble_v3',
      scoreTemperature: 1.08,
      enableDynamicElo: true,
      dynamicEloWeight: 0.5,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.58,
      drawModelWeight: 0.62,
      scoreOutcomeCalibrationWeight: 0.8,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.25,
      dataConfidenceWeight: 0.95,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.08,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v3_mpp_result',
    label: 'v3 MPP résultat fort',
    description: 'Version v3 qui donne plus de poids au modèle 1/N/2 séparé.',
    settingsPatch: {
      scoreModel: 'hybrid_dc_bivariate',
      scoreTemperature: 1.06,
      enableDynamicElo: true,
      dynamicEloWeight: 0.55,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.72,
      drawModelWeight: 0.55,
      scoreOutcomeCalibrationWeight: 0.9,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.25,
      dataConfidenceWeight: 0.95,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.08,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v3_mpp_draw',
    label: 'v3 MPP nuls contrôlés',
    description: 'Version v3 avec modèle nul plus présent mais recalibrage plafonné.',
    settingsPatch: {
      scoreModel: 'ensemble_v3',
      scoreTemperature: 1.1,
      enableDynamicElo: true,
      dynamicEloWeight: 0.5,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.55,
      drawModelWeight: 0.8,
      scoreOutcomeCalibrationWeight: 0.78,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.15,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.15,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },

  {
    id: 'v31_mpp_bivariate_smart',
    label: 'v3.1 MPP Bivariate + Smart Draw',
    description: 'Part de Bivariate stable, garde Temp 1.10 et ajoute Smart Draw MPP sans forcer le modèle 1/N/2.',
    settingsPatch: {
      scoreModel: 'bivariate_poisson',
      scoreTemperature: 1.1,
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 1,
      enableDynamicElo: false,
      separateOutcomeModel: false,
      outcomeModelWeight: 0,
      drawModelWeight: 0,
      scoreOutcomeCalibrationWeight: 0,
      smartDrawBoost: true,
      drawMultiplier: 1.1,
      lowScoreDrawBoost: 0.09,
      drawBoostCloseMatch: 0.065,
      drawBoostLowTotal: 0.045,
      drawBoostMax: 1.32,
      smartDrawMaxBoost: 1.32,
      smartDrawFavoritePenalty: 0.72,
    },
  },
  {
    id: 'v31_mpp_bivariate_draw_soft',
    label: 'v3.1 MPP Bivariate + nul doux',
    description: 'Même base Bivariate, mais avec modèle nul séparé très léger.',
    settingsPatch: {
      scoreModel: 'bivariate_poisson',
      scoreTemperature: 1.08,
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 1,
      enableDynamicElo: false,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.04,
      drawModelWeight: 0.18,
      scoreOutcomeCalibrationWeight: 0.18,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v31_mpp_result_smart_mix',
    label: 'v3.1 MPP Résultat Smart mix',
    description: 'Le meilleur preset résultat actuel avec une petite dose de modèle 1/N/2 séparé.',
    settingsPatch: {
      scoreModel: 'hybrid_dc_bivariate',
      scoreTemperature: 1.08,
      adaptiveDixonColes: true,
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 0.25,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.25,
      dataConfidenceWeight: 0.95,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.08,
      enableDynamicElo: true,
      dynamicEloWeight: 0.25,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.16,
      drawModelWeight: 0.18,
      scoreOutcomeCalibrationWeight: 0.22,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v31_mpp_draw_value_controlled',
    label: 'v3.1 MPP value nuls contrôlés',
    description: 'Cherche les nuls value MPP avec un recalibrage plafonné pour éviter la surcorrection.',
    settingsPatch: {
      scoreModel: 'hybrid_dc_bivariate',
      scoreTemperature: 1.1,
      adaptiveDixonColes: true,
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 0.25,
      enableDynamicElo: false,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.1,
      drawModelWeight: 0.36,
      scoreOutcomeCalibrationWeight: 0.3,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
];

function parseNumber(value: string): number {
  const normalized = value.replace(',', '.').trim();

  if (normalized === '') {
    return NaN;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function formatPoints(value: number): string {
  return `${value.toFixed(0)} pts`;
}

function formatDecimal(value: number): string {
  return value.toFixed(2);
}

function getFixtureKey(fixture: FixtureLike): string {
  return String(
    fixture.id ?? `${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`
  );
}

function getFixtureTime(fixture: FixtureLike): string {
  return fixture.time ?? fixture.kickoffTime ?? '';
}

function formatFixtureLabel(fixture: FixtureLike): string {
  const time = getFixtureTime(fixture);

  return `${fixture.date}${time ? ` ${time}` : ''} · Groupe ${
    fixture.group ?? '-'
  } · ${fixture.homeTeam} - ${fixture.awayTeam}`;
}

function buildRecordFromFixture(fixture: FixtureLike): EditableMppRecord {
  return {
    matchKey: getFixtureKey(fixture),
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

function loadStoredRecords(): Record<string, EditableMppRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function saveStoredRecords(records: Record<string, EditableMppRecord>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function hasCompleteMppPoints(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    Number.isFinite(parseNumber(record.homeMppPoints)) &&
    Number.isFinite(parseNumber(record.drawMppPoints)) &&
    Number.isFinite(parseNumber(record.awayMppPoints))
  );
}

function hasCompleteActualScore(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    record.actualHomeScore.trim() !== '' &&
    record.actualAwayScore.trim() !== '' &&
    Number.isFinite(parseNumber(record.actualHomeScore)) &&
    Number.isFinite(parseNumber(record.actualAwayScore))
  );
}

function isRecordStarted(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    record.homeMppPoints.trim() !== '' ||
    record.drawMppPoints.trim() !== '' ||
    record.awayMppPoints.trim() !== '' ||
    record.actualHomeScore.trim() !== '' ||
    record.actualAwayScore.trim() !== ''
  );
}

function isRecordComplete(record: EditableMppRecord): boolean {
  return hasCompleteMppPoints(record) && hasCompleteActualScore(record);
}

function getRecordStatus(
  record: EditableMppRecord | undefined
): 'empty' | 'started' | 'complete' {
  if (!record || !isRecordStarted(record)) {
    return 'empty';
  }

  if (isRecordComplete(record)) {
    return 'complete';
  }

  return 'started';
}

function getOptionPrefix(status: 'empty' | 'started' | 'complete'): string {
  if (status === 'complete') return '✅ ';
  if (status === 'started') return '🟠 ';

  return '';
}

function getOptionStyle(status: 'empty' | 'started' | 'complete') {
  if (status === 'complete') {
    return {
      backgroundColor: '#14532d',
      color: '#ffffff',
      fontWeight: 700,
    };
  }

  if (status === 'started') {
    return {
      backgroundColor: '#78350f',
      color: '#ffffff',
      fontWeight: 700,
    };
  }

  return undefined;
}

function convertRecordToInput(record: EditableMppRecord): MppBacktestInput {
  return {
    matchKey: record.matchKey,
    date: record.date,
    group: record.group,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    neutral: record.neutral,

    homeMppPoints: parseNumber(record.homeMppPoints),
    drawMppPoints: parseNumber(record.drawMppPoints),
    awayMppPoints: parseNumber(record.awayMppPoints),

    actualHomeScore: parseNumber(record.actualHomeScore),
    actualAwayScore: parseNumber(record.actualAwayScore),
  };
}

function getOutcomeHitLabel(value: boolean): string {
  return value ? 'OK' : 'Raté';
}

function getOutcomeHitClass(value: boolean): string {
  return value ? 'diagnostic-pill ok' : 'diagnostic-pill danger';
}

export function MppBacktestPage({
  matches,
  settings,
  onSettingsChange,
  records: sharedRecords,
  onRecordsChange,
}: MppBacktestPageProps) {
  const fixtures = worldCup2026Fixtures as FixtureLike[];

  const sortedFixtures = useMemo(() => {
    return [...fixtures].sort((a, b) => {
      const aValue = `${a.date}-${getFixtureTime(a)}-${a.homeTeam}`;
      const bValue = `${b.date}-${getFixtureTime(b)}-${b.homeTeam}`;

      return aValue.localeCompare(bValue);
    });
  }, [fixtures]);

  const [records, setRecordsState] = useState<Record<string, EditableMppRecord>>(
    sharedRecords ?? {}
  );
  const [selectedMatchKey, setSelectedMatchKey] = useState<string>(
    sortedFixtures[0] ? getFixtureKey(sortedFixtures[0]) : ''
  );

  const selectedFixture = useMemo(() => {
    return sortedFixtures.find(
      (fixture) => getFixtureKey(fixture) === selectedMatchKey
    );
  }, [sortedFixtures, selectedMatchKey]);

  const selectedRecord = useMemo(() => {
    if (!selectedFixture) {
      return null;
    }

    return records[selectedMatchKey] ?? buildRecordFromFixture(selectedFixture);
  }, [records, selectedFixture, selectedMatchKey]);

  const completedRecords = useMemo(() => {
    return Object.values(records)
      .filter(isRecordComplete)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [records]);

  const startedRecords = useMemo(() => {
    return Object.values(records).filter(isRecordStarted);
  }, [records]);

  const incompleteStartedRecords = useMemo(() => {
    return startedRecords.filter((record) => !isRecordComplete(record));
  }, [startedRecords]);

  const [backtestResult, setBacktestResult] =
    useState<MppBacktestResult | null>(null);

  const [modelCalibrationRows, setModelCalibrationRows] =
    useState<MppModelCalibrationRow[]>([]);
  const [remainingProjection, setRemainingProjection] =
    useState<RemainingProjectionResult | null>(null);

  useEffect(() => {
    if (sharedRecords) {
      setRecordsState(sharedRecords);
      return;
    }

    setRecordsState(loadStoredRecords());
  }, [sharedRecords]);

  function updateSelectedRecord<K extends keyof EditableMppRecord>(
    key: K,
    value: EditableMppRecord[K]
  ) {
    if (!selectedRecord) {
      return;
    }

    const nextRecord: EditableMppRecord = {
      ...selectedRecord,
      [key]: value,
    };

    handleSaveRecords({
      ...records,
      [nextRecord.matchKey]: nextRecord,
    });
  }

  function handleSaveRecords(nextRecords: Record<string, EditableMppRecord>) {
    setRecordsState(nextRecords);

    if (onRecordsChange) {
      onRecordsChange(nextRecords);
    } else {
      saveStoredRecords(nextRecords);
    }
  }

  function handleSaveSelectedRecord() {
    if (!selectedRecord) {
      return;
    }

    const nextRecords = {
      ...records,
      [selectedRecord.matchKey]: selectedRecord,
    };

    handleSaveRecords(nextRecords);
  }

  function handleDeleteSelectedRecord() {
    if (!selectedRecord) {
      return;
    }

    const nextRecords = { ...records };
    delete nextRecords[selectedRecord.matchKey];

    handleSaveRecords(nextRecords);
  }

  function handleUseFixtureScore() {
    if (!selectedFixture || !selectedRecord) {
      return;
    }

    const nextRecord: EditableMppRecord = {
      ...selectedRecord,
      actualHomeScore: Number.isFinite(selectedFixture.homeScore)
        ? String(selectedFixture.homeScore)
        : selectedRecord.actualHomeScore,
      actualAwayScore: Number.isFinite(selectedFixture.awayScore)
        ? String(selectedFixture.awayScore)
        : selectedRecord.actualAwayScore,
    };

    const nextRecords = {
      ...records,
      [nextRecord.matchKey]: nextRecord,
    };

    handleSaveRecords(nextRecords);
  }

  function handleRunBacktest() {
    const inputs = completedRecords.map(convertRecordToInput);
    const result = runMppBacktest(inputs, matches, settings);

    setBacktestResult(result);
  }

  function handleRunModelCalibration() {
    const inputs = completedRecords.map(convertRecordToInput);

    const rows = MPP_MODEL_CALIBRATION_PRESETS.map((preset) => {
      const calibratedSettings: ModelSettings = {
        ...settings,
        ...preset.settingsPatch,
      };

      const result = runMppBacktest(inputs, matches, calibratedSettings);
      const recommendedSummary =
        result.summaries.find((summary) => summary.strategyId === 'recommended') ??
        result.bestStrategy ??
        null;

      return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        settingsPatch: preset.settingsPatch,
        settings: calibratedSettings,
        summary: recommendedSummary,
      };
    }).sort((a, b) => (b.summary?.pointsWon ?? 0) - (a.summary?.pointsWon ?? 0));

    setModelCalibrationRows(rows);
  }

  function handleApplyMppCalibration(row: MppModelCalibrationRow) {
    if (!onSettingsChange) {
      return;
    }

    onSettingsChange(row.settings);
    alert(`Preset MPP appliqué : ${row.label}`);
  }

  function handleResetAll() {
    const confirmed = window.confirm(
      'Supprimer toutes les cotes/résultats MPP sauvegardés ?'
    );

    if (!confirmed) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setRecordsState({});
    onRecordsChange?.({});
    setBacktestResult(null);
    setRemainingProjection(null);
  }

  function handleExportJson() {
    const json = JSON.stringify(records, null, 2);
    navigator.clipboard.writeText(json);
    alert('Données copiées dans le presse-papiers.');
  }

  function handleImportJson() {
    const raw = window.prompt('Colle ici le JSON exporté précédemment :');

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        alert('JSON invalide.');
        return;
      }

      handleSaveRecords(parsed);
    } catch {
      alert('Impossible de lire ce JSON.');
    }
  }


  function recordHasFixtureScore(fixture: FixtureLike): boolean {
    return Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore);
  }

  function getProjectionOdds(record: EditableMppRecord): MppOdds {
    return {
      teamAWin: parseNumber(record.homeMppPoints),
      draw: parseNumber(record.drawMppPoints),
      teamBWin: parseNumber(record.awayMppPoints),
    };
  }

  function buildProjectionContext(record: EditableMppRecord): PredictionContext {
    return {
      neutral: record.neutral,
      teamAIsHome: true,
      tournament: 'FIFA World Cup',
      predictionDate: record.date,
    };
  }

  function isRecordReadyForProjection(record: EditableMppRecord): boolean {
    return hasCompleteMppPoints(record) && !hasCompleteActualScore(record);
  }

  function getBestSafeX2Row(rows: RemainingProjectionRow[]) {
    const safeRows = rows.filter(
      (row) => row.recommendedPick.outcomeProbability >= 0.42
    );

    return [...(safeRows.length > 0 ? safeRows : rows)].sort(
      (a, b) =>
        b.recommendedPick.expectedPoints - a.recommendedPick.expectedPoints
    )[0];
  }

  function handleProjectRemainingMatches() {
    const rows: RemainingProjectionRow[] = [];
    let skippedWithoutOdds = 0;

    for (const fixture of sortedFixtures) {
      const key = getFixtureKey(fixture);
      const record = records[key] ?? buildRecordFromFixture(fixture);

      if (isRecordComplete(record) || recordHasFixtureScore(fixture)) {
        continue;
      }

      if (!isRecordReadyForProjection(record)) {
        skippedWithoutOdds += 1;
        continue;
      }

      const projectionSettings: ModelSettings = {
        ...settings,
        maxGoals: Math.max(settings.maxGoals, 8),
      };

      const prediction = predictScoreDistribution(
        record.homeTeam,
        record.awayTeam,
        matches,
        projectionSettings,
        buildProjectionContext(record)
      );

      const odds = getProjectionOdds(record);
      const analysis = analyzeMppPrediction(prediction, odds);

      rows.push({
        matchKey: record.matchKey,
        date: record.date,
        group: record.group,
        homeTeam: record.homeTeam,
        awayTeam: record.awayTeam,
        record,
        odds,
        analysis,
        recommendedPick: analysis.recommendedPick,
        safestPick: analysis.safestPick,
        bestExpectedPick: analysis.bestExpectedPick,
        upsidePick: analysis.upsidePick,
      });
    }

    const completedInputs = completedRecords.map(convertRecordToInput);
    const completedBacktest =
      completedInputs.length > 0
        ? runMppBacktest(completedInputs, matches, settings)
        : null;

    const recommendedSummary = completedBacktest?.summaries.find(
      (summary) => summary.strategyId === 'recommended'
    );

    const alreadyWon = recommendedSummary?.pointsWon ?? 0;
    const expectedTotal = rows.reduce(
      (sum, row) => sum + row.recommendedPick.expectedPoints,
      0
    );
    const potentialOutcomeOnlyTotal = rows.reduce(
      (sum, row) => sum + row.recommendedPick.outcomePoints,
      0
    );
    const potentialExactTotal = rows.reduce(
      (sum, row) => sum + row.recommendedPick.exactScoreTotalPoints,
      0
    );
    const bestX2Row = [...rows].sort(
      (a, b) =>
        b.recommendedPick.expectedPoints - a.recommendedPick.expectedPoints
    )[0];
    const safestX2Row = getBestSafeX2Row(rows);

    setRemainingProjection({
      rows,
      skippedWithoutOdds,
      alreadyWon,
      alreadyMatches: completedInputs.length,
      expectedTotal,
      expectedWithBestX2:
        expectedTotal + (bestX2Row?.recommendedPick.expectedPoints ?? 0),
      potentialOutcomeOnlyTotal,
      potentialExactTotal,
      bestX2Row,
      safestX2Row,
    });
  }

  return (
    <div className="page-stack">
      <section className="card hero">
        <p className="eyebrow">Backtest MPP Coupe du Monde</p>
        <h1>Tester les stratégies MPP sur les matchs déjà joués</h1>

        <p>
          Cette page sert à vérifier objectivement quelle stratégie aurait
          marqué le plus de points. Tu rentres les points MPP du 1 / N / 2 et le
          score réel, puis l’outil compare les choix possibles.
        </p>

        <p>
          Dans la liste des matchs : <strong>vert</strong> signifie cotes +
          score réel renseignés, donc match joué et prêt pour le backtest.
          <strong>Orange</strong> signifie cotes renseignées mais score réel absent
          ou saisie incomplète, donc match à venir/simulable.
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Saisie</p>
          <h2>Ajouter les points MPP et le score réel</h2>
        </div>

        <label className="settings-label">
          Match
          <select
            value={selectedMatchKey}
            onChange={(event) => setSelectedMatchKey(event.target.value)}
          >
            {sortedFixtures.map((fixture) => {
              const key = getFixtureKey(fixture);
              const savedRecord = records[key];
              const status = getRecordStatus(savedRecord);

              return (
                <option key={key} value={key} style={getOptionStyle(status)}>
                  {getOptionPrefix(status)}
                  {formatFixtureLabel(fixture)}
                </option>
              );
            })}
          </select>
        </label>

        {selectedRecord && (
          <>
            <div className="grid two-columns">
              <label className="settings-label">
                Points MPP victoire {selectedRecord.homeTeam}
                <input
                  value={selectedRecord.homeMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('homeMppPoints', event.target.value)
                  }
                  placeholder="22"
                />
              </label>

              <label className="settings-label">
                Points MPP match nul
                <input
                  value={selectedRecord.drawMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('drawMppPoints', event.target.value)
                  }
                  placeholder="166"
                />
              </label>

              <label className="settings-label">
                Points MPP victoire {selectedRecord.awayTeam}
                <input
                  value={selectedRecord.awayMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('awayMppPoints', event.target.value)
                  }
                  placeholder="189"
                />
              </label>

              <label className="settings-label">
                Score réel {selectedRecord.homeTeam}
                <input
                  value={selectedRecord.actualHomeScore}
                  onChange={(event) =>
                    updateSelectedRecord('actualHomeScore', event.target.value)
                  }
                  placeholder="vide si pas joué"
                />
              </label>

              <label className="settings-label">
                Score réel {selectedRecord.awayTeam}
                <input
                  value={selectedRecord.actualAwayScore}
                  onChange={(event) =>
                    updateSelectedRecord('actualAwayScore', event.target.value)
                  }
                  placeholder="vide si pas joué"
                />
              </label>
            </div>

            <div className="grid two-columns">
              <button
                type="button"
                className="primary-button"
                onClick={handleSaveSelectedRecord}
              >
                Sauvegarder ce match
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={handleUseFixtureScore}
              >
                Reprendre le score du calendrier
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={handleDeleteSelectedRecord}
              >
                Supprimer ce match
              </button>
            </div>
          </>
        )}

        <p className="import-status">
          {completedRecords.length} matchs joués prêts pour le backtest.
          {incompleteStartedRecords.length > 0
            ? ` ${incompleteStartedRecords.length} matchs ont des cotes sans score réel complet : ils restent simulables.`
            : ''}
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Backtest</p>
          <h2>Lancer la simulation</h2>
        </div>

        <div className="grid two-columns">
          <button
            className="primary-button"
            type="button"
            onClick={handleRunBacktest}
            disabled={completedRecords.length === 0}
          >
            Lancer le backtest MPP
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleRunModelCalibration}
            disabled={completedRecords.length === 0}
          >
            Tester les réglages modèle sur MPP
          </button>


          <button
            className="secondary-button"
            type="button"
            onClick={handleProjectRemainingMatches}
          >
            Simuler les matchs restants + bonus x2
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleExportJson}
          >
            Exporter les données
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleImportJson}
          >
            Importer des données
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleResetAll}
          >
            Tout supprimer
          </button>
        </div>
      </section>

      {remainingProjection && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Projection MPP</p>
            <h2>Matchs restants et meilleur bonus x2</h2>
          </div>

          <p>
            Cette simulation utilise les points MPP déjà saisis dans Backtest MPP,
            ignore les matchs dont le score réel est renseigné, puis calcule le
            conseil final sur tous les matchs restants.
          </p>

          <div className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Déjà joués</p>
              <h2>{formatPoints(remainingProjection.alreadyWon)}</h2>
              <p>{remainingProjection.alreadyMatches} matchs complets dans le backtest.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Espérance restante</p>
              <h2>{formatPoints(remainingProjection.expectedTotal)}</h2>
              <p>{remainingProjection.rows.length} matchs simulés.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Avec meilleur x2</p>
              <h2>{formatPoints(remainingProjection.expectedWithBestX2)}</h2>
              <p>
                Bonus conseillé :{' '}
                <strong>
                  {remainingProjection.bestX2Row
                    ? `${remainingProjection.bestX2Row.homeTeam} - ${remainingProjection.bestX2Row.awayTeam}`
                    : '-'}
                </strong>
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Potentiel si tout passe</p>
              <h2>{formatPoints(remainingProjection.potentialExactTotal)}</h2>
              <p>
                Si tous les conseils finaux sortent en score exact. Résultat seul :{' '}
                {formatPoints(remainingProjection.potentialOutcomeOnlyTotal)}.
              </p>
            </article>
          </div>

          {remainingProjection.skippedWithoutOdds > 0 && (
            <p className="import-status">
              {remainingProjection.skippedWithoutOdds} matchs restants ignorés :
              les points MPP ne sont pas encore saisis.
            </p>
          )}

          {remainingProjection.bestX2Row && (
            <p className="import-status">
              <strong>Meilleur x2 en espérance :</strong>{' '}
              {remainingProjection.bestX2Row.homeTeam} - {remainingProjection.bestX2Row.awayTeam}{' '}
              sur le score{' '}
              <strong>{remainingProjection.bestX2Row.recommendedPick.scoreLabel}</strong>{' '}
              ({remainingProjection.bestX2Row.recommendedPick.outcomeLabel}) · EV bonus :{' '}
              <strong>{formatDecimal(remainingProjection.bestX2Row.recommendedPick.expectedPoints)} pts</strong>.
              {remainingProjection.safestX2Row &&
              remainingProjection.safestX2Row.matchKey !== remainingProjection.bestX2Row.matchKey ? (
                <>
                  {' '}Option plus prudente :{' '}
                  <strong>
                    {remainingProjection.safestX2Row.homeTeam} - {remainingProjection.safestX2Row.awayTeam}
                  </strong>{' '}
                  ({remainingProjection.safestX2Row.recommendedPick.scoreLabel}).
                </>
              ) : null}
            </p>
          )}

          {remainingProjection.rows.length === 0 ? (
            <p className="import-status">
              Aucun match restant simulable. Renseigne au moins les trois points MPP
              d’un match non joué.
            </p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Points MPP</th>
                    <th>Conseil final</th>
                    <th>Résultat</th>
                    <th>Proba résultat</th>
                    <th>Proba score</th>
                    <th>Points si résultat</th>
                    <th>Points si exact</th>
                    <th>EV</th>
                    <th>Risque</th>
                    <th>Meilleure espérance</th>
                    <th>Différenciant</th>
                  </tr>
                </thead>

                <tbody>
                  {remainingProjection.rows.map((row) => (
                    <tr key={row.matchKey}>
                      <td>
                        <strong>
                          {row.homeTeam} - {row.awayTeam}
                        </strong>
                        <br />
                        <span className="muted-text">
                          {row.date} · Groupe {row.group ?? '-'}
                        </span>
                      </td>
                      <td>
                        {row.record.homeMppPoints} / {row.record.drawMppPoints} /{' '}
                        {row.record.awayMppPoints}
                      </td>
                      <td>
                        <strong>{row.recommendedPick.scoreLabel}</strong>
                      </td>
                      <td>{row.recommendedPick.outcomeLabel}</td>
                      <td>{formatPercent(row.recommendedPick.outcomeProbability)}</td>
                      <td>{formatPercent(row.recommendedPick.exactProbability)}</td>
                      <td>{formatPoints(row.recommendedPick.outcomePoints)}</td>
                      <td>{formatPoints(row.recommendedPick.exactScoreTotalPoints)}</td>
                      <td>
                        <strong>{formatDecimal(row.recommendedPick.expectedPoints)} pts</strong>
                      </td>
                      <td>{row.recommendedPick.riskLabel}</td>
                      <td>{row.bestExpectedPick.scoreLabel}</td>
                      <td>{row.upsidePick.scoreLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {modelCalibrationRows.length > 0 && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Calibration modèle avec points MPP</p>
            <h2>Quel réglage du moteur rapporte le plus avec le Conseil final ?</h2>
          </div>

          <p>
            Ce tableau relance le backtest MPP avec plusieurs réglages du moteur de prédiction.
            Il garde la stratégie <strong>Conseil final</strong> et compare directement les points gagnés.
          </p>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Réglage modèle</th>
                  <th>Bons résultats</th>
                  <th>Scores exacts</th>
                  <th>Points gagnés</th>
                  <th>Max possible</th>
                  <th>Récupération</th>
                  <th>Description</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {modelCalibrationRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td>
                      {row.summary
                        ? `${row.summary.correctOutcomes} / ${row.summary.matches} · ${formatPercent(row.summary.correctOutcomeRate)}`
                        : '-'}
                    </td>
                    <td>
                      {row.summary
                        ? `${row.summary.exactScores} / ${row.summary.matches} · ${formatPercent(row.summary.exactScoreRate)}`
                        : '-'}
                    </td>
                    <td>
                      <strong>{row.summary ? formatPoints(row.summary.pointsWon) : '-'}</strong>
                    </td>
                    <td>{row.summary ? formatPoints(row.summary.maxPossiblePoints) : '-'}</td>
                    <td>{row.summary ? formatPercent(row.summary.captureRate) : '-'}</td>
                    <td>{row.description}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleApplyMppCalibration(row)}
                        disabled={!onSettingsChange}
                      >
                        Appliquer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {backtestResult && (
        <>
          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Résumé</p>
              <h2>Comparaison des stratégies</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Stratégie</th>
                    <th>Matchs</th>
                    <th>Bons résultats</th>
                    <th>Scores exacts</th>
                    <th>Points gagnés</th>
                    <th>Max possible</th>
                    <th>Points laissés</th>
                    <th>Récupération</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.summaries.map((summary) => (
                    <tr key={summary.strategyId}>
                      <td>
                        <strong>{summary.strategyLabel}</strong>
                      </td>
                      <td>{summary.matches}</td>
                      <td>
                        {summary.correctOutcomes} / {summary.matches} ·{' '}
                        {formatPercent(summary.correctOutcomeRate)}
                      </td>
                      <td>
                        {summary.exactScores} / {summary.matches} ·{' '}
                        {formatPercent(summary.exactScoreRate)}
                      </td>
                      <td>
                        <strong>{formatPoints(summary.pointsWon)}</strong>
                      </td>
                      <td>{formatPoints(summary.maxPossiblePoints)}</td>
                      <td>{formatPoints(summary.missedPoints)}</td>
                      <td>{formatPercent(summary.captureRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {backtestResult.bestStrategy && (
              <p className="import-status">
                Meilleure stratégie actuelle :{' '}
                <strong>{backtestResult.bestStrategy.strategyLabel}</strong>{' '}
                avec{' '}
                <strong>
                  {formatPoints(backtestResult.bestStrategy.pointsWon)}
                </strong>{' '}
                récupérés sur{' '}
                <strong>
                  {formatPoints(backtestResult.bestStrategy.maxPossiblePoints)}
                </strong>
                .
              </p>
            )}
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Détail par match</p>
              <h2>Voir où les points sont gagnés ou perdus</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Score réel</th>
                    <th>Points MPP 1/N/2</th>
                    <th>Max possible</th>
                    <th>Score le plus probable</th>
                    <th>Meilleure espérance</th>
                    <th>Conseil final</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.matches.map((match) => {
                    const topScore = match.strategyResults.find(
                      (result) => result.strategyId === 'model_top_score'
                    );

                    const bestExpected = match.strategyResults.find(
                      (result) => result.strategyId === 'best_expected'
                    );

                    const recommended = match.strategyResults.find(
                      (result) => result.strategyId === 'recommended'
                    );

                    return (
                      <tr key={match.matchKey}>
                        <td>
                          <strong>
                            {match.homeTeam} - {match.awayTeam}
                          </strong>
                          <br />
                          <span className="muted-text">
                            {match.date} · Groupe {match.group ?? '-'}
                          </span>
                        </td>

                        <td>
                          <strong>{match.actualScoreLabel}</strong>
                          <br />
                          <span className="muted-text">
                            {match.actualOutcomeLabel}
                          </span>
                        </td>

                        <td>
                          {formatPoints(match.homeMppPoints)} /{' '}
                          {formatPoints(match.drawMppPoints)} /{' '}
                          {formatPoints(match.awayMppPoints)}
                        </td>

                        <td>
                          <strong>
                            {formatPoints(match.maxPossiblePoints)}
                          </strong>
                        </td>

                        {[topScore, bestExpected, recommended].map(
                          (result, index) => (
                            <td key={index}>
                              {result ? (
                                <>
                                  <strong>{result.pickedScore}</strong>
                                  <br />
                                  <span
                                    className={getOutcomeHitClass(
                                      result.correctOutcome
                                    )}
                                  >
                                    Résultat{' '}
                                    {getOutcomeHitLabel(result.correctOutcome)}
                                  </span>
                                  <br />
                                  <span
                                    className={getOutcomeHitClass(
                                      result.exactScore
                                    )}
                                  >
                                    Exact{' '}
                                    {getOutcomeHitLabel(result.exactScore)}
                                  </span>
                                  <br />
                                  <span>
                                    {formatPoints(result.pointsWon)} gagnés
                                  </span>
                                </>
                              ) : (
                                '-'
                              )}
                            </td>
                          )
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Analyse complète</p>
              <h2>Toutes les stratégies par match</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Stratégie</th>
                    <th>Score joué</th>
                    <th>Résultat</th>
                    <th>Points gagnés</th>
                    <th>Points laissés</th>
                    <th>Espérance du choix</th>
                    <th>Risque</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.matches.flatMap((match) =>
                    match.strategyResults.map((result) => (
                      <tr key={`${match.matchKey}-${result.strategyId}`}>
                        <td>
                          <strong>
                            {match.homeTeam} - {match.awayTeam}
                          </strong>
                          <br />
                          <span className="muted-text">
                            Réel : {match.actualScoreLabel}
                          </span>
                        </td>

                        <td>{result.strategyLabel}</td>

                        <td>
                          <strong>{result.pickedScore}</strong>
                          <br />
                          <span className="muted-text">
                            {result.pickedOutcomeLabel}
                          </span>
                        </td>

                        <td>
                          <span
                            className={getOutcomeHitClass(
                              result.correctOutcome
                            )}
                          >
                            Résultat {getOutcomeHitLabel(result.correctOutcome)}
                          </span>
                          <br />
                          <span
                            className={getOutcomeHitClass(result.exactScore)}
                          >
                            Exact {getOutcomeHitLabel(result.exactScore)}
                          </span>
                        </td>

                        <td>
                          <strong>{formatPoints(result.pointsWon)}</strong>
                        </td>

                        <td>{formatPoints(result.missedPoints)}</td>

                        <td>
                          {formatDecimal(result.pickedExpectedPoints)} pts
                        </td>

                        <td>{result.pickedRiskLabel}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
