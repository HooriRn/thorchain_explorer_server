const { getTxs, getStats, volumeHistory, swapHistory, tvlHistory, earningsHistory } = require('./midgard');
const { getAddresses, getRPCLastBlockHeight, getSupplyRune, getLastBlockHeight, getNodes } = require('./thornode');
const dayjs = require('dayjs');
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

async function OHCLprice() {
  let {data} = await axios.get("https://node-api.flipsidecrypto.com/api/v2/queries/02011705-4694-45ec-9ada-d76127dc7956/data/latest")

  let chartData = [];

  let lastDate = undefined;
  let sameDay = [];

  data.forEach(interval => {
    let date = dayjs(interval.DATE);
    if (!lastDate) {
      lastDate = date;
    }
    if (date.isSame(lastDate, 'day')) {
      sameDay.push({date, price: interval.DAILY_RUNE_PRICE});
    }
    else {
      let minPrice = Math.min.apply(Math, sameDay.map(d => d.price))
      let maxPrice = Math.max.apply(Math, sameDay.map(d => d.price))
      let closePrice = sameDay[0].price
      let openPrice = sameDay[0].price
      let minM = sameDay[0].date
      let maxM = sameDay[0].date
      let vol = 0

      sameDay.forEach((d, i) => {
        if (d.date.isBefore(minM)) {
          minM = d.date
          openPrice = d.price
        }
        if (d.date.isAfter(maxM)) {
          maxM = d.date
          closePrice = d.price
        }
        if (d.vol) {
          vol = d.vol;
        }
      })

      chartData.push({
        date: dayjs(date).format("YY/MM/DD"),
        prices: [openPrice, closePrice, minPrice, maxPrice],
        volume: vol
      })

      // add the new date
      lastDate = undefined;
      sameDay = [];
      sameDay.push({date, price: interval.DAILY_RUNE_PRICE, vol: interval.TOTAL_SWAP_VOLUME_USD});
    }
  });

  return chartData;
}

module.exports = {
  dashboardData,
  dashboardPlots,
  extraNodesInfo,
  OHCLprice
}