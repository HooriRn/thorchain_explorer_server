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
	getMemberDetails,
	swapHistoryFrom
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
	getThorRunePool,
	getThorRuneProviders,
	getDerivedPoolDetail,
	getBorrowers
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
const { GetDerivedAsset } = require('./util');
const { getTHORlastblock } = require('./infra');
const { thorchainStatsDaily, feesVsRewardsMonthly, swapsCategoricalMonthly, affiliateSwapsByWallet } = require('./sql');
const flipside = new Flipside(
	process.env.FLIP_KEY,
	'https://api-v2.flipsidecrypto.xyz'
);

async function dashboardPlots() {
	const { data: LPChange } = await volumeHistory();
	const { data: swaps } = await swapHistory();
	const { data: tvl } = await tvlHistory();
	const { data: earning } = await earningsHistory();
	
	const len = swaps.intervals.length;
	const {data: lastSwaps} = await swapHistoryFrom(swaps.intervals[len - 1].startTime);
	swaps.intervals[len - 1] = lastSwaps?.meta;

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

async function SwapQuery() {
	let sql = swapsCategoricalMonthly;

	let data = await flipside.query.run({ sql: sql });

	return data.records;
}

async function ThorchainStatsDaily() {
	let sql = thorchainStatsDaily;

	let data = await flipside.query.run({ sql: sql });
	return data.records;
}

async function FeesRewardsMonthly() {
	let sql = feesVsRewardsMonthly;

	let data = await flipside.query.run({ sql: sql });
	return data.records;
}

async function AffiliateSwapsByWallet() {
	let sql = affiliateSwapsByWallet;

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

async function RUNEPoolProviders(height, old) {
	if (old) {
		height = +height - 24 * 60 * 10;
	}

	const rp = (await getThorRuneProviders(height)).data;

	const ret = rp.reduce((a, c) => {
		const depositedTime = ((height - c.last_deposit_height) * 6); 
		let apy = 0;
		let deposit = 0;
		if ((depositedTime / (24 * 60 * 60)) >= 1) {
			const returnRate = +c.pnl / +c.deposit_amount;
			const ppy = (365 * 24 * 60 * 60) / (depositedTime);
			const periodicRate = returnRate / ppy;
			apy = Math.pow((1 + periodicRate), ppy) - 1;
			deposit = +c.deposit_amount;
		}
		
		return {
			pnl: +a.pnl + +c.pnl,
			count: a.count + 1,
			deposit: +a.deposit + deposit,
			annualRate: (apy * +c.deposit_amount) + +a.annualRate
		};
	}, {
		pnl: 0, count: 0, deposit: 0, annualRate: 0
	});

	return {
		...ret,
		cumlativeAPY: ret.annualRate / ret.deposit
	};
}

async function getOldRuneProviders() {
	const { data: rpcLastHeight } = (await getRPCLastBlockHeight());

	const height = +rpcLastHeight?.block?.header?.height;
	return (await RUNEPoolProviders(height, true));
}

async function getRuneProviders() {
	const { data: rpcLastHeight } = (await getRPCLastBlockHeight());

	const height = +rpcLastHeight?.block?.header?.height;
	return (await RUNEPoolProviders(height, false));
}



async function getLendingInfo() {
	const { data: mimirs } = await getMimir();
	const { data: pools } = await getThorPools();
	const { data: torPool } = await getDerivedPoolDetail('THOR.TOR');
	const { data: supplies } =  await getSupplyRune();

	const availablePools = [
		'BTC.BTC',
		'ETH.ETH',
		'AVAX.AVAX',
		'GAIA.ATOM',
		'BNB.BNB',
		'BCH.BCH',
		'DOGE.DOGE',
	];

	const derivedPools = {};
	availablePools.forEach(e => derivedPools[e] = GetDerivedAsset(e));

	const lendingPools = [];
	for (let k in derivedPools) {
		if (mimirs[`LENDING-${derivedPools[k].replace('.', '-')}`] === 1) {
			lendingPools.push(k);
		}
	}
	
	const currentRuneSupply = supplies?.amount?.amount;
	const totalBalanceRune = pools
		.filter((e) => lendingPools.includes(e.asset))
		.map((e) => e.balance_rune)
		.reduce((a, c) => a + +c, 0);

	const maxRuneSupply = mimirs.MAXRUNESUPPLY ?? 50000000000000000;
	const totalRuneForProtocol = ((mimirs.LENDINGLEVER ?? 3333) / 10000) * (maxRuneSupply - currentRuneSupply);

	const borrowers = [];
	for (const p of lendingPools) {
		const { data: bs } = await getBorrowers(p);
		const poolData = pools.find((e) => e.asset === p);
		
		if (!poolData) {
			continue;
		}
		if (!bs || poolData.loan_collateral === '0') {
			continue;
		}
		
		const collateralPoolInRune = poolData.loan_collateral * (+poolData.balance_rune / +poolData.balance_asset);
		bs.map((b) => ({
			...b,
			collateral: +b.collateral_current,
			debt: +b.debt_current,
		}));
		
		const res = bs.reduce(
			(ac, cv) => 
				({
					debt: ac.debt + +cv.debt_current,
					borrowersCount: ac.borrowersCount + 1,
				}),
			{
				collateral: 0,
				debt: 0,
				borrowersCount: 0,
			}
		);


		borrowers.push({
			...res,
			collateral: poolData.loan_collateral,
			pool: poolData.asset,
			availableRune: (poolData.balance_rune / totalBalanceRune) * totalRuneForProtocol,
			fill:
				collateralPoolInRune /
				((poolData.balance_rune / totalBalanceRune) * totalRuneForProtocol),
			collateralPoolInRune,
			debtInRune: res.debt * (torPool.balance_rune / torPool.balance_asset),
			collateralAvailable: poolData.loan_collateral_remaining,
		});
	}

	return borrowers;
}

module.exports = {
	dashboardData,
	dashboardPlots,
	extraNodesInfo,
	getSaversInfo,
	chainsHeight,
	getPoolsDVE,
	getOldPoolsDVE,
	wait,
	getRunePools,
	oldRunePool,
	getOldRuneProviders,
	getRuneProviders,
	getLendingInfo,
	getTHORlastblock,
	SwapQuery,
	ThorchainStatsDaily,
	FeesRewardsMonthly,
	AffiliateSwapsByWallet
};
