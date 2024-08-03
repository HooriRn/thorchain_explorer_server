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
	getPools,
	getPoolSwapHistoryParam,
	getDepthsHistoryParam,
	getMemberDetails
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
	getLpPositions,
	getThorRunePool
} = require('./thornode');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const { default: axios } = require('axios');
const axiosRetry = require('axios-retry');
const { omit, chunk } = require('lodash');

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

require('dotenv').config();
const { Flipside } = require('@flipsidecrypto/sdk');
const { modules } = require('../endpoints');
const flipside = new Flipside(
	process.env.FLIP_KEY,
	'https://api-v2.flipsidecrypto.xyz'
);

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

async function RunePrice() {
	let sql = `
	with 
	rdp AS (SELECT day as date, (((total_value_pooled_usd * 3/2) + total_value_bonded_usd) / 500000000)  AS deterministic_rune_price FROM thorchain.defi.fact_daily_tvl ORDER BY date),
	rp AS (SELECT time_slice(block_timestamp, 1, 'HOUR', 'START') as date, avg(price_asset_rune) as daily_rune_price from thorchain.price.fact_prices where pool_name='BNB.BUSD-BD1' group by date order by date)
	SELECT c.date, daily_rune_price, deterministic_rune_price from rdp as c inner join rp as e on c.date = e.date order by date
	`;

	let data = await flipside.query.run({ sql: sql });

	return data.records;
}

async function TVLHistoryQuery() {
	let sql = `
	SELECT DAY, TOTAL_VALUE_POOLED, TOTAL_VALUE_BONDED, TOTAL_VALUE_LOCKED FROM thorchain.defi.fact_daily_tvl ORDER BY DAY DESC;
	`;

	let data = await flipside.query.run({ sql: sql });

	return data.records;
}

async function ChurnHistoryQuery() {
	let sql = `
	WITH
	churn_blocks AS
	(
		SELECT DISTINCT block_timestamp, dim_block_id
		  FROM thorchain.defi.fact_update_node_account_status_events
	)
	, dim_convert AS (
	  SELECT dim_block_id, block_id
	  FROM thorchain.core.dim_block
	)
	SELECT block_timestamp, block_id,
	  ROUND((1/24) * DATEDIFF(hour, LAG(block_timestamp) OVER(ORDER BY block_id ASC), block_timestamp)) AS days_since_last_churn
	FROM (churn_blocks INNER JOIN dim_convert ON churn_blocks.dim_block_id = dim_convert.dim_block_id)
	ORDER BY block_timestamp DESC
	`;

	let data = await flipside.query.run({ sql: sql });

	return data.records;
}

async function SwapCountQuery() {
	let sql = `
	WITH swaps AS (SELECT day as date, SUM(swap_count) as swap_count, SUM(unique_swapper_count) as unique_swapers, ROW_NUMBER() OVER (ORDER BY date) as rownum FROM thorchain.defi.fact_daily_pool_stats Group BY day),
	culmulative AS (SELECT date, (SELECT SUM(swap_count) FROM swaps as b WHERE b.rownum <= a.rownum) as swap_count_cumulative,
		swap_count,
		unique_swapers
		FROM swaps as a)
	SELECT * FROM culmulative ORDER BY date
	`;

	let data = await flipside.query.run({ sql: sql });

	return data.records;
}

const convertPoolNametoSynth = (poolName) => {
	return poolName.toLowerCase().replace('.', '/');
};

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

async function getSaversInfo() {

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

		await wait(2000);
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
	let d = dayjs().utc().startOf('day');
	const to = d.subtract(1, this.params.interval).unix();
	const from = d.subtract(2, this.params.interval).unix();
	return await getPoolsDVEPeriod(from, to);
}

async function getPoolsDVE() {
	let d = dayjs().utc().startOf('day');
	const to = d.unix();
	const from = d.subtract(1, this.params.interval).unix();
	return await getPoolsDVEPeriod(from, to);
}

function wait(ms) {
	return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function getPoolsDVEPeriod(from, to) {
	const poolRet = [];

	let TPools = (await getThorPools()).data.filter(
		(p) => p.status === 'Available'
	);

	await wait(3000);
	let poolsEarnings = (await getEarningsParam(createFromToParam(from, to))).data.meta;
	console.log('Got earnings...');
	for (let i = 0; i < TPools.length; i++) {
		const asset = TPools[i].asset;
		const poolSwapHistory = (await getPoolSwapHistoryParam([...createFromToParam(from, to), { key: 'pool', value: asset }])).data.meta;
		console.log('Got swap history...', asset);
		await wait(2000);
		const depthHis = (await getDepthsHistoryParam(asset, createFromToParam(from, to))).data.meta;
		console.log('Got depth history...', asset);
		await wait(2000);
		const poolEarnings = poolsEarnings.pools.find(p => asset === p.pool);
		poolRet.push({
			...poolEarnings,
			...depthHis,
			swapVolume: poolSwapHistory.totalVolume,
			swapFees: poolSwapHistory.totalFees,
			swapCount: poolSwapHistory.totalCount,
			timestamp: to
		});
	}

	return {
		total: omit(poolsEarnings, 'pools'),
		pools: poolRet
	};

}

function parseMemberDetails(pools) {
	return pools.map(p => ({
		...p,
		poolAdded: [p.runeAdded / 100000000, p.assetAdded / 100000000],
		poolWithdrawn: [p.runeWithdrawn / 100000000, p.assetWithdrawn / 100000000],
		dateFirstAdded: p.dateFirstAdded,
		share: 0,
		luvi: 0,
		poolShare: []
	}));
}

function findShare(pools, memberDetails, lps) {
	memberDetails.forEach((m, i) => {
		const poolDetail = pools.find(p => p.asset === m.pool);
		const share = m.liquidityUnits / poolDetail.units;
		const runeAmount = share * poolDetail.runeDepth;
		const assetAmount = share * poolDetail.assetDepth;
		lps[i].share = share;
		lps[i].poolShare.push(+runeAmount / 10e7, +assetAmount / 10e7);
	});
}

async function getRunePools() {
	const { data: { pools: memberDetails } } = await getMemberDetails(modules[process.env.NETWORK].RESERVE_MODULE);
	const lps = parseMemberDetails(memberDetails);
	const { data: pools } = await getPools();
	findShare(pools, memberDetails, lps);

	for (const poolData of memberDetails) {
		const { data: thorData } = await getLpPositions(poolData.pool, modules[process.env.NETWORK].RESERVE_MODULE);
		let i = lps.findIndex(p => p.pool === poolData.pool);
		lps[i] = {
			...(lps[i]),
			luvi: thorData.luvi_growth_pct,
			...thorData
		};
	}

	return lps;
}

async function oldRunePool() {
	const { data: rpcLastHeight } = (await getRPCLastBlockHeight());

	const height = +rpcLastHeight?.block?.header?.height;
	return (await getThorRunePool(+height - 24 * 60 * 10 )).data;
}


module.exports = {
	dashboardData,
	dashboardPlots,
	extraNodesInfo,
	RunePrice,
	SwapCountQuery,
	TVLHistoryQuery,
	ChurnHistoryQuery,
	getSaversInfo,
	chainsHeight,
	getPoolsDVE,
	getOldPoolsDVE,
	wait,
	getRunePools,
	oldRunePool
};
