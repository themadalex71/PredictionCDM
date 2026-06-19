import type {
  MatchResult,
  ModelSettings,
  PredictionContext,
} from '../types/football';
import type { WorldCupMatch } from '../types/worldcup';
import type { MppRecordsByKey } from '../utils/mppWorldCupStorage';
import { PredictionsPage } from './PredictionsPage';

type MppSimulationPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
  initialTeamA?: string;
  initialTeamB?: string;
  initialContext?: PredictionContext;
  initialWorldCupMatch?: WorldCupMatch;
  mppRecords?: MppRecordsByKey;
  onMppRecordsChange?: (records: MppRecordsByKey) => void;
};

export function MppSimulationPage(props: MppSimulationPageProps) {
  return <PredictionsPage {...props} />;
}
