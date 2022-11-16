// Constants
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

var data = {
	dashboardData: {
		fetcher: requests.dashboardData,
		updateEvery: 5 /*seconds*/,
	},
	dashboardPlots: {
		fetcher: requests.dashboardPlots,
		updateEvery: 120 /*seconds*/,
	},
	extraNodesInfo: {
		fetcher: requests.extraNodesInfo,
		updateEvery: 20 /*seconds*/
	},
	ohclPrice: {
		fetcher: requests.OHCLprice,
		updateEvery: 60 /*seconds*/
	},
	saversExtraData: {
		fetcher: requests.getSaversExtra,
		updateEvery: 60 /*seconds*/
	}
};

/* Update all the values at server init */
setTimeout(async () => {
	for (var key of Object.keys(data)) {
		(() => {
			var record = data[key];
			record['lastUpdate'] = Date.now();

			record
				.fetcher()
				.then((res) => {
					record['value'] = res;
					record['err'] = null;
				})
				.catch((rej) => {
					record['value'] = null;
					record['err'] = rej;
				});
		})();
	}
}, 0);

setInterval(async () => {
	for (var key of Object.keys(data)) {
		var record = data[key];

		/* update the record if it's the time */
		if (Date.now() - record.lastUpdate >= record.updateEvery * 1000) {
			(() => {
				var record = data[key];
				record['lastUpdate'] = Date.now();

				record
					.fetcher()
					.then((res) => {
						if (res) record['value'] = res;
						record['err'] = null;
					})
					.catch((rej) => {
						record['value'] = null;
						record['err'] = rej;
					});
			})();
		}
	}
}, 2000);

app.get('/api/:key', async (req, res) => {
	try {
		var key = req.params.key;
		if (key in data) {
			if (!data[key].value) {
				try {
					data[key]
						.fetcher()
						.then((res) => {
							data[key].value = res;
							data[key]['lastUpdate'] = Date.now();
						})
						.catch(() => {
							throw new Error('Can\'t get the data from backend server!');
						});
				} catch (e) {
					return res
						.status(404)
						.json({ msg: 'external api not responding', key });
				}
			}

			var value = data[key].value;
			res.setHeader(
				'Cache-Control',
				's-maxage=60, stale-while-revalidate=119'
			);
			res.json(value);
		} else {
			res.status(404).json({ msg: 'Static data Not found', key });
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