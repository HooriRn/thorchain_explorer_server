const { getTxs, getStats, volumeHistory, swapHistory, tvlHistory, earningsHistory } = require('./midgard');
const { getAddresses, getRPCLastBlockHeight, getSupplyRune, getLastBlockHeight } = require('./thornode');

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

module.exports = {
  dashboardData,
  dashboardPlots
}