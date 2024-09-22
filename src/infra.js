/* eslint-disable no-unused-vars */
const Axios = require('axios');
require('dotenv').config();

// Axios configs
const axios = Axios.create({
	baseURL: process.env.INFRA_URL,
	timeout: 20000,
});

const midAxios = Axios.create({
	baseURL: process.env.INFRA_MID_URL,
	timeout: 20000,
});

const { maxBy } = require('lodash');

// Requests
async function getTHORlastblock() {
	const chains = (await axios.get('thorchain/lastblock')).data;
	return maxBy(chains, 'thorchain').thorchain;
}

async function getActions(params) {
	const actions = (await midAxios.get('actions', { params })).data;
	return actions;
}

module.exports = {
	getTHORlastblock,
	getActions
};