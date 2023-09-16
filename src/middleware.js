const {
	getTxs,
	getStats,
	volumeHistory,
	swapHistory,
	tvlHistory,
	earningsHistory,
	getMidgardPools,
	getEarnings,
	getSaversHistory,
	getEarningsParam,
	getPoolSwapHistoryParam,
	getDepthsHistoryParam
} = require('./midgard');
const {
	getAddresses,
	getRPCLastBlockHeight,
	getSupplyRune,
	getLastBlockHeight,
	getNodes,
	getMimir,
	getAssets,
	getThorPools,
} = require('./thornode');
const dayjs = require('dayjs');
const { default: axios } = require('axios');
const axiosRetry = require('axios-retry');
const chunk = require('lodash/chunk');
const { endpoints } = require('../endpoints');
const { omit } = require('lodash');

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

async function dashboardPlots() {
	const { data: LPChange } = await volumeHistory();
	const { data: swaps } = await swapHistory();
	const { data: tvl } = await tvlHistory();
	const { data: earning } = await earningsHistory();

	return {
		LPChange,
		swaps,
		tvl,
		earning,
	};
}

async function dashboardData() {
	try {
		const txs = await getTxs();
		const addresses = await getAddresses();
		const blockHeight = await getRPCLastBlockHeight();
		const runeSupply = await getSupplyRune();
		const lastBlockHeight = await getLastBlockHeight();
		const stats = await getStats();

		return {
			txs: txs.data,
			addresses: addresses.data,
			blockHeight: blockHeight.data,
			runeSupply: runeSupply.data,
			lastBlockHeight: lastBlockHeight.data,
			stats: stats.data,
		};
	} catch (e) {
		console.error(e);
	}
}

async function chainsHeight() {
	const { data: nodes } = await getNodes();
	const nodeObservedChains = nodes
		.filter((n) => n.status === 'Active')
		.map((n) => n.observe_chains);

	let maxChainHeights = {};
	for (const node of nodeObservedChains) {
		for (const observedChain of node) {
			if (
				!maxChainHeights.hasOwnProperty(observedChain['chain']) ||
        observedChain['height'] >= maxChainHeights[observedChain['chain']]
			) {
				maxChainHeights[observedChain['chain']] = observedChain['height'];
			}
		}
	}

	const { data: heights } = await getRPCLastBlockHeight();
	maxChainHeights['THOR'] = +heights?.block?.header?.height;

	return maxChainHeights;
}

async function extraNodesInfo() {
	const { data: nodes } = await getNodes();
	const chunks = chunk(
		nodes.filter((n) => n.ip_address).map((n) => n.ip_address),
		100
	);

	let nodeInfo = {};
	for (let ipchunk of chunks) {
		let { data } = await axios.post('http://ip-api.com/batch', ipchunk);
		data.forEach((d) => {
			try {
				nodeInfo[d.query] = d;
			} catch (error) {
				console.error('got an error on assigning: ', d);
			}
		});
	}

	return nodeInfo;
}

async function OHCLprice() {
	let { data } = await axios.get(
		'https://node-api.flipsidecrypto.com/api/v2/queries/1aaa2137-b392-40a1-a9ce-22512f02d722/data/latest'
	);

	let chartData = [];

	let lastDate = undefined;
	let sameDay = [];

	data.forEach((interval) => {
		let date = dayjs(interval.DATE);
		if (!lastDate) {
			lastDate = date;
		}
		if (date.isSame(lastDate, 'day')) {
			sameDay.push({ date, price: interval.DAILY_RUNE_PRICE });
		} else {
			let minPrice = Math.min.apply(
				Math,
				sameDay.map((d) => d.price)
			);
			let maxPrice = Math.max.apply(
				Math,
				sameDay.map((d) => d.price)
			);
			let closePrice = sameDay[0].price;
			let openPrice = sameDay[0].price;
			let minM = sameDay[0].date;
			let maxM = sameDay[0].date;
			let vol = 0;

			sameDay.forEach((d) => {
				if (d.date.isBefore(minM)) {
					minM = d.date;
					openPrice = d.price;
				}
				if (d.date.isAfter(maxM)) {
					maxM = d.date;
					closePrice = d.price;
				}
				if (d.vol) {
					vol = d.vol;
				}
			});

			chartData.push({
				date: dayjs(date).format('YY/MM/DD'),
				prices: [openPrice, closePrice, minPrice, maxPrice],
				volume: vol,
			});

			// add the new date
			lastDate = undefined;
			sameDay = [];
			sameDay.push({
				date,
				price: interval.DAILY_RUNE_PRICE,
				vol: interval.TOTAL_SWAP_VOLUME_USD,
			});
		}
	});

	return chartData;
}

const getSaversCount = async (pool, height) => {
	let savers = (
		await axios.get(
			`${
				endpoints[process.env.NETWORK].V1_THORNODE
			}/thorchain/pool/${pool}/savers` + (height ? `?height=${height}` : '')
		)
	).data;
	return savers.length;
};

const getPools = async (height) => {
	let { data } = await axios.get(
		`${endpoints[process.env.NETWORK].THORNODE_URL}thorchain/pools` +
      (height ? `?height=${height}` : '')
	);
	return data.filter((x) => x.status == 'Available');
};

const getOldPools = async (height) => {
	let { data } = await axios.get(
		`${endpoints[process.env.NETWORK].V1_THORNODE}thorchain/pools` +
      (height ? `?height=${height}` : '')
	);
	return data.filter((x) => x.status == 'Available');
};

const getOldSaversExtra = async () => {
	const height = (await getRPCLastBlockHeight()).data.block.header.height;
	const heightBefore = height - (24 * 60 * 60) / 6;
	return await getSaversExtra(heightBefore);
};

const convertPoolNametoSynth = (poolName) => {
	return poolName.toLowerCase().replace('.', '/');
};

async function getSaversExtra(height) {
	if (!height)
		height = (await getRPCLastBlockHeight()).data.block.header.height;

	const pools = await getPools(height);
	const midgardPools = (await getMidgardPools()).data;
	const synthCap = (await getMimir()).data.MAXSYNTHPERPOOLDEPTH;
	const heightWeekAgo = height - (7 * 24 * 60 * 60) / 6;
	const oldPools = await getOldPools(heightWeekAgo);

	const synthSupplies = (await getAssets()).data.supply;

	const earned = (await getEarnings()).data;
	const deltaEarned = (await getEarnings('day', '1')).data;

	const saversPool = {};
	for (let pool of pools) {
		if (pool.savers_depth == 0) {
			continue;
		}

		let oldPool = oldPools.find((p) => p.asset === pool.asset);

		let saverReturn = 0;
		if (oldPool) {
			let saverBeforeGrowth = oldPool.savers_depth / oldPool.savers_units;
			let saverGrowth = pool.savers_depth / pool.savers_units;
			saverReturn =
				((saverGrowth - saverBeforeGrowth) / saverBeforeGrowth) * (365 / 7);
		}


		let saversCount = await getSaversCount(pool.asset, height);

		let filled = 0;
		let saverCap = ((2 * +synthCap) / 10e3) * pool.balance_asset;
		let synthSupply = synthSupplies.find(
			(a) => a.denom === convertPoolNametoSynth(pool.asset)
		)?.amount;
		if (synthSupply) {
			filled = synthSupply / saverCap;
		} else {
			filled = pool.savers_depth / saverCap;
		}
		let assetPrice = midgardPools.find(
			(p) => p.asset === pool.asset
		).assetPriceUSD;

		saversPool[pool.asset] = {
			asset: pool.asset,
			filled,
			saversCount,
			saverReturn,
			earned: earned.meta.pools.find((p) => p.pool === pool.asset).saverEarning,
			deltaEarned: deltaEarned.meta.pools.find((p) => p.pool === pool.asset)
				.saverEarning,
			assetPrice,
			saversDepth: pool.savers_depth,
			assetDepth: pool.balance_asset,
			...(synthSupply && { synthSupply }),
		};
	}

	return saversPool;
}

function calcSaverReturn(
	saversDepth,
	saversUnits,
	oldSaversDepth,
	oldSaversUnits,
	period
) {
	let saverBeforeGrowth = +oldSaversDepth / +oldSaversUnits;
	let saverGrowth = +saversDepth / +saversUnits;
	return (
		((saverGrowth - saverBeforeGrowth) / saverBeforeGrowth) * (356 / period)
	);
}

async function getSaversInfo(height) {
	if (!height)
		height = (await getRPCLastBlockHeight()).data.block.header.height;

	const pools = (await getMidgardPools('7d')).data;
	const synthCap = (await getMimir()).data.MAXSYNTHPERPOOLDEPTH;

	const synthSupplies = (await getAssets()).data.supply;

	const earned = (await getEarnings()).data;
	const { intervals: earningsInterval } = (await getEarnings('day', '2')).data;

	const saversPool = {};
	for (let pool of pools) {
		if (pool.saversDepth == 0) {
			continue;
		}

		let { intervals: sI, meta: saversMeta } = (
			await getSaversHistory('day', '9', pool.asset)
		).data;

		let filled = 0;
		let saverCap = ((2 * +synthCap) / 10e3) * pool.assetDepth;
		let synthSupply = synthSupplies.find(
			(a) => a.denom === convertPoolNametoSynth(pool.asset)
		)?.amount;
		if (synthSupply) {
			filled = synthSupply / saverCap;
		} else {
			filled = pool.saversDepth / saverCap;
		}

		let { saversAPR, assetPriceUSD } = pools.find(
			(p) => p.asset === pool.asset
		);

		const oldSaversReturn = calcSaverReturn(
			sI[sI.length - 2].saversDepth,
			sI[sI.length - 2].saversUnits,
			sI[0].saversDepth,
			sI[0].saversUnits,
			7
		);

		saversPool[pool.asset] = {
			savers: {
				asset: pool.asset,
				saversCount: +saversMeta.endSaversCount,
				saversReturn: saversAPR,
				earned: earned.meta.pools.find((p) => p.pool === pool.asset)
					.saverEarning,
				filled,
				assetPriceUSD,
				saversDepth: +pool.saversDepth,
				assetDepth: +pool.assetDepth,
				...(synthSupply && { synthSupply }),
			},
			oldSavers: {
				saversDepth: +sI[sI.length - 2].saversDepth,
				saversUnits: +sI[sI.length - 2].saversUnits,
				saversCount: +sI[sI.length - 2].saversCount,
				earned: earningsInterval[0].pools.find((p) => p.pool === pool.asset)
					.saverEarning,
				saversReturn: oldSaversReturn,
			},
		};
	}

	return saversPool;
}

function createFromToParam(from, to) {
	return [
		{
			key: 'from',
			value: from
		},
		{
			key: 'to',
			value: to
		}
	];
}

async function getOldPoolsDVE() {
	let d = dayjs();
	const to = d.subtract(1, this.params.interval).unix();
	const from = d.subtract(2, this.params.interval).unix();
	return getPoolsDVEPeriod(from, to);
}

async function getPoolsDVE() {
	let d = dayjs();
	const to = d.unix();
	const from = d.subtract(1, this.params.interval).unix();
	return getPoolsDVEPeriod(from, to);
}

function wait(ms) {
	return new Promise( (resolve) => {setTimeout(resolve, ms)});
}

async function getPoolsDVEPeriod(from, to) {
	const poolRet = [];

	try {
		let TPools = (await getThorPools()).data.filter(
			(p) => p.status === 'Available' && +p.savers_depth > 0
		);
	
		let poolsEarnings = (await getEarningsParam(createFromToParam(from, to))).data.meta;
		for (let i = 0; i < TPools.length; i++) {
			const asset = TPools[i].asset;
			const poolSwapHistory = (await getPoolSwapHistoryParam([...createFromToParam(from, to), {key: 'pool', value: asset}])).data.meta;
			const depthHis = (await getDepthsHistoryParam(asset ,createFromToParam(from, to))).data.meta;
			const poolEarnings = poolsEarnings.pools.find(p => asset === p.pool);
			poolRet.push({
				...poolEarnings, 
				...depthHis, 
				swapVolume: poolSwapHistory.totalVolume, 
				swapFees: poolSwapHistory.totalFees,
				swapCount: poolSwapHistory.totalCount,
			});

			await wait(2000);
		}

		return {
			total: omit(poolsEarnings, 'pools'),
			pools: poolRet
		};

	} catch (error) {
		console.error(error);
		throw new error;
	}
}

module.exports = {
	dashboardData,
	dashboardPlots,
	extraNodesInfo,
	OHCLprice,
	getSaversInfo,
	getSaversExtra,
	getOldSaversExtra,
	chainsHeight,
	getPoolsDVE,
	getOldPoolsDVE
};
