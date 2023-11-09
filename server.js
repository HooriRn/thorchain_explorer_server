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
		updateEvery: 60 * 60
	},
	extraNodesInfo: {
		fetcher: requests.extraNodesInfo,
		updateEvery: 20
	},
	chainsHeight: {
		fetcher: requests.chainsHeight,
		updateEvery: 30
	},
	ohclPrice: {
		fetcher: requests.OHCLprice,
		updateEvery: 60 * 60
	},
	saversInfo: {
		fetcher: requests.getSaversInfo,
		updateEvery: 60 * 60
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
	}
};

async function updateAction(record, name) {
	record['lastUpdate'] = Date.now();

	try {
		debugLogger(`Calling fetcher: ${name}`);
		const res = await record.fetcher();

		actions[name] = {
			...actions[name],
			value: res,
			err: null
		};
	} catch (e) {
		actions[name].err = e;

		console.error(`${dayjs().format()} - Error occured in -- ${name} -- ${e.response?.statusText ?? e.response}`);
	}
}

/* Update all the values at server init */
async function mainFunction() {
	for (var name of Object.keys(actions)) {
		var record = actions[name];
		await updateAction(record, name);
		await requests.wait(1000);
	}

	debugLogger('Starting interval...');
	startInterval();
}

function startInterval () {
	return setIntervalAsync(async () => {
		for (var name of Object.keys(actions)) {
			var record = actions[name];
	
			/* update the record if it's the time */
			if (Date.now() - record.lastUpdate >= record.updateEvery * 1000) {
				debugLogger(`Asking for update ${name}`);
				await updateAction(record, name);
			} else if (record && record.err) {
				debugLogger(`Update due to error ${name}`);
				await updateAction(record, name);
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

app.listen(PORT, HOST);

mainFunction();