# MPP World Cup Predictor

Première version fonctionnelle d'une application React + TypeScript + Vite pour prédire des scores exacts de matchs internationaux et préparer une logique d'optimisation Mon Petit Prono / MPP.

## Lancer le projet

```bash
npm install
npm run dev
```

Dans StackBlitz :
1. Crée un projet React + TypeScript + Vite.
2. Remplace les fichiers par ceux de ce dossier.
3. Lance le serveur Vite.

## Structure

```txt
src/
  data/
    sampleMatches.ts
  types/
    football.ts
    mpp.ts
  utils/
    csvParser.ts
    formatters.ts
    teamStats.ts
    poisson.ts
    predictionModel.ts
    mppScoring.ts
  components/
    MatchSelector.tsx
    PredictionCard.tsx
    ScoreDistributionTable.tsx
    ModelSettings.tsx
  pages/
    HomePage.tsx
    DatabasePage.tsx
    PredictionsPage.tsx
    SettingsPage.tsx
    MppSimulationPage.tsx
```

## CSV attendu

La page **Base de données** accepte un CSV local au format :

```csv
date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
2022-12-18,Argentina,France,3,3,FIFA World Cup,Lusail,Qatar,TRUE
```

Colonnes obligatoires :
- `date`
- `home_team`
- `away_team`
- `home_score`
- `away_score`
- `tournament`
- `neutral`

Colonnes optionnelles :
- `city`
- `country`

## Principe du modèle actuel

Le modèle est volontairement simple :
1. Il filtre les matchs à partir d'une année de départ.
2. Il pondère les matchs récents plus fortement.
3. Il donne plus de poids aux compétitions officielles.
4. Il calcule une force offensive et une faiblesse défensive par équipe.
5. Il estime les buts attendus de chaque équipe.
6. Il applique une loi de Poisson indépendante pour générer les scores exacts.

Ce n'est pas encore un modèle parfait. C'est une base propre pour itérer ensuite avec :
- Elo ou classement FIFA ;
- données joueurs ;
- blessures ;
- probabilité de popularité des pronostics MPP ;
- stratégie de ligue.

## Prochaines améliorations conseillées

1. Remplacer `sampleMatches.ts` par un vrai import CSV complet.
2. Ajouter un mapping robuste des noms d'équipes.
3. Ajouter Elo/FIFA dans `TeamStats` ou dans un fichier séparé.
4. Tester les prédictions passées en backtesting.
5. Calibrer les paramètres avec les résultats historiques.
6. Brancher la page Simulation MPP sur les vraies prédictions.
