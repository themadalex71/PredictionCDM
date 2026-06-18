import type {
  MatchResult,
  ModelSettings,
  PredictionContext,
} from '../types/football';
import { PredictionsPage } from './PredictionsPage';

type MppSimulationPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
  initialTeamA?: string;
  initialTeamB?: string;
  initialContext?: PredictionContext;
};

export function MppSimulationPage(props: MppSimulationPageProps) {
  return <PredictionsPage {...props} />;
}
