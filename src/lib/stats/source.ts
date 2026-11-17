// Where the stats page gets its numbers. The counting script publishes
// stats.json to the `stats` branch of the repository once a day; the page
// reads it from there at view time, so the numbers refresh without a deploy.
//
// VITE_STATS_URL overrides the address at build time, for previewing the page
// against a local file.

export const REPO_URL = 'https://github.com/y4hyya/stellarusdcto';

export const STATS_URL: string =
    import.meta.env.VITE_STATS_URL ??
    'https://raw.githubusercontent.com/y4hyya/stellarusdcto/stats/stats.json';

export const STATS_DATA_URL = `${REPO_URL}/tree/stats`;
export const STATS_SCRIPT_URL = `${REPO_URL}/tree/main/scripts/stats`;
