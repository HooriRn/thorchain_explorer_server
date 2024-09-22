const TRADE_DELIMITER = '~';
const SYNTH_DELIMITER = '/';
const NON_SYNTH_DELIMITER = '.';

function assetFromString(s) {
	if (typeof s === 'object') {
		return s;
	}
  
	const isSynth = s.includes(SYNTH_DELIMITER);
	let delimiter = isSynth ? SYNTH_DELIMITER : NON_SYNTH_DELIMITER;
	const isTrade = s.includes(TRADE_DELIMITER);
	delimiter = isTrade ? TRADE_DELIMITER : delimiter;
	const data = s.split(delimiter);
	if (data.length <= 1 || data[1]?.length < 1) {
		return null;
	}
  
	const chain = data[0];
	const symbol = data[1];
	const ticker = symbol.split('-')[0];
	const address = symbol.split('-')[1] ?? '';
  
	return { chain, symbol, ticker, address, synth: isSynth, trade: isTrade };
}

function GetDerivedAsset(s) {
	const asset = assetFromString(s);

	return `THOR.${asset.symbol}`;
}

function formatTime(seconds, hour) {
	seconds = Number(seconds)
	const d = Math.floor(seconds / (3600 * 24))
	const h = Math.floor((seconds % (3600 * 24)) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)

	const comms = (c) => (c > 0 ? ', ' : '')

	const dDisplay = d > 0 ? d + (d === 1 ? ' day' : ' days') : ''
	const hDisplay = h > 0 ? h + (h === 1 ? ' hour' : ' hours') : ''
	let strBuild = dDisplay + comms(d && h) + hDisplay
	const mDisplay = m > 0 ? m + (m === 1 ? ' minute' : ' minutes') : ''
	const sDisplay = s > 0 ? s + (s === 1 ? ' second' : ' seconds') : ''
	if (!hour) {
		strBuild +=
		comms((h && m) || (d && m)) +
		mDisplay +
		comms((m && s) || (d && s) || (h && s)) +
		sDisplay
	}
	return strBuild
}

function blockTime(blockHeight, hour) {
	const val = blockHeight * 6
	return formatTime(val, hour)
}

module.exports = {
	GetDerivedAsset,
	blockTime
};