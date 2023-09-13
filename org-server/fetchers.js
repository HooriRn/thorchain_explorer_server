const axios = require('axios');
const midgardBaseUrl = 'https://midgard.ninerealms.com/v2/';

function parseCoingeckoMarkets(data) {
	var parsed = [];
	for (var ticker of data.tickers) {
		try{
			parsed.push({
				market: ticker.market.name,
				base: ticker.base,
				target: ticker.target,
				pair: ticker.target + '/' + ticker.base,
				depth_up: ticker.cost_to_move_up_usd,
				depth_down: ticker.cost_to_move_down_usd,
				price: ticker.converted_last.usd,
				spread: ticker.bid_ask_spread_percentage && ticker.bid_ask_spread_percentage.toFixed(2),
				volume: ticker.converted_volume.usd,
				tradeUrl: ticker.trade_url
			});
		}
		catch(e){
			console.error(e);
		}
	}
	return parsed;
}

class Fetchers {

	async fetchCoingeckoMarkets() {
		try{
			var fetched = await axios.get('https://api.coingecko.com/api/v3/coins/thorchain/tickers?depth=true');
			var parsed = parseCoingeckoMarkets(fetched.data);
			return parsed.slice(0, 9);
		} catch(e){
			return null;
		}
	}
	async fetchCoingecko_ERC20_Markets() {
		try{
			var fetched = await axios.get('https://api.coingecko.com/api/v3/coins/thorchain-erc20/tickers?depth=true');
			var parsed = parseCoingeckoMarkets(fetched.data);
			return parsed;
		} catch(e){
			return null;
		}
	}
	async fetchCoingecko_All_Markets() {
		try{
			var params = {
				vs_currency: 'usd',
				ids: 'bitcoin,ethereum,dogecoin,litecoin,bitcoin-cash,bitcoin,thorchain,binancecoin,binance-usd,usd-coin,tether,avalanche-2,cosmos'
			};
			var fetched = await axios.get('https://api.coingecko.com/api/v3/coins/markets', { params: params });
			return fetched.data;
		} catch(e){
			return null;
		}
	}

	async fetchCoingeckoNetInfo() {
		try{
			var res = await axios.get('https://api.coingecko.com/api/v3/coins/thorchain?community_data=false&developer_data=false&tickers=false&localization');
			var retval = {circulatingSupply: res.data.market_data.circulating_supply};
			return retval;
		} catch(e){
			return null;
		}
	}
    

	async fetchLastBlock() {
		const url = midgardBaseUrl + 'health';
		try{
			var res = await axios.get(url);
			if(res.data)
				return res.data.scannerHeight;
			else
				return null;
		} catch(e){
			return null;
		}

	}
	async fetchMinimumBond() {
		var url = midgardBaseUrl + 'network';
		try{
			var res = await axios.get(url);
			var minimumBond = res.data.bondMetrics.minimumActiveBond;
			minimumBond = parseInt(minimumBond);
			return minimumBond;
		} catch(e){
			return null;
		}
	}
	async fetchRunePrice() {
		var url = midgardBaseUrl + 'pool/BNB.BUSD-BD1';
		try{
			var res = await axios.get(url);
			if(res.data){
				var usdInRune = res.data.assetPrice;
				usdInRune = parseFloat(usdInRune);
				var runeInUsd = 1 / usdInRune;
				return runeInUsd;
			}
			else
				return null;
		} catch(e){
			return null;
		}   
	}

	async fetchActiveAsgardVaultLink() {
		var url = 'https://api.viewblock.io/thorchain/vaults?network=chaosnet';
		var headers = {
			'Host': 'api.viewblock.io',
			'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:84.0) Gecko/20100101 Firefox/84.0',
			'Accept': 'application/json',
			'Accept-Language': 'en-US,en;q=0.5',
			'Accept-Encoding': 'gzip, deflate, br',
			'Referer': 'https://viewblock.io/thorchain/txs',
			'Content-Type': 'application/json',
			'Origin': 'https://viewblock.io',
			'DNT': 1,
			'Connection': 'keep-alive',
			'Pragma': 'no-cache',
			'Cache-Control': 'no-cache'
		};
		try{
			var res = await axios.get(url, { headers });
			if (res.data){

				for (var vault of res.data){
					if(vault && vault.type === 'asgard')
						return 'https://viewblock.io/thorchain/address/'+vault.hash;
				}
				return null;
			}
			else
				return null;
		} catch(e){
			return null;
		}
	}
        
	async fetchThorNetValues() {
		var url = midgardBaseUrl + 'network';
		try{
			var res = await axios.get(url);
			var retval = {
				totalStaked: res.data.totalPooledRune,
				totalActiveBond: res.data.bondMetrics.totalActiveBond,
				totalStandbyBond: res.data.bondMetrics.totalStandbyBond,
				totalReserve: res.data.totalReserve,
				bondingAPY: res.data.bondingAPY,
				liquidityAPY: res.data.liquidityAPY,
				activeNodeCount: res.data.activeNodeCount,
				standbyNodeCount: res.data.standbyNodeCount,
				nextChurnHeight: res.data.nextChurnHeight
			};
			retval['totalCapital'] = parseInt(retval.totalActiveBond)
            + parseInt(retval.totalReserve)
            + parseInt(retval.totalStandbyBond)
            + parseInt(retval.totalStaked);

			retval['totalTvlInUsd'] = await Fetchers.fetchTvlInUsd(retval.totalActiveBond, retval.totalStandbyBond);

			res = await axios.get(midgardBaseUrl + 'history/earnings');
			if(res.data){
				retval['totalEarned'] = parseInt(res.data.meta.bondingEarnings)
                 + parseInt(res.data.meta.liquidityEarnings);
			} else
				retval['totalEarned'] = null;

			url = midgardBaseUrl + 'stats';
			res = await axios.get(url);
			retval['totalTx'] = res.data.swapCount;
			retval['totalTx24h'] = res.data.swapCount24h;
			retval['users24h'] = res.data.dailyActiveUsers;
			retval['swapVolume'] = res.data.swapVolume;
            
			url = 'this.getVolume24H';
			res = await Fetchers.getVolume24H();
			if(res) {
				retval['volume24h'] = res.volume24h;
				retval['totalPool'] = res.totalPool;
				retval['pools'] = res.pools;
			}
			else {
				retval['volume24h'] = null;
				retval['totalPool'] = null;
				retval['pools'] = null;
			}


			return retval;
    
		} catch(e){
			return null;
		}
	}

	async fetchTotalTXs() {
		var url = 'https://api.viewblock.io/thorchain/txs?page=1&network=testnet&type=all';
		try{
			var res = await axios.get(url);
			return res.data.total;

		} catch(e){
			return null;
		}
	}

	async fetchNodesLocation() {
		try {
			var nodeUrl = midgardBaseUrl + 'thorchain/nodes';
			var nodesStat = await axios.get(nodeUrl);

			var ip = nodesStat.data.map(el => el['ip_address']);
			var stat = nodesStat.data.map(el => el['status']);
            
			var url = 'http://ip-api.com/batch';

			let inode = ip.map((el, index) => {
				return {
					ip: el,
					stat: stat[index]
				};
			});
			inode = inode.filter(el => el.ip !== '');

			for (let i = 0; i < Math.ceil(ip.length/100); i++) {
				var res = await axios.post(url, ip.slice(i*100,(i+1)*100));
				res.data.forEach((el) => {
					const index = inode.findIndex(obj => {
						return obj.ip == el.query;
					});
					inode[index] = {...inode[index], ...el};
				});
			}

			return inode;
		}
		catch(e) {
			return null;
		}
	}

	async fetchViewBlockTotalTx() {
		var url = 'https://api.viewblock.io/thorchain/stats?network=chaosnet';
		var headers = {
			'Host': 'api.viewblock.io',
			'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:84.0) Gecko/20100101 Firefox/84.0',
			'Accept': 'application/json',
			'Accept-Language': 'en-US,en;q=0.5',
			'Accept-Encoding': 'gzip, deflate, br',
			'Referer': 'https://viewblock.io/thorchain/txs',
			'Content-Type': 'application/json',
			'Origin': 'https://viewblock.io',
			'DNT': 1,
			'Connection': 'keep-alive',
			'Pragma': 'no-cache',
			'Cache-Control': 'no-cache'
		};
		try{
			var res = await axios.get(url, { headers });
			if (res.data)
				return res.data.info.blockchain.txCount;
			else
				return null;
		} catch(e){
			return null;
		}
	}

	static async getVolume24H() {
		try{
			var url = midgardBaseUrl + 'pools';
			var res = await axios.get(url);
			if(!res.data) return null;
			var volume24h = 0;
			for(var pool of res.data){
				if(pool.volume24h)
					volume24h += parseInt(pool.volume24h);
			}
			return {volume24h, totalPool: res.data.length, pools: res.data};
		}
		catch(e){
			return null;
		}
	}

	static async fetchTvlInUsd(totalActiveBond, totalStandbyBond) {
		try {
			var url = midgardBaseUrl + 'history/tvl';
			var res = await axios.get(url);

			var poolTvl = parseInt(res.data.meta.totalValuePooled / 100000000);
			var runePriceUSD = parseFloat(res.data.meta.runePriceUSD);
			var bondTvl = parseInt(totalActiveBond / 100000000) + parseInt(totalStandbyBond / 100000000); 
        
			return (poolTvl + bondTvl) * runePriceUSD;
		}
		catch (e) {
			return null;
		}
	}

}
        
module.exports = new Fetchers();