const axios = require("axios");
require('dotenv').config();

const axiosInstace = axios.create({
  baseURL: process.env.THORNODE_URL,
  timeout: 20000,
});

function getMimir() {
  return axiosInstace.get(process.env.THORNODE_URL + "thorchain/mimir");
}

function getBalance(address) {
  return axiosInstace.get(
    process.env.THORNODE_URL + `bank/balances/${address}`
  );
}

function getLastBlockHeight() {
  return axiosInstace.get(process.env.THORNODE_URL + "thorchain/lastblock");
}

function getRPCLastBlockHeight() {
  return axiosInstace.get(process.env.THORNODE_URL + "blocks/latest");
}

function getNativeTx(txID) {
  return axiosInstace.get(
    process.env.THORNODE_URL + `cosmos/tx/v1beta1/txs/${txID}`
  );
}

function getThorNetwork() {
  return axiosInstace.get(process.env.THORNODE_URL + `thorchain/network`);
}

function getInboundAddresses() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/inbound_addresses`
  );
}

function getMimirVotes() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/mimir/nodes_all`
  );
}

function getLpPositions(poolName) {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/pool/${poolName}/liquidity_providers`
  );
}

function getPoolDetail(poolName) {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/pool/${poolName}`
  );
}

function getAssets() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `cosmos/bank/v1beta1/supply`
  );
}

function getSupplyRune() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `cosmos/bank/v1beta1/supply/rune`
  );
}

function getThorPools() {
  return axiosInstace.get(process.env.THORNODE_URL + `thorchain/pools`);
}

function getYggdrasil() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/vaults/yggdrasil`
  );
}

function getAsgard() {
  return axiosInstace.get(process.env.THORNODE_URL + `thorchain/vaults/asgard`);
}

function getAddresses() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `cosmos/auth/v1beta1/accounts`
  );
}

function getOutbound() {
  return axiosInstace.get(
    process.env.THORNODE_URL + `thorchain/queue/outbound`
  );
}

module.exports = {
  getAddresses,
  getRPCLastBlockHeight,
  getSupplyRune,
  getLastBlockHeight,
};
