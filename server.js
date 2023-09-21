const { assign } = require('lodash');
const dayjs = require('dayjs');
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

var actions = {
	dashboardData: {
		fetcher: requests.dashboardData,
		updateEvery: 30 /*seconds*/,
	},
	dashboardPlots: {
		fetcher: requests.dashboardPlots,
		updateEvery: 120 /*seconds*/,
	},
	extraNodesInfo: {
		fetcher: requests.extraNodesInfo,
		updateEvery: 20 /*seconds*/
	},
	chainsHeight: {
		fetcher: requests.chainsHeight,
		updateEvery: 30 /*seconds*/
	},
	ohclPrice: {
		fetcher: requests.OHCLprice,
		updateEvery: 60 /*seconds*/
	},
	saversExtraData: {
		fetcher: requests.getSaversExtra,
		updateEvery: 60 /*seconds*/
	},
	oldSaversExtraData: {
		fetcher: requests.getOldSaversExtra,
		updateEvery: 6 * 60 * 60 /*every 6 hours*/
	},
	saversInfo: {
		fetcher: requests.getSaversInfo,
		updateEvery: 2 * 60 /*every 2 mins*/
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
		console.log('calling fetcher :', name);
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
	}

	console.log('starting interval...');
	startInterval();
}

function startInterval () {
	return setInterval(async () => {
		for (var name of Object.keys(actions)) {
			var record = actions[name];
	
			/* update the record if it's the time */
			if (Date.now() - record.lastUpdate >= record.updateEvery * 1000) {
				console.log('asking for update', name);
				await updateAction(record, name);
			} else if (record && record.err) {
				console.log('update due to error', name);
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