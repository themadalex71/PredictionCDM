import type { PredictionContext } from '../types/football';

type MatchSelectorProps = {
  teams: string[];
  teamA: string;
  teamB: string;
  context: PredictionContext;
  onTeamAChange: (team: string) => void;
  onTeamBChange: (team: string) => void;
  onContextChange: (context: PredictionContext) => void;
};

export function MatchSelector({
  teams,
  teamA,
  teamB,
  context,
  onTeamAChange,
  onTeamBChange,
  onContextChange,
}: MatchSelectorProps) {
  return (
    <section className="card">
      <div className="section-title">
        <p className="eyebrow">Match</p>
        <h2>Sélection du match</h2>
      </div>

      <div className="grid two-columns">
        <label className="field">
          Équipe A
          <select value={teamA} onChange={(event) => onTeamAChange(event.target.value)}>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Équipe B
          <select value={teamB} onChange={(event) => onTeamBChange(event.target.value)}>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="inline-options">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={context.neutral}
            onChange={(event) => onContextChange({ ...context, neutral: event.target.checked })}
          />
          Terrain neutre
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={context.teamAIsHome ?? true}
            disabled={context.neutral}
            onChange={(event) => onContextChange({ ...context, teamAIsHome: event.target.checked })}
          />
          Équipe A à domicile
        </label>
      </div>
    </section>
  );
}
