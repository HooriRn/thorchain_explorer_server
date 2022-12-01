/* eslint-disable no-unused-vars */
const axios = require('axios');
const { endpoints } = require('../endpoints');
require('dotenv').config();

const axiosInstace = axios.create({
	baseURL: endpoints[process.env.NETWORK].THORNODE_URL,
	timeout: 20000,
});

function getMimir() {
	return axiosInstace.get('thorchain/mimir');
}

function getBalance(address) {
	return axiosInstace.get(
		`bank/balances/${address}`
	);
}

function getLastBlockHeight() {
	return axiosInstace.get('thorchain/lastblock');
}

function getRPCLastBlockHeight() {
	return axiosInstace.get('blocks/latest');
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

function getLpPositions(poolName) {
	return axiosInstace.get(
		`thorchain/pool/${poolName}/liquidity_providers`
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

function getThorPools() {
	return axiosInstace.get('thorchain/pools');
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
		'thorchain/nodes'
	);
}

function getConstants() {
	return axiosInstace.get(
		'thorchain/constants'
	);
}

module.exports = {
	getAddresses,
	getRPCLastBlockHeight,
	getSupplyRune,
	getLastBlockHeight,
	getNodes,
	getConstants
};
