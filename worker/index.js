/**
 * havc-explorer — Worker entry point.
 *
 * Static assets are matched and served BEFORE this code runs, and asset requests
 * are free and unmetered. This handler therefore only executes for paths that
 * are not files in the repo.
 *
 * There is deliberately no `run_worker_first` in wrangler.jsonc: setting it would
 * route every page load through this Worker and bill each one against the
 * account-wide Workers request budget, which is shared with ~40 other Workers.
 */
export default {
	async fetch(request, env) {
		return env.ASSETS.fetch(request);
	},
};
