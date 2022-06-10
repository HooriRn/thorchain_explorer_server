const { getTxs, getStats, volumeHistory, swapHistory, tvlHistory, earningsHistory } = require('./midgard');
const { getAddresses, getRPCLastBlockHeight, getSupplyRune, getLastBlockHeight, getNodes } = require('./thornode');
const { default: axios } = require('axios');
const chunk = require('lodash/chunk');

async function dashboardPlots() {
  const {data: LPChange} = await volumeHistory();
  const {data: swaps} = await swapHistory();
  const {data: tvl} = await tvlHistory();
  const {data: earning} = await earningsHistory();

  return {
    LPChange,
    swaps,
    tvl,
    earning
  }
}

async function dashboardData() {
  try {
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
      stats: stats.data
    }
  } catch (e) {
    console.error(e);
  }
}

async function extraNodesInfo() {
  const {data: nodes} = await getNodes();
  const chunks = chunk(nodes.filter(n => n.ip_address).map(n => n.ip_address), 100)

  let nodeInfo = {};
  for (let ipchunk of chunks) {
    let {data} = await axios.post('http://ip-api.com/batch', ipchunk)
    data.forEach(d => {
      try {
        nodeInfo[d.query] = d; 
      } catch (error) {
        console.error('got an error on assigning: ', d) 
      }
    });
  }

  return nodeInfo;
}

module.exports = {
  dashboardData,
  dashboardPlots,
  extraNodesInfo
}