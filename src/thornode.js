/* eslint-disable no-unused-vars */
const Axios = require('axios');
const { endpoints } = require('../endpoints');
require('dotenv').config();

// Axios configs
const axios = Axios.create({
	baseURL: endpoints[process.env.NETWORK].THORNODE_URL,
	timeout: 20000,
});

const { setupCache } = require('axios-cache-interceptor');
var axiosInstace = setupCache(axios);

const axiosRetry = require('axios-retry');
axiosRetry(axiosInstace, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

// Requests
function getMimir() {
	return axiosInstace.get('thorchain/mimir');
}

function getBalance(address) {
	return axiosInstace.get(
		`bank/balances/${address}`
	);
}

function getLastBlockHeight() {
	return axiosInstace.get(
		'thorchain/lastblock',
		{
			cache: {
				ttl: 1000
			}
		}
	);
}

function getRPCLastBlockHeight() {
	return axiosInstace.get(
		'blocks/latest',
		{
			cache: {
				ttl: 1000
			}
		}
	);
}

function getNativeTx(txID) {
	return axiosInstace.get(
		`cosmos/tx/v1beta1/txs/${txID}`
	);
}

function getThorNetwork() {
	return axiosInstace.get('thorchain/network');
}

function getInboundAddresses() {
	return axiosInstace.get(
		'thorchain/inbound_addresses'
	);
}

function getMimirVotes() {
	return axiosInstace.get(
		'thorchain/mimir/nodes_all'
	);
}

function getLpPositions(poolName, address) {
	return axiosInstace.get(
		`thorchain/pool/${poolName}/liquidity_provider/${address}`
	);
}

function getPoolDetail(poolName) {
	return axiosInstace.get(
		`thorchain/pool/${poolName}`
	);
}

function getAssets() {
	return axiosInstace.get(
		'cosmos/bank/v1beta1/supply'
	);
}

function getSupplyRune() {
	return axiosInstace.get(
		'cosmos/bank/v1beta1/supply/rune'
	);
}

function getThorPools(height) {
	return axiosInstace.get('thorchain/pools' + (height ? `?height=${height}` : ''));
}

function getYggdrasil() {
	return axiosInstace.get(
		'thorchain/vaults/yggdrasil'
	);
}

function getAsgard() {
	return axiosInstace.get('thorchain/vaults/asgard');
}

function getAddresses() {
	return axiosInstace.get(
		'cosmos/auth/v1beta1/accounts'
	);
}

function getOutbound() {
	return axiosInstace.get(
		'thorchain/queue/outbound'
	);
}

function getNodes() {
	return axiosInstace.get(
		'thorchain/nodes',
		{
			cache: {
				ttl: 1000 * 30
			}
		}
	);
}

function getConstants() {
	return axiosInstace.get(
		'thorchain/constants'
	);
}

function getThorRunePool(height) {
	return axiosInstace.get(
		'thorchain/runepool' +
		(height ? `?height=${height}` : '')
	);
}

function getThorRuneProviders(height) {
	return axiosInstace.get(
		'thorchain/rune_providers' +
		(height ? `?height=${height}` : '')
	);
}

module.exports = {
	getAddresses,
	getRPCLastBlockHeight,
	getSupplyRune,
	getAssets,
	getLastBlockHeight,
	getNodes,
	getConstants,
	getMimir,
	getThorPools,
	getLpPositions,
	getThorRunePool,
	getThorRuneProviders
};
