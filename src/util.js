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

module.exports = {
	GetDerivedAsset
};