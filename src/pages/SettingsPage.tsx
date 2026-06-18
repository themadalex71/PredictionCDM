import { ModelSettings } from '../components/ModelSettings';
import type { ModelSettings as ModelSettingsType } from '../types/football';

type SettingsPageProps = {
  settings: ModelSettingsType;
  onSettingsChange: (settings: ModelSettingsType) => void;
};

export function SettingsPage({ settings, onSettingsChange }: SettingsPageProps) {
  return (
    <div className="page-stack">
      <ModelSettings settings={settings} onChange={onSettingsChange} />

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">À améliorer ensuite</p>
          <h2>Paramètres futurs</h2>
        </div>
        <p>
          Tu pourras ajouter un coefficient Elo/FIFA, une force d'effectif, des absences, la fatigue du calendrier,
          ou encore des réglages différents selon phase de poule / phase finale.
        </p>
      </section>
    </div>
  );
}
