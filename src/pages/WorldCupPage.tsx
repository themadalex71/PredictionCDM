import { useMemo, useState } from 'react';
import { worldCup2026Fixtures } from '../data/worldcup2026/fixtures';
import { worldCup2026Teams } from '../data/worldcup2026/teams';
import type { WorldCupMatch } from '../types/worldcup';
import type { MppRecordsByKey } from '../utils/mppWorldCupStorage';
import {
  getMppRecordForFixture,
  hasActualScore,
  hasMppPoints,
  parseMppNumber,
} from '../utils/mppWorldCupStorage';

type WorldCupPageProps = {
  onPredictMatch: (match: WorldCupMatch) => void;
  mppRecords?: MppRecordsByKey;
};

type DisplayMode = 'groups' | 'dates';

type TeamView = {
  name: string;
  code?: string;
  group: string;
  confederation?: string;
  isHost?: boolean;
};

type MatchView = WorldCupMatch & {
  id?: string;
  group: string;
  date: string;
  time?: string;
  kickoffTime?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  status?: string;
  venue?: string;
  city?: string;
};

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

function formatDateLabel(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  const label = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getShortDateLabel(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function getMatchTime(match: MatchView): string {
  return match.time ?? match.kickoffTime ?? '';
}

function getMatchKey(match: MatchView): string {
  return (
    match.id ??
    `${match.date}-${match.group}-${match.homeTeam}-${match.awayTeam}`
  );
}

function hasMatchScore(match: MatchView, mppRecords?: MppRecordsByKey): boolean {
  const record = mppRecords ? getMppRecordForFixture(mppRecords, match) : undefined;

  return hasActualScore(record) || (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore));
}

function getDisplayedScore(match: MatchView, mppRecords?: MppRecordsByKey) {
  const record = mppRecords ? getMppRecordForFixture(mppRecords, match) : undefined;

  if (hasActualScore(record)) {
    return {
      home: parseMppNumber(record!.actualHomeScore),
      away: parseMppNumber(record!.actualAwayScore),
      source: 'saisie MPP',
    };
  }

  if (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)) {
    return {
      home: match.homeScore as number,
      away: match.awayScore as number,
      source: 'calendrier',
    };
  }

  return null;
}

function getMatchStatusLabel(match: MatchView, mppRecords?: MppRecordsByKey): string {
  if (hasMatchScore(match, mppRecords)) {
    return 'Joué';
  }

  if (match.status?.toLowerCase().includes('complete')) {
    return 'Joué';
  }

  if (match.status?.toLowerCase().includes('finished')) {
    return 'Joué';
  }

  return 'À venir';
}

function getMatchStatusClass(match: MatchView, mppRecords?: MppRecordsByKey): string {
  return hasMatchScore(match, mppRecords)
    ? 'diagnostic-pill ok'
    : 'diagnostic-pill warning';
}

function sortMatchesByDate(matches: MatchView[]): MatchView[] {
  return [...matches].sort((a, b) => {
    const aTime = `${a.date} ${getMatchTime(a)}`;
    const bTime = `${b.date} ${getMatchTime(b)}`;

    return aTime.localeCompare(bTime);
  });
}

function groupMatchesByDate(matches: MatchView[]) {
  const grouped = new Map<string, MatchView[]>();

  for (const match of sortMatchesByDate(matches)) {
    if (!grouped.has(match.date)) {
      grouped.set(match.date, []);
    }

    grouped.get(match.date)!.push(match);
  }

  return Array.from(grouped.entries()).map(([date, dateMatches]) => ({
    date,
    matches: dateMatches,
  }));
}

function MatchCard({
  match,
  onPredictMatch,
  mppRecords,
}: {
  match: MatchView;
  onPredictMatch: (match: WorldCupMatch) => void;
  mppRecords?: MppRecordsByKey;
}) {
  const score = getDisplayedScore(match, mppRecords);
  const scoreIsKnown = score !== null;
  const record = mppRecords ? getMppRecordForFixture(mppRecords, match) : undefined;
  const time = getMatchTime(match);

  return (
    <article className="card mini-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          alignItems: 'flex-start',
          marginBottom: '0.75rem',
        }}
      >
        <div>
          <p className="eyebrow">
            Groupe {match.group} · {getShortDateLabel(match.date)}
            {time ? ` · ${time}` : ''}
          </p>

          <h2>
            {match.homeTeam} - {match.awayTeam}
          </h2>
        </div>

        <span className={getMatchStatusClass(match, mppRecords)}>
          {getMatchStatusLabel(match, mppRecords)}
        </span>
      </div>

      {scoreIsKnown ? (
        <p>
          Score :{' '}
          <strong>
            {score?.home} - {score?.away}
          </strong>
        </p>
      ) : (
        <p className="muted-text">Match non joué.</p>
      )}

      {score?.source === 'saisie MPP' && (
        <p className="muted-text">Score repris depuis Backtest MPP.</p>
      )}

      {hasMppPoints(record) && (
        <p className="import-status">
          Points MPP : {record!.homeMppPoints} / {record!.drawMppPoints} / {record!.awayMppPoints}
        </p>
      )}

      {(match.venue || match.city) && (
        <p className="muted-text">
          {match.venue}
          {match.venue && match.city ? ' · ' : ''}
          {match.city}
        </p>
      )}

      <button
        className="primary-button"
        type="button"
        onClick={() => onPredictMatch(match)}
        style={{ marginTop: '0.75rem' }}
      >
        Prédire ce match
      </button>
    </article>
  );
}

function GroupView({
  teams,
  fixtures,
  onPredictMatch,
  mppRecords,
}: {
  teams: TeamView[];
  fixtures: MatchView[];
  onPredictMatch: (match: WorldCupMatch) => void;
  mppRecords?: MppRecordsByKey;
}) {
  return (
    <div className="page-stack">
      {GROUPS.map((group) => {
        const groupTeams = teams.filter((team) => team.group === group);
        const groupMatches = sortMatchesByDate(
          fixtures.filter((match) => match.group === group)
        );

        return (
          <section className="card" key={group}>
            <div className="section-title">
              <p className="eyebrow">Poule {group}</p>
              <h2>Groupe {group}</h2>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              {groupTeams.map((team) => (
                <span
                  key={team.name}
                  className="diagnostic-pill warning"
                  title={team.confederation}
                >
                  {team.name}
                  {team.isHost ? ' · Hôte' : ''}
                </span>
              ))}
            </div>

            <div className="grid two-columns">
              {groupMatches.map((match) => (
                <MatchCard
                  key={getMatchKey(match)}
                  match={match}
                  onPredictMatch={onPredictMatch}
                  mppRecords={mppRecords}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DateView({
  fixtures,
  onPredictMatch,
  mppRecords,
}: {
  fixtures: MatchView[];
  onPredictMatch: (match: WorldCupMatch) => void;
  mppRecords?: MppRecordsByKey;
}) {
  const dateGroups = groupMatchesByDate(fixtures);

  return (
    <div className="page-stack">
      {dateGroups.map((dateGroup) => (
        <section className="card" key={dateGroup.date}>
          <div className="section-title">
            <p className="eyebrow">Calendrier</p>
            <h2>{formatDateLabel(dateGroup.date)}</h2>
          </div>

          <div className="grid two-columns">
            {dateGroup.matches.map((match) => (
              <MatchCard
                key={getMatchKey(match)}
                match={match}
                onPredictMatch={onPredictMatch}
                mppRecords={mppRecords}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function WorldCupPage({ onPredictMatch, mppRecords }: WorldCupPageProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('groups');

  const teams = worldCup2026Teams as TeamView[];
  const fixtures = worldCup2026Fixtures as MatchView[];

  const totalMatches = fixtures.length;
  const playedMatches = useMemo(
    () => fixtures.filter((match) => hasMatchScore(match, mppRecords)).length,
    [fixtures, mppRecords]
  );

  const upcomingMatches = totalMatches - playedMatches;

  return (
    <div className="page-stack">
      <section className="card hero">
        <p className="eyebrow">Coupe du Monde 2026</p>
        <h1>Groupes et calendrier des matchs</h1>

        <p>
          Sélectionne un match pour envoyer directement les deux équipes vers la
          page de prédiction. Tu pourras ensuite entrer les cotes, tes points et
          les points du premier de ta ligue pour obtenir un conseil MPP.
        </p>
      </section>

      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div>
            <p className="eyebrow">Affichage</p>
            <h2>Choisir la vue du calendrier</h2>

            <p className="muted-text">
              {totalMatches} matchs au total · {playedMatches} joués ·{' '}
              {upcomingMatches} à venir
            </p>
          </div>

          <label className="settings-label" style={{ minWidth: '260px' }}>
            Mode d’affichage
            <select
              value={displayMode}
              onChange={(event) =>
                setDisplayMode(event.target.value as DisplayMode)
              }
            >
              <option value="groups">Par poule</option>
              <option value="dates">Par date</option>
            </select>
          </label>
        </div>
      </section>

      {displayMode === 'groups' ? (
        <GroupView
          teams={teams}
          fixtures={fixtures}
          onPredictMatch={onPredictMatch}
          mppRecords={mppRecords}
        />
      ) : (
        <DateView fixtures={fixtures} onPredictMatch={onPredictMatch} mppRecords={mppRecords} />
      )}
    </div>
  );
}
