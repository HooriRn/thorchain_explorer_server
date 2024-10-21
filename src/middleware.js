const {
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
	swapHistoryFrom,
	swapHistoryParams,
	getNetwork,
	earningsHistoryParams,
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
	getBorrowers,
	getAsgard,
	getBalance,
} = require('./thornode');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const Axios = require('axios');
const { omit, chunk, compact } = require('lodash');

const axios = Axios.create({
	timeout: 5000,
});

require('dotenv').config();
const { Flipside } = require('@flipsidecrypto/sdk');
const { modules } = require('../endpoints');
const { GetDerivedAsset, blockTime } = require('./util');
const { getTHORlastblock, getActions, getQuote, getTopSwaps } = require('./infra');
const {
	thorchainStatsDaily,
	feesVsRewardsMonthly,
	swapsCategoricalMonthly,
	affiliateSwapsByWallet,
	affiliateByWallet,
	dailyAffiliateMade,
} = require('./sql');
const moment = require('moment');
const { response } = require('express');
const { CEX_ADDRESSES } = require('./constants');
const flipside = new Flipside(
	process.env.FLIP_KEY,
	'https://api-v2.flipsidecrypto.xyz'
);

async function dashboardPlots() {
	const { data: LPChange } = await volumeHistory();
	const { data: swaps } = await swapHistory();
	await wait(2000);
	const { data: tvl } = await tvlHistory();
	const { data: earning } = await earningsHistory();
	await wait(2000);

	// ADD EOD volume
	const len = swaps.intervals.length;
	const { data: lastSwaps } = await swapHistoryFrom(
		swaps.intervals[len - 1].startTime
	);
	swaps.intervals[len - 1] = lastSwaps?.meta;

	const oldPeriodFunc = async (start, end) => {
		const oldPeriod = {
			from: +end.endTime - +end.startTime + +start.startTime,
			to: +start.endTime,
		};

		const {
			data: {
				meta: { totalVolumeUSD: oldPeriodData },
			},
		} = await swapHistoryParams(oldPeriod.from, oldPeriod.to);

		return +oldPeriodData;
	};

	await wait(2000);
	const oOne = (await oldPeriodFunc(swaps.intervals[len - 2], swaps.intervals[len - 1]));
	await wait(2000);
	const oTwo = (await oldPeriodFunc(swaps.intervals[len - 3], swaps.intervals[len - 1]));
	await wait(2000);
	const oThree = (await oldPeriodFunc(swaps.intervals[len - 4], swaps.intervals[len - 1]));
	await wait(2000);
	const oldPeriodVolume = (oOne + oTwo + oThree) / 3;
	const oldTotalAverage = swaps.intervals.slice(-4, -1).reduce((a, c) => a + +c.totalVolumeUSD, 0) / 3;
	const EODVolume = swaps.intervals[len - 1].totalVolumeUSD * oldPeriodVolume / (oldTotalAverage - oldPeriodVolume);
	swaps.intervals[len - 1].EODVolume = Math.floor(EODVolume);

	// ADD EOD Earnings
	const lenEarning = earning.intervals.length;
	const { data: lastEarning } = await getEarningsParam(
		[{
			key: 'from',
			value: earning.intervals[lenEarning - 1].startTime,
		}]
	);
	earning.intervals[lenEarning - 1] = lastEarning?.meta;

	const oldTVLFunc = async (start, end) => {
		const oldPeriod = {
			from: +end.endTime - +end.startTime + +start.startTime,
			to: +start.endTime,
		};

		const {
			data: {
				meta: {
					bondingEarnings: oldBondEarnings,
					liquidityEarnings: oldLiquidityEarnings 
				}
			},
		} = await getEarningsParam(createFromToParam(oldPeriod.from, oldPeriod.to));

		return {oldBondEarnings: +oldBondEarnings, oldLiquidityEarnings: +oldLiquidityEarnings};
	}

	await wait(2000);
	const tOne = (await oldTVLFunc(earning.intervals[len - 2], earning.intervals[len - 1]));
	await wait(2000);
	const tTwo = (await oldTVLFunc(earning.intervals[len - 3], earning.intervals[len - 1]));
	const oldPeriodBondEarning = (tOne.oldBondEarnings + tTwo.oldBondEarnings) / 2;
	const oldTotalBondEarnings = earning.intervals.slice(-3, -1).reduce((a, c) => a + +c.bondingEarnings, 0) / 2;
	const EODBondEarnings = earning.intervals[len - 1].bondingEarnings * oldPeriodBondEarning / (oldTotalBondEarnings - oldPeriodBondEarning);
	const oldPeriodLiquidityEarning = (tOne.oldLiquidityEarnings + tTwo.oldLiquidityEarnings) / 2;
	const oldTotalLiquidityEarnings = earning.intervals.slice(-3, -1).reduce((a, c) => a + +c.liquidityEarnings, 0) / 2;
	const EODLiquidityEarnings = earning.intervals[len - 1].liquidityEarnings * oldPeriodLiquidityEarning / (oldTotalLiquidityEarnings - oldPeriodLiquidityEarning);
	earning.intervals[len - 1].EODBondEarnings = Math.floor(EODBondEarnings);
	earning.intervals[len - 1].EODLiquidityEarnings = Math.floor(EODLiquidityEarnings);

	return {
		LPChange,
		swaps,
		tvl,
		earning,
	};
}

async function rawEarnings() {
	const { data } = await getEarnings()

	return data
}

async function dashboardData() {
	const txs = await getActions({
		limit: 10,
		asset: 'notrade',
	});
	const addresses = await getAddresses();
	const blockHeight = await getRPCLastBlockHeight();
	const runeSupply = await getSupplyRune();
	const lastBlockHeight = await getLastBlockHeight();
	const stats = await getStats();

	const to = moment().unix()
	const from = moment().subtract(1, 'days').unix()
	const {
		data: {
			meta: { totalVolumeUSD: volume24USD },
		},
	} = await swapHistoryParams(from, to);

	const {
		data: {
			meta: { earnings: earnings24, pools: poolsEarnings },
		},
	} = await earningsHistoryParams(from, to);

	return {
		txs: txs,
		addresses: addresses.data,
		blockHeight: blockHeight.data,
		runeSupply: runeSupply.data,
		lastBlockHeight: lastBlockHeight.data,
		stats: { 
			...stats.data,
			volume24USD,
			earnings24,
			devFundReward: poolsEarnings.find(p => p.pool === "dev_fund_reward"),
			incomeBurn: poolsEarnings.find(p => p.pool === 'income_burn')
		},
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

function getNodesMaxHeightOnChains(nodes) {
	const observedChains = compact(nodes.map(n => n.observe_chains))
	const maxObserevedChains = {}
	for (let i = 0; i < observedChains.length; i++) {
		const nodeChains = observedChains[i];
		for (let j = 0; j < nodeChains.length; j++) {
			const {chain, height} = nodeChains[j];
			if (!maxObserevedChains[chain] || maxObserevedChains[chain] < height) {
				maxObserevedChains[chain] = height
			}
		}	
	}

	return maxObserevedChains
}

async function nodesInfo() {
	const { data: nodes } = await getNodes();

	const nodesIPUrl = `http://0.0.0.0:${process.env.PORT}${process.env.NETWORK === 'stagenet' ? '/stage' : ''}/api/extraNodesInfo`
	const chainsHeightUrl = `http://0.0.0.0:${process.env.PORT}${process.env.NETWORK === 'stagenet' ? '/stage' : ''}/api/chainsHeight`
	const {data: nodesIP } = await axios.get(nodesIPUrl)
	const {data: heights } = await axios.get(chainsHeightUrl)
	const {data: vaults} = await getAsgard()

	const vaultKeys = vaults.map(v => v.pub_key)
	const maxObserevedChains = getNodesMaxHeightOnChains(nodes)
	const maxObserevedStandby = getNodesMaxHeightOnChains(nodes.filter(n => n.status === 'Standby'))

	const {CHURNINTERVAL, HALTCHURNING, MINIMUMBONDINRUNE} = (await getMimir()).data
	const {nextChurnHeight} = (await getNetwork()).data
	const churnsInYear = 365 / ((6 * CHURNINTERVAL) / (60 * 60 * 24))
	const ratioReward = (CHURNINTERVAL - (+nextChurnHeight - heights.THOR)) / CHURNINTERVAL
	
	let scannerEndpoints = nodes.filter(n => +n.total_bond > 300000 * 1e8).map(n => `http://${n.ip_address}:6040/status/scanner`)

	let scannerStatus = []
	await Promise.allSettled(scannerEndpoints.map((promise) => axios.get(promise)))
		.then((res) => {
			const fulfilled = res.filter(d => d.status === 'fulfilled').map(d => d.value);
			fulfilled.map(d => {
				scannerStatus[d.request.host] = d.data
			})
		})
		.catch((res) => console.error(res));

	const ret = nodes.map(n => {
		// IP
		let nIP = {}
		if (nodesIP[n.ip_address]) {
			nIP = nodesIP[n.ip_address]
		}
		// Behind
		let chains = {}
		let max = n.status === 'Active' ? maxObserevedChains : maxObserevedStandby
		n?.observe_chains?.forEach(o => {
			chains[o.chain] = max[o.chain] - o.height
		})
		// Age
		const ageDays = heights.THOR - n.status_since
		const age = {
			number: (ageDays * 6) / (60 * 60 * 24),
			info: blockTime(ageDays)
		}
		// APY
		const APY = ((n.current_award / ratioReward) * churnsInYear) / n.total_bond ?? null
		// Vault Membership
		let vaultMembership = null
		for (let vi = 0; vi < vaultKeys.length; vi++) {
			const e = vaultKeys[vi];
			const membership = n.signer_membership.find(v => v === e)
			if (membership) {
				vaultMembership = membership
			}
		}

		if (scannerStatus[n.ip_address]) {
			for (const [chain, value] of Object.entries(scannerStatus[n.ip_address])) {
				chains[chain] = value.scanner_height_diff
			}
		}

		return {
			...n,
			age,
			apy: APY,
			city: nIP.city,
			isp: nIP.isp,
			org: nIP.org,
			country: nIP.country,
			countryCode: nIP.countryCode,
			behind: chains ? chains : null,
			scanner: scannerStatus[n.ip_address] ?? null,
			vaultMembership
		}
	})	

	return ret
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
	console.log(data)
	return data.records;
}

async function AffiliateByWallet() {
	let sql = affiliateByWallet;

	let data = await flipside.query.run({ sql: sql });
	return data.records;
}

async function AffiliateDaily() {
	let sql = dailyAffiliateMade;

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
			value: from,
		},
		{
			key: 'to',
			value: to,
		},
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
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function getPoolsDVEPeriod(from, to) {
	const poolRet = [];

	let TPools = (await getThorPools()).data.filter(
		(p) => p.status === 'Available'
	);

	await wait(3000);
	let poolsEarnings = (await getEarningsParam(createFromToParam(from, to))).data
		.meta;
	console.log('Got earnings...');
	for (let i = 0; i < TPools.length; i++) {
		const asset = TPools[i].asset;
		const poolSwapHistory = (
			await getPoolSwapHistoryParam([
				...createFromToParam(from, to),
				{ key: 'pool', value: asset },
			])
		).data.meta;
		console.log('Got swap history...', asset);
		await wait(2000);
		const depthHis = (
			await getDepthsHistoryParam(asset, createFromToParam(from, to))
		).data.meta;
		console.log('Got depth history...', asset);
		await wait(2000);
		const poolEarnings = poolsEarnings.pools.find((p) => asset === p.pool);
		poolRet.push({
			...poolEarnings,
			...depthHis,
			swapVolume: poolSwapHistory.totalVolume,
			swapFees: poolSwapHistory.totalFees,
			swapCount: poolSwapHistory.totalCount,
			timestamp: to,
		});
	}

	return {
		total: omit(poolsEarnings, 'pools'),
		pools: poolRet,
	};
}

function parseMemberDetails(pools) {
	return pools.map((p) => ({
		...p,
		poolAdded: [p.runeAdded / 100000000, p.assetAdded / 100000000],
		poolWithdrawn: [p.runeWithdrawn / 100000000, p.assetWithdrawn / 100000000],
		dateFirstAdded: p.dateFirstAdded,
		share: 0,
		luvi: 0,
		poolShare: [],
	}));
}

function findShare(pools, memberDetails, lps) {
	memberDetails.forEach((m, i) => {
		const poolDetail = pools.find((p) => p.asset === m.pool);
		const share = m.liquidityUnits / poolDetail.units;
		const runeAmount = share * poolDetail.runeDepth;
		const assetAmount = share * poolDetail.assetDepth;
		lps[i].share = share;
		lps[i].poolShare.push(+runeAmount / 10e7, +assetAmount / 10e7);
	});
}

async function getRunePools() {
	const {
		data: { pools: memberDetails },
	} = await getMemberDetails(modules[process.env.NETWORK].RESERVE_MODULE);
	const lps = parseMemberDetails(memberDetails);
	const { data: pools } = await getPools();
	findShare(pools, memberDetails, lps);

	for (const poolData of memberDetails) {
		const { data: thorData } = await getLpPositions(
			poolData.pool,
			modules[process.env.NETWORK].RESERVE_MODULE
		);
		let i = lps.findIndex((p) => p.pool === poolData.pool);
		lps[i] = {
			...lps[i],
			luvi: thorData.luvi_growth_pct,
			...thorData,
		};
	}

	return lps;
}

async function oldRunePool() {
	const { data: rpcLastHeight } = await getRPCLastBlockHeight();

	const height = +rpcLastHeight?.block?.header?.height;
	return (await getThorRunePool(+height - 24 * 60 * 10)).data;
}

async function RUNEPoolProviders(height, old) {
	if (old) {
		height = +height - 24 * 60 * 10;
	}

	const rp = (await getThorRuneProviders(height)).data;

	const ret = rp.reduce(
		(a, c) => {
			const depositedTime = (height - c.last_deposit_height) * 6;
			let apy = 0;
			let deposit = 0;
			if (depositedTime / (24 * 60 * 60) >= 1) {
				const returnRate = +c.pnl / +c.deposit_amount;
				const ppy = (365 * 24 * 60 * 60) / depositedTime;
				const periodicRate = returnRate / ppy;
				apy = Math.pow(1 + periodicRate, ppy) - 1;
				deposit = +c.deposit_amount;
			}

			return {
				pnl: +a.pnl + +c.pnl,
				count: a.count + 1,
				deposit: +a.deposit + deposit,
				annualRate: apy * +c.deposit_amount + +a.annualRate,
			};
		},
		{
			pnl: 0,
			count: 0,
			deposit: 0,
			annualRate: 0,
		}
	);

	return {
		...ret,
		cumlativeAPY: ret.annualRate / ret.deposit,
	};
}

async function getOldRuneProviders() {
	const { data: rpcLastHeight } = await getRPCLastBlockHeight();

	const height = +rpcLastHeight?.block?.header?.height;
	return await RUNEPoolProviders(height, true);
}

async function getRuneProviders() {
	const { data: rpcLastHeight } = await getRPCLastBlockHeight();

	const height = +rpcLastHeight?.block?.header?.height;
	return await RUNEPoolProviders(height, false);
}

async function getLendingInfo() {
	const { data: mimirs } = await getMimir();
	const { data: pools } = await getThorPools();
	const { data: torPool } = await getDerivedPoolDetail('THOR.TOR');
	const { data: supplies } = await getSupplyRune();

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
	availablePools.forEach((e) => (derivedPools[e] = GetDerivedAsset(e)));

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
	const totalRuneForProtocol =
    ((mimirs.LENDINGLEVER ?? 3333) / 10000) *
    (maxRuneSupply - currentRuneSupply);

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

		const collateralPoolInRune =
      poolData.loan_collateral *
      (+poolData.balance_rune / +poolData.balance_asset);
		bs.map((b) => ({
			...b,
			collateral: +b.collateral_current,
			debt: +b.debt_current,
		}));

		const res = bs.reduce(
			(ac, cv) => ({
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
			availableRune:
        (poolData.balance_rune / totalBalanceRune) * totalRuneForProtocol,
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

async function getCoinMarketCapInfo() {
	const response = await axios.get('https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest', {
		headers: {
			'X-CMC_PRO_API_KEY': process.env.COIN_CAP,
		},
		params: {
			slug: 'thorchain'
		}
	});
	return (response.data.data["4157"])
}

async function getNetworkAllocation() {
	const cex_balances = {cexs: [], total: 0}
	for(const [address, name] of Object.entries(CEX_ADDRESSES)) {
		const balance = +(await getBalance(address)).find(b => b.denom === 'rune')?.amount
		cex_balances.cexs.push({
			name,
			balance
		})
		cex_balances.total += balance
	}

	return cex_balances
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
	AffiliateSwapsByWallet,
	AffiliateByWallet,
	AffiliateDaily,
	getActions,
	getCoinMarketCapInfo,
	nodesInfo,
	getQuote,
	getTopSwaps,
	rawEarnings,
	getNetworkAllocation
};
