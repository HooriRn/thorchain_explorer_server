const PORT = process.env.PORT;
const HOST = '0.0.0.0';
const express = require('express');
const app = express();
const fetchers = require('./fetchers');

const cors = require('cors');

const corsOptions = {
	origin: '*'
};

app.use(express.json());
app.use(cors(corsOptions));

function createServer() {
	var data = {
		'coingeckoMarkets':{ fetcher: fetchers.fetchCoingeckoMarkets, updateEvery: 5 /*seconds*/ },
		'coingeckoAllMarkets':{ fetcher: fetchers.fetchCoingecko_All_Markets, updateEvery: 20 },
		'coingeckoNetInfo':{ fetcher: fetchers.fetchCoingeckoNetInfo, updateEvery: 5 },
		'runePrice':{ fetcher: fetchers.fetchRunePrice, updateEvery: 5 },
		'minBond':{ fetcher: fetchers.fetchMinimumBond, updateEvery: 5 },
		'lastBlock':{ fetcher: fetchers.fetchLastBlock, updateEvery: 1 },
		'thorNetValuesMCCN':{ fetcher: fetchers.fetchThorNetValues, updateEvery: 1},
		'coingecko_ERC20_Markets': {fetcher: fetchers.fetchCoingecko_ERC20_Markets, updateEvery: 5},
		'nodesLocation': {fetcher: fetchers.fetchNodesLocation, updateEvery: 120}
	};

	/* Update all the values at server init */
	setTimeout(async () => {
		for (var key of Object.keys(data)) {
			(() => {
				var record = data[key];
				record['lastUpdate'] = Date.now();

				record.fetcher().then((res)=>{
					record['value'] = res;
					record['err'] = null;
				})
					.catch(rej =>{
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
					var currentKey = key;
					var record = data[key];
					record['lastUpdate'] = Date.now();
  
					record.fetcher().then((res)=>{
						if(res)
							record['value'] = res;
						record['err'] = null;
					})
						.catch(rej =>{
							record['value'] = null;
							record['err'] = rej;
							console.error(currentKey +': failed');
							console.error(rej);
						});
				})();

			}
		}
	}, 500);

	app.get('/api/static_data/:key', async (req, res)=>{      
		try{
			var key = req.params.key;
			if(key in data) {
        
				var value = data[key].value;
				res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=119');
				res.json(value);
			}
			else{
				res.status(404).json({msg: 'Static data Not found', key});
			}
		}
		catch(e){
			console.error(e);
		}
	});

	app.get('/api/coingecko', (req, res) => {
		try {
			var coingecko = {
				markets: data.coingeckoMarkets? data.coingeckoMarkets.value: {},
				netInfo: data.coingeckoNetInfo? data.coingeckoNetInfo.value: {},
				lastUpdate: data.coingeckoMarkets? data.coingeckoMarkets.lastUpdate: 0
			};
			res.json(coingecko);
		}
		catch (e) {
			console.error(e);
		}
	});

	app.get('/api/*', (req, res)=>{
		res.status(404).send({msg: 'Not found', url: req.url});
	});

}

createServer();

app.listen(PORT, HOST);