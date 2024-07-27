const endpoints = {
	'mainnet': {
		MIDGARD_BASE_URL: 'https://midgard.ninerealms.com/v2/',
		THORNODE_URL: 'https://thornode.ninerealms.com/',
		TENDERMINT_URL: 'https://rpc.ninerealms.com/',
		V1_THORNODE: 'https://thornode-v1.ninerealms.com/'
	},
	'stagenet': {
		MIDGARD_BASE_URL: 'https://stagenet-midgard.ninerealms.com/v2/',
		THORNODE_URL: 'https://stagenet-thornode.ninerealms.com/',
		TENDERMINT_URL: 'https://stagenet-rpc.ninerealms.com/',
		V1_THORNODE: 'https://stagenet-thornode.ninerealms.com/'
	},
};

const modules = {
	'mainnet': {
		RESERVE_MODULE: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt'
	},
	'stagenet': {
		RESERVE_MODULE: 'sthor1dheycdevq39qlkxs2a6wuuzyn4aqxhvepe6as4'
	}
};

module.exports = {
	endpoints,
	modules
};