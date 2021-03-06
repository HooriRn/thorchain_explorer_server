const endpoints = {
  "mainnet": {
    MIDGARD_BASE_URL: "https://midgard.ninerealms.com/v2/",
    THORNODE_URL: "https://thornode.ninerealms.com/",
    TENDERMINT_URL: "https://rpc.ninerealms.com/"
  },
  "stagenet": {
    MIDGARD_BASE_URL: "https://stagenet-midgard.ninerealms.com/v2/",
    THORNODE_URL: "https://stagenet-thornode.ninerealms.com/",
    TENDERMINT_URL: ""
  },
  "testnet": {
    MIDGARD_BASE_URL: "https://testnet.midgard.thorchain.info/v2/",
    THORNODE_URL: "https://testnet.thornode.thorchain.info/",
    TENDERMINT_URL: ""
  }
}

module.exports = {
  endpoints
}