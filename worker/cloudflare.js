/**
 * Optional Cloudflare traffic/RUM comparison.
 *
 * This activates only when CF_ANALYTICS_TOKEN is configured as a Worker secret.
 * The token should have Analytics Read for the KompMajstor account and
 * matijar.info zone. No individual request data is returned or stored.
 */

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const EXCLUDED_BROWSERS = ['Curl', 'YandexBot', 'GoogleBot', 'ChromeHeadless'];

const QUERY = `
query SredstvaTraffic($account: String!, $start: Date!, $end: Date!, $zone: string!, $site: string!, $host: string!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      edgeDaily: httpRequestsAdaptiveGroups(
        limit: 500
        filter: {
          date_geq: $start
          date_leq: $end
          zoneTag: $zone
          clientRequestHTTPHost: $host
          clientRequestPath_in: ["/", "/index.html"]
          clientRequestHTTPMethodName: "GET"
          edgeResponseStatus: 200
          requestSource: "eyeball"
          verifiedBotCategory: ""
          userAgentBrowser_notin: ["Curl", "YandexBot", "GoogleBot", "ChromeHeadless"]
        }
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      edgeBrowsers: httpRequestsAdaptiveGroups(
        limit: 100
        filter: {
          date_geq: $start
          date_leq: $end
          zoneTag: $zone
          clientRequestHTTPHost: $host
          clientRequestPath_in: ["/", "/index.html"]
          clientRequestHTTPMethodName: "GET"
          edgeResponseStatus: 200
          requestSource: "eyeball"
          verifiedBotCategory: ""
          userAgentBrowser_notin: ["Curl", "YandexBot", "GoogleBot", "ChromeHeadless"]
        }
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { userAgentBrowser }
      }
      rumDaily: rumPageloadEventsAdaptiveGroups(
        limit: 500
        filter: {
          date_geq: $start
          date_leq: $end
          siteTag: $site
          requestHost: $host
          bot: 0
        }
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
    }
  }
}`;

function sum(rows, selector) {
	let total = 0;
	for (const row of rows || []) total += Number(selector(row)) || 0;
	return total;
}

export async function loadCloudflareSignals(env, start, end, fetchFn = fetch) {
	if (!env.CF_ANALYTICS_TOKEN) return { status: 'not-configured' };
	try {
		const response = await fetchFn(ENDPOINT, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				query: QUERY,
				variables: {
					account: env.CF_ACCOUNT_ID,
					zone: env.CF_ZONE_ID,
					site: env.CF_WEB_ANALYTICS_SITE_TAG,
					host: env.PUBLIC_HOST,
					start,
					end,
				},
			}),
		});
		if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
		const payload = await response.json();
		if (payload.errors?.length) throw new Error(payload.errors[0].message || 'GraphQL error');
		const account = payload.data?.viewer?.accounts?.[0];
		if (!account) throw new Error('Cloudflare account data unavailable');
		const edgeDaily = (account.edgeDaily || []).map((row) => ({
			day: row.dimensions.date,
			requests: Number(row.count) || 0,
			visits: Number(row.sum?.visits) || 0,
		}));
		const rumDaily = (account.rumDaily || []).map((row) => ({
			day: row.dimensions.date,
			pageLoads: Number(row.count) || 0,
			visits: Number(row.sum?.visits) || 0,
		}));
		const browsers = (account.edgeBrowsers || []).map((row) => ({
			name: row.dimensions.userAgentBrowser || 'Unknown',
			requests: Number(row.count) || 0,
			visits: Number(row.sum?.visits) || 0,
		}));
		return {
			status: 'ok',
			edgeDaily,
			rumDaily,
			browsers,
			edgeRequests: sum(edgeDaily, (row) => row.requests),
			edgeVisits: sum(edgeDaily, (row) => row.visits),
			rumPageLoads: sum(rumDaily, (row) => row.pageLoads),
			excludedBrowsers: EXCLUDED_BROWSERS,
		};
	} catch (error) {
		console.error('Cloudflare analytics query failed:', error);
		return { status: 'error' };
	}
}
