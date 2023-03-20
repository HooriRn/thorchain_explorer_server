/* eslint-disable no-unused-vars */
const axios = require('axios');
const { endpoints } = require('../endpoints');
require('dotenv').config();

const axiosInstace = axios.create({
	baseURL: endpoints[process.env.NETWORK].MIDGARD_BASE_URL,
	timeout: 20000,
});

const axiosRetry = require('axios-retry');
axiosRetry(axiosInstace, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

function getStats() {
	return axiosInstace.get('stats');
}

function getTxs(offset = 0, limit = 10, type = undefined) {
	const params = {
		offset,
		limit,
	};

	if (type) params['type'] = type;

	return axiosInstace.get('actions', { params });
}

function getConstants() {
	return axiosInstace.get('thorchain/constants');
}

function getTx(txid, limit = 10) {
	const params = {
		offset: 0,
		limit,
		txid,
	};

	return axiosInstace.get('actions', { params });
}

function getAddress(address, offset = 0, limit = 10) {
	const params = {
		offset,
		limit,
		address,
	};

	return axiosInstace.get('actions', { params });
}

function getPoolTxs(poolName, offset = 0, limit = 10) {
	const params = {
		offset,
		limit,
		asset: poolName,
	};

	return axiosInstace.get('actions', { params });
}

function getPoolStats(poolName) {
	return axiosInstace.get(`pool/${poolName}/stats`);
}

function volumeHistory() {
	return axiosInstace.get('history/liquidity_changes?interval=day&count=30');
}

function swapHistory() {
	return axiosInstace.get('history/swaps?interval=day&count=30');
}

function tvlHistory() {
	return axiosInstace.get('history/tvl?interval=day&count=30');
}

function getLastTvl() {
	return axiosInstace.get('history/tvl');
}

function earningsHistory() {
	return axiosInstace.get('history/earnings?interval=day&count=30');
}

function getPoolVolume(poolName) {
	return axiosInstace.get(
		`history/liquidity_changes?pool=${poolName}&interval=day&count=30`
	);
}

async function getLatestBlocks(latestBlock, count = 10) {
	if (!latestBlock) {
		return;
	}

	let axiosUrls = [...Array(latestBlock + 1).keys()]
		.slice(-1 * count)
		.map((b) => `debug/block/${b}`);

	let res = await Promise.all(
		axiosUrls.map((url) => axiosInstace.get(url))
	).then((data) => {
		let datum = [];
		for (let d of data) {
			datum.push(d.data);
		}
		return datum;
	});
	return res;
}

function getRevThorname(address) {
	return axiosInstace.get(`thorname/rlookup/${address}`);
}

function getMidgardPools() {
	return axiosInstace.get('pools');
}

function getEarnings(interval, count) {
	const intervalParam = `interval=${interval}`;
	const countParam = `count=${count}`;

	let param = '';
	if (interval && count) {
		param = `?${intervalParam}&${countParam}`;
	}

	return axiosInstace.get('history/earnings' + param);
}

module.exports = {
	getTxs,
	getStats,
	volumeHistory,
	swapHistory,
	tvlHistory,
	earningsHistory,
	getMidgardPools,
	getEarnings
};
