const dayjs = require('dayjs');
const { setIntervalAsync } = require('set-interval-async/dynamic');
// Constants
require('dotenv').config();
const PORT = process.env.PORT;
const HOST = '0.0.0.0';
const express = require('express');
const app = express();

const cors = require('cors');

const requests = require('./src/middleware');

// Init storage
const Storage = require('node-storage');
var store = new Storage('./storage/main');

const corsOptions = {
	origin: '*',
};

app.use(express.json());
app.use(cors(corsOptions));

function debugLogger(sb) {
	console.log(`${dayjs().format()} - ${sb}`);
}

var actions = {
	dashboardData: {
		fetcher: requests.dashboardData,
		updateEvery: 30,
	},
	dashboardPlots: {
		fetcher: requests.dashboardPlots,
		updateEvery: 60 * 10
	},
	extraNodesInfo: {
		fetcher: requests.extraNodesInfo,
		updateEvery: 20
	},
	chainsHeight: {
		fetcher: requests.chainsHeight,
		updateEvery: 10
	},
	rawEarnings: {
		fetcher: requests.rawEarnings,
		updateEvery: 60 * 60
	},
	saversInfo: {
		fetcher: requests.getSaversInfo,
		updateEvery: 60 * 60
	},
	runePools: {
		fetcher: requests.getRunePools,
		updateEvery: 60 * 2,
	},
	oldRunePool: {
		fetcher: requests.oldRunePool,
		updateEvery: 60 * 2,
	},
	runePoolProviders: {
		fetcher: requests.getRuneProviders,
		updateEvery: 60,
	},
	oldRunePoolProviders: {
		fetcher: requests.getOldRuneProviders,
		updateEvery: 60,
	},
	borrowers: {
		fetcher: requests.getLendingInfo,
		updateEvery: 60 * 2
	},
	historyPools: {
		fetcher: requests.getPoolsDVE,
		updateEvery: 2 * 60 * 60,
		params: {interval: 'day'},
	},
	historyPoolsWeek: {
		fetcher: requests.getPoolsDVE,
		updateEvery: 2 * 60 * 60,
		params: {interval: 'week'},
	},
	historyPoolsMonth: {
		fetcher: requests.getPoolsDVE,
		updateEvery: 3 * 60 * 60,
		params: {interval: 'month'},
	},
	historyPoolsYear: {
		fetcher: requests.getPoolsDVE,
		updateEvery: 4 * 60 * 60,
		params: {interval: 'year'},
	},
	oldHistoryPools: {
		fetcher: requests.getOldPoolsDVE,
		updateEvery: 60 * 60,
		params: {interval: 'day'},
	},
	oldHistoryPoolsWeek: {
		fetcher: requests.getOldPoolsDVE,
		updateEvery: 2 * 60 * 60,
		params: {interval: 'week'},
	},
	oldHistoryPoolsMonth: {
		fetcher: requests.getOldPoolsDVE,
		updateEvery: 3 * 60 * 60,
		params: {interval: 'month'},
	},
	oldHistoryPoolsYear: {
		fetcher: requests.getOldPoolsDVE,
		updateEvery: 4 * 60 * 60,
		params: {interval: 'year'},
	},
};

var mainnet = {
	swaps: {
		fetcher: requests.getTopSwaps,
		updateEvery: 60
	},
	swapsWeekly: {
		fetcher: requests.SwapQuery,
		updateEvery: 60 * 60 * 24,
	},
	statsDaily: {
		fetcher: requests.ThorchainStatsDaily,
		updateEvery: 60 * 60 * 24
	},
	feesRewardsMonthly: {
		fetcher: requests.FeesRewardsMonthly,
		updateEvery: 60 * 60 * 24
	},
	affiliateSwapsByWallet: {
		fetcher: requests.AffiliateSwapsByWallet,
		updateEvery: 60 * 60 * 24
	},
	affiliateByWallet: {
		fetcher: requests.AffiliateByWallet,
		updateEvery: 60 * 60 * 24
	},
	affiliateDaily: {
		fetcher: requests.AffiliateDaily,
		updateEvery: 60 * 60 * 24
	},
	coinmarketCap: {
		fetcher: requests.getCoinMarketCapInfo,
		updateEvery: 60 * 60 * 12
	},
	nodesInfo: {
		fetcher: requests.nodesInfo,
		updateEvery: 20
	}
}

var test = {
	extraNodesInfo: {
		fetcher: requests.extraNodesInfo,
		updateEvery: 20
	},
	chainsHeight: {
		fetcher: requests.chainsHeight,
		updateEvery: 10
	},
	test: {
		fetcher: requests.nodesInfo,
		updateEvery: 60
	},
}

async function updateAction(name) {
	if (!actions[name]) {
		return;
	}

	actions[name]['lastUpdate'] = Date.now();

	try {
		debugLogger(`Calling fetcher: ${name}`);
		const res = await actions[name].fetcher();

		actions[name] = {
			...actions[name],
			value: res,
			err: null
		};

		store.put(name, {value: res, lastUpdate: actions[name]['lastUpdate']});
	} catch (e) {
		actions[name].err = e;
		console.error(`${dayjs().format()} - Error occured in -- ${name} -- ${e.response?.statusText ?? e.response}`);
	}
}

function initActionsFromStorage() {
	for (var name of Object.keys(actions)) {
		const v = store.get(name);
		if (v && v.value) {
			var res = store.get(name);

			// Update actions from node storage
			actions[name].value = res.value;
			actions[name].lastUpdate = res.lastUpdate;
			actions[name].err = null;
		}
	}
}

function shouldBeUpdated(record) {
	if (!record.value || !record.lastUpdate) {
		return true;
	}
	return Date.now() - record.lastUpdate >= record.updateEvery * 1000;
}

/* Update all the values at server init */
async function mainFunction() {
	if (process.env.NETWORK === 'mainnet') {
		actions = {...mainnet, ...actions}
	}

	initActionsFromStorage();
	
	for (var name of Object.keys(actions)) {
		if (shouldBeUpdated(actions[name])) {
			await updateAction(name);
			await requests.wait(1000);
		}
	}

	debugLogger('Starting interval...');
	startInterval();
}

function startInterval () {
	return setIntervalAsync(async () => {
		for (var name of Object.keys(actions)) {
			var record = actions[name];
	
			/* update the record if it's the time */
			if (shouldBeUpdated(record)) {
				debugLogger(`Asking for update ${name}`);
				await updateAction(name);
			} else if (record && record.err) {
				debugLogger(`Update due to error ${name}`);
				await updateAction(name);
			}
		}
	}, 30 * 1e3);
}

app.get('/api/:key', async (req, res) => {
	try {
		var name = req.params.key;
		if (name in actions) {
			if (actions[name].value) {
				var value = actions[name].value;
				res.json(value);
			} else {
				res.status(503).json({
					reason: 'Unable to fetch the data yet!',
					error: actions[name].err ?? null
				});
			}
		} else {
			res.status(404).json({ msg: 'Static data Not found', key: name });
		}
	} catch (e) {
		console.error(e);
	}
});

app.get('/api/*', (req, res) => {
	res.status(404).send({ msg: 'Not found', url: req.url });
});

app.get('/', (req, res) => {
	res.send('<p>Welcome!</p>');
});

app.get('/lastblock', async (req, res) => {
	const height = await requests.getTHORlastblock();
	res.json(height);
});

app.get('/actions', async (req, res) => {
	const actions = await requests.getActions(req.query);
	res.json(actions);
});

app.get('/quote', async (req, res) => {
	const quote = await requests.getQuote(req.query);
	res.json(quote);
});

app.listen(PORT, HOST);

mainFunction();