const swapsCategoricalMonthly = `
WITH
attempted_txs AS (
  SELECT
    TX_ID,
    SPLIT_PART(MEMO, ':', 4) LIKE '%/%/%' AS IS_STREAMING,
    CASE
      WHEN split_part(MEMO, ':',  5) != '' THEN split_part(MEMO, ':',  5)
      WHEN (MEMO LIKE '%::0' AND MEMO NOT LIKE '+%') THEN 'te-ios'
      ELSE NULL
    END AS AFFILIATE_ADDRESS,
    CASE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
      WHEN 'A' THEN 'AVAX.AVAX'
      WHEN 'B' THEN 'BTC.BTC'
      WHEN 'C' THEN 'BCH.BCH'
      WHEN 'N' THEN 'BNB.BNB'
      WHEN 'S' THEN 'BSC.BNB'
      WHEN 'D' THEN 'DOGE.DOGE'
      WHEN 'E' THEN 'ETH.ETH'
      WHEN 'G' THEN 'GAIA.ATOM'
      WHEN 'R' THEN 'THOR.RUNE'
      ELSE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
    END AS OUTBOUND_ASSET,
    COUNT(1) AS SUB_SWAP_COUNT,
    COUNT(DISTINCT POOL_NAME) AS POOL_COUNT,
    MIN(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_1,
    MAX(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_2,
    CASE
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET = _ASSET_1 THEN _ASSET_2
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET <> _ASSET_1 THEN _ASSET_1
      WHEN POOL_COUNT = 1 AND OUTBOUND_ASSET = 'THOR.RUNE' THEN _ASSET_1
      ELSE 'THOR.RUNE'
    END AS INBOUND_ASSET,
    MAX(FROM_ASSET LIKE '%~%' OR TO_ASSET LIKE '%~%') AS IS_TRADE_ASSET_SWAP,
    MAX(FROM_ASSET LIKE '%/%' OR TO_ASSET LIKE '/') AS IS_SYNTH_SWAP
  FROM thorchain.defi.fact_swaps_events
  WHERE UPPER(SPLIT_PART(MEMO, ':', 1)) IN ('SWAP', 'S', '=')
    AND block_timestamp > GETDATE() - interval'30 days'
  GROUP BY 1,2,3,4
)
, successful_txs AS (
  SELECT * FROM attempted_txs AS a
  WHERE NOT EXISTS (
      SELECT TX_ID
      FROM thorchain.defi.fact_refund_events
      WHERE TX_ID = a.TX_ID
    AND block_timestamp > GETDATE() - interval'30 days'
  )
)
, rune_prices AS (
  SELECT
    BLOCK_TIMESTAMP,
    AVG(RUNE_USD) AS RUNE_USD
  FROM thorchain.price.fact_prices
  WHERE TRUE
    AND block_timestamp > GETDATE() - interval'30 days'
  GROUP BY 1
)
, tx_agg AS (
  SELECT
    b.BLOCK_TIMESTAMP::DATE AS DATE,
    b.TX_ID,
    IS_STREAMING,
    IS_TRADE_ASSET_SWAP,
    IS_SYNTH_SWAP,
    -- This is the protocol volume, i.e. for double swaps, add the volumes transferred in each pool to effectuate the user's intent.
    SUM(FROM_AMOUNT_USD) AS TOTAL_VOLUME_USD,
    SUM(1.0 * FROM_AMOUNT_USD / rp.RUNE_USD) AS TOTAL_VOLUME_RUNE,
    SUM(
      CASE 
        WHEN SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END
    ) AS AFFILIATE_FEES_USD,
    SUM(1.0 *
      CASE 
        WHEN SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END / rp.RUNE_USD
    ) AS AFFILIATE_FEES_RUNE
  FROM thorchain.defi.fact_swaps AS b
  JOIN successful_txs AS s
    ON b.TX_ID = s.TX_ID
  JOIN rune_prices AS rp
    ON b.BLOCK_TIMESTAMP = rp.BLOCK_TIMESTAMP
  GROUP BY 1,2,3,4,5
)
SELECT
  DATE,
  IS_STREAMING,
  SUM(
      CASE IS_TRADE_ASSET_SWAP AND IS_SYNTH_SWAP WHEN TRUE THEN TOTAL_VOLUME_USD
      ELSE 0 END
  ) AS TA_PLUS_SYNTH_SWAP_VOLUME_USD,
  SUM(
      CASE IS_TRADE_ASSET_SWAP AND NOT IS_SYNTH_SWAP WHEN TRUE THEN TOTAL_VOLUME_USD
      ELSE 0 END
  ) AS TA_SWAP_VOLUME_USD,
  SUM(
      CASE NOT IS_TRADE_ASSET_SWAP AND IS_SYNTH_SWAP WHEN TRUE THEN TOTAL_VOLUME_USD
      ELSE 0 END
  ) AS SYNTH_SWAP_VOLUME_USD,
  SUM(
      CASE NOT IS_TRADE_ASSET_SWAP AND NOT IS_SYNTH_SWAP WHEN TRUE THEN TOTAL_VOLUME_USD
      ELSE 0 END
  ) AS NATIVE_SWAP_VOLUME_USD,
  SUM(TOTAL_VOLUME_USD) AS TOTAL_SWAP_VOLUME_USD,
  SUM(
      CASE IS_TRADE_ASSET_SWAP AND IS_SYNTH_SWAP WHEN TRUE THEN AFFILIATE_FEES_USD
      ELSE 0 END
  ) AS TA_PLUS_SYNTH_AFFILIATE_FEES_USD,
  SUM(
      CASE IS_TRADE_ASSET_SWAP AND NOT IS_SYNTH_SWAP WHEN TRUE THEN AFFILIATE_FEES_USD
      ELSE 0 END
  ) AS TA_AFFILIATE_FEES_USD,
  SUM(
      CASE NOT IS_TRADE_ASSET_SWAP AND IS_SYNTH_SWAP WHEN TRUE THEN AFFILIATE_FEES_USD
      ELSE 0 END
  ) AS SYNTH_AFFILIATE_FEES_USD,
  SUM(
      CASE NOT IS_TRADE_ASSET_SWAP AND NOT IS_SYNTH_SWAP WHEN TRUE THEN AFFILIATE_FEES_USD
      ELSE 0 END
  ) AS NATIVE_AFFILIATE_FEES_USD,
  SUM(AFFILIATE_FEES_USD) AS TOTAL_AFFILIATE_FEES_USD
FROM tx_agg
GROUP BY 1,2
ORDER BY DATE DESC 
`;

const thorchainStatsDaily = `
WITH base AS (
  SELECT
    p.day AS date,
    p.pool_name,
    p.asset_liquidity * p.asset_price_usd + p.rune_liquidity * p.rune_price_usd AS POOL_DEPTH_USD,
    COALESCE(s.asset_liquidity, 0) * p.asset_price_usd AS SAVERS_DEPTH_USD,
    p.SWAP_COUNT,
    p.TOTAL_SWAP_FEES_USD,
    p.SWAP_VOLUME_RUNE_USD
  FROM thorchain.defi.fact_daily_pool_stats AS p
  LEFT JOIN thorchain.defi.fact_daily_pool_stats AS s
    ON p.day = s.day
    AND SPLIT_PART(p.pool_name, '.', 1) = SPLIT_PART(s.pool_name, '/', 1)
    AND SPLIT_PART(p.pool_name, '.', 2) = SPLIT_PART(s.pool_name, '/', 2)
  WHERE p.pool_name LIKE '%.%'
  ORDER BY p.day DESC LIMIT 1
)
SELECT
  GREATEST(date, DATE) AS date,
  SUM(POOL_DEPTH_USD) AS POOL_DEPTH_USD,
  SUM(SAVERS_DEPTH_USD) AS SAVERS_DEPTH_USD,
  SUM(SWAP_COUNT) AS SWAP_COUNT,
  SUM(TOTAL_SWAP_FEES_USD) AS TOTAL_SWAP_FEES_USD,
  SUM(SWAP_VOLUME_RUNE_USD) AS SWAP_VOLUME_USD
FROM base
GROUP BY 1
`;

const feesVsRewardsMonthly = `
WITH fees AS (
  SELECT
    BLOCK_TIMESTAMP::DATE AS DATE,
    SUM(LIQ_FEE_RUNE_USD) AS LIQUIDITY_FEES_USD
  FROM thorchain.defi.fact_swaps
  WHERE BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1
), rewards AS (
  SELECT
    BLOCK_TIMESTAMP::DATE AS DATE,
    SUM(RUNE_AMOUNT_USD) AS BLOCK_REWARDS_USD
  FROM thorchain.defi.fact_total_block_rewards
  WHERE BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1
)
SELECT
  COALESCE(f.DATE, r.DATE) AS DATE,
  COALESCE(LIQUIDITY_FEES_USD, 0) AS LIQUIDITY_FEES_USD,
  COALESCE(BLOCK_REWARDS_USD, 0) AS BLOCK_REWARDS_USD,
  COALESCE(LIQUIDITY_FEES_USD, 0) + COALESCE(BLOCK_REWARDS_USD, 0) AS FEES_PLUS_REWARDS,
  CASE
    WHEN COALESCE(LIQUIDITY_FEES_USD, 0) + COALESCE(BLOCK_REWARDS_USD, 0) = 0 THEN 0
    ELSE COALESCE(LIQUIDITY_FEES_USD, 0)/(COALESCE(LIQUIDITY_FEES_USD, 0) + COALESCE(BLOCK_REWARDS_USD, 0))
  END * 100 AS PCT_LIQUIDTY_FEES,
  0.5 AS HALF_LINE
FROM fees AS f
FULL OUTER JOIN rewards AS r
  ON f.date = r.date
ORDER BY DATE
`;

const affiliateSwapsByWallet = `
 -- forked from (THORSwap) Top 10 Directed Swap Pairs By Affiliate Address @ https://flipsidecrypto.xyz/edit/queries/dd2bdbc7-f3f0-4332-b970-d18ef5cc9822
WITH attempted_txs AS (
  SELECT
    TX_ID,
    SPLIT_PART(MEMO, ':', 4) LIKE '%/%/%' AS IS_STREAMING,
    CASE
      WHEN split_part(MEMO, ':',  5) != '' THEN split_part(MEMO, ':',  5)
      WHEN (MEMO LIKE '%::0' AND MEMO NOT LIKE '+%') THEN 'te-ios'
      ELSE NULL
    END AS AFFILIATE_ADDRESS,
    CASE UPPER(SPLIT_PART(REPLACE(SPLIT_PART(MEMO, ':', 2), '/', '.'), '-', 1))
      WHEN 'A' THEN 'AVAX.AVAX'
      WHEN 'B' THEN 'BTC.BTC'
      WHEN 'C' THEN 'BCH.BCH'
      WHEN 'N' THEN 'BNB.BNB'
      WHEN 'S' THEN 'BSC.BNB'
      WHEN 'D' THEN 'DOGE.DOGE'
      WHEN 'E' THEN 'ETH.ETH'
      WHEN 'G' THEN 'GAIA.ATOM'
      WHEN 'L' THEN 'LTC.LTC'
      WHEN 'R' THEN 'THOR.RUNE'
      ELSE UPPER(SPLIT_PART(REPLACE(SPLIT_PART(MEMO, ':', 2), '/', '.'), '-', 1))
    END AS OUTBOUND_ASSET,
    COUNT(1) AS SUB_SWAP_COUNT,
    COUNT(DISTINCT POOL_NAME) AS POOL_COUNT,
    MIN(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_1,
    MAX(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_2,
    CASE
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET = _ASSET_1 THEN _ASSET_2
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET <> _ASSET_1 THEN _ASSET_1
      WHEN POOL_COUNT = 1 AND OUTBOUND_ASSET = 'THOR.RUNE' THEN _ASSET_1
      ELSE 'THOR.RUNE'
    END AS INBOUND_ASSET
  FROM thorchain.defi.fact_swaps_events
  WHERE UPPER(SPLIT_PART(MEMO, ':', 1)) IN ('SWAP', 'S', '=')
    AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1,2,3,4
)
, successful_txs AS (
  SELECT * FROM attempted_txs AS a
  WHERE NOT EXISTS (
      SELECT TX_ID
      FROM thorchain.defi.fact_refund_events
      WHERE TX_ID = a.TX_ID
        AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  )
)
, rune_prices AS (
  SELECT
    BLOCK_TIMESTAMP,
    AVG(RUNE_USD) AS RUNE_USD
  FROM thorchain.price.fact_prices
  WHERE BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1
)
, tx_agg AS (
  SELECT
    b.BLOCK_TIMESTAMP::DATE AS DATE,
    b.TX_ID,
    s.AFFILIATE_ADDRESS,
    -- This is the protocol volume, i.e. for double swaps, add the volumes transferred in each pool to effectuate the user's intent.
    SUM(FROM_AMOUNT_USD) AS TOTAL_VOLUME_USD,
    SUM(1.0 * FROM_AMOUNT_USD / rp.RUNE_USD) AS TOTAL_VOLUME_RUNE,
    SUM(LIQ_FEE_RUNE_USD) AS TOTAL_LIQUIDITY_FEES_USD,
    SUM(LIQ_FEE_RUNE) AS TOTAL_LIQUIDITY_FEES_RUNE,
    SUM(
      CASE 
        WHEN SPLIT_PART(REPLACE(b.FROM_ASSET, '/', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END
    ) AS AFFILIATE_FEES_USD,
    SUM(1.0 *
      CASE 
        WHEN SPLIT_PART(REPLACE(b.FROM_ASSET, '/', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END / rp.RUNE_USD
    ) AS AFFILIATE_FEES_RUNE
  FROM thorchain.defi.fact_swaps AS b
  JOIN successful_txs AS s
    ON b.TX_ID = s.TX_ID
  JOIN rune_prices AS rp
    ON b.BLOCK_TIMESTAMP = rp.BLOCK_TIMESTAMP
  GROUP BY 1,2,3
)
, affiliate_map AS (
  SELECT
    AFFILIATE_ADDRESS AS AFFILIATE,
    COUNT(DISTINCT TX_ID) AS TOTAL_SWAPS,
    SUM(TOTAL_VOLUME_USD) AS TOTAL_VOLUME_USD,
    SUM(TOTAL_LIQUIDITY_FEES_USD) AS TOTAL_LIQUIDITY_FEES_USD 
  FROM tx_agg
  GROUP BY 1
)
, wallet_map AS (
  SELECT
     case 
      when AFFILIATE_ADDRESS in ('t', 'T', 'thor160yye65pf9rzwrgqmtgav69n6zlsyfpgm9a7xk') then 'THORSwap'
      when AFFILIATE_ADDRESS in ('wr', 'thor1a427q3v96psuj4fnughdw8glt5r7j38lj7rkp8') then 'THORWallet'
      when AFFILIATE_ADDRESS = 'tl' then 'TS Ledger'
      when AFFILIATE_ADDRESS = 'cb' then 'Team CoinBot'
      when AFFILIATE_ADDRESS = 'dx' then 'Asgardex'
      when AFFILIATE_ADDRESS = 'ss' then 'ShapeShift'
      when AFFILIATE_ADDRESS = 'xdf' then 'XDEFI'
      when AFFILIATE_ADDRESS = 'rg' then 'Rango'
      when AFFILIATE_ADDRESS = 'ej' then 'Edge Wallet'
      when AFFILIATE_ADDRESS = 'ds' then 'DefiSpot'
      when AFFILIATE_ADDRESS = 'lends' then 'Lends'
      when AFFILIATE_ADDRESS = 'decentralfi' then 'DecentralFi'
      when AFFILIATE_ADDRESS in ('ti', 'te', 'tr', 'td') then 'TrustWallet'
      when AFFILIATE_ADDRESS = 'lifi' then 'LiFi'
      when AFFILIATE_ADDRESS = 'oky' then 'OneKey Wallet'
      when AFFILIATE_ADDRESS = 'sy' then 'Symbiosis'
      when AFFILIATE_ADDRESS = 'vi' then 'Vultisig'
      when AFFILIATE_ADDRESS = 'cakewallet' then 'Cake Wallet'
      when AFFILIATE_ADDRESS = 'okw' then 'OKX'
      when AFFILIATE_ADDRESS is null then 'No Affiliate'
      else AFFILIATE_ADDRESS
    end as AFFILIATE,
    COUNT(DISTINCT TX_ID) AS TOTAL_SWAPS,
    SUM(TOTAL_VOLUME_USD) AS TOTAL_VOLUME_USD,
    SUM(TOTAL_LIQUIDITY_FEES_USD) AS TOTAL_LIQUIDITY_FEES_USD 
  FROM tx_agg
  GROUP BY 1
)
SELECT
  AFFILIATE,
  -- TOTAL_SWAPS
  TOTAL_VOLUME_USD
  -- TOTAL_LIQUIDITY_FEES_USD
FROM wallet_map
WHERE AFFILIATE IS NOT NULL
ORDER BY 2 DESC
LIMIT 20
`;

const affiliateByWallet = `
 -- forked from (THORSwap) Top 10 Directed Swap Pairs By Affiliate Address @ https://flipsidecrypto.xyz/edit/queries/dd2bdbc7-f3f0-4332-b970-d18ef5cc9822
WITH attempted_txs AS (
  SELECT
    TX_ID,
    SPLIT_PART(MEMO, ':', 4) LIKE '%/%/%' AS IS_STREAMING,
    CASE
      WHEN split_part(MEMO, ':',  5) != '' THEN split_part(MEMO, ':',  5)
      WHEN (MEMO LIKE '%::0' AND MEMO NOT LIKE '+%') THEN 'te-ios'
      ELSE NULL
    END AS AFFILIATE_ADDRESS,
    CASE UPPER(SPLIT_PART(REPLACE(SPLIT_PART(MEMO, ':', 2), '/', '.'), '-', 1))
      WHEN 'A' THEN 'AVAX.AVAX'
      WHEN 'B' THEN 'BTC.BTC'
      WHEN 'C' THEN 'BCH.BCH'
      WHEN 'N' THEN 'BNB.BNB'
      WHEN 'S' THEN 'BSC.BNB'
      WHEN 'D' THEN 'DOGE.DOGE'
      WHEN 'E' THEN 'ETH.ETH'
      WHEN 'G' THEN 'GAIA.ATOM'
      WHEN 'L' THEN 'LTC.LTC'
      WHEN 'R' THEN 'THOR.RUNE'
      ELSE UPPER(SPLIT_PART(REPLACE(SPLIT_PART(MEMO, ':', 2), '/', '.'), '-', 1))
    END AS OUTBOUND_ASSET,
    COUNT(1) AS SUB_SWAP_COUNT,
    COUNT(DISTINCT POOL_NAME) AS POOL_COUNT,
    MIN(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_1,
    MAX(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_2,
    CASE
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET = _ASSET_1 THEN _ASSET_2
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET <> _ASSET_1 THEN _ASSET_1
      WHEN POOL_COUNT = 1 AND OUTBOUND_ASSET = 'THOR.RUNE' THEN _ASSET_1
      ELSE 'THOR.RUNE'
    END AS INBOUND_ASSET
  FROM thorchain.defi.fact_swaps_events
  WHERE UPPER(SPLIT_PART(MEMO, ':', 1)) IN ('SWAP', 'S', '=')
    AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1,2,3,4
)
, successful_txs AS (
  SELECT * FROM attempted_txs AS a
  WHERE NOT EXISTS (
      SELECT TX_ID
      FROM thorchain.defi.fact_refund_events
      WHERE TX_ID = a.TX_ID
        AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  )
)
, rune_prices AS (
  SELECT
    BLOCK_TIMESTAMP,
    AVG(RUNE_USD) AS RUNE_USD
  FROM thorchain.price.fact_prices
  WHERE BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1
)
, tx_agg AS (
  SELECT
    b.BLOCK_TIMESTAMP::DATE AS DATE,
    b.TX_ID,
    s.AFFILIATE_ADDRESS,
    -- This is the protocol volume, i.e. for double swaps, add the volumes transferred in each pool to effectuate the user's intent.
    SUM(FROM_AMOUNT_USD) AS TOTAL_VOLUME_USD,
    SUM(1.0 * FROM_AMOUNT_USD / rp.RUNE_USD) AS TOTAL_VOLUME_RUNE,
    SUM(LIQ_FEE_RUNE_USD) AS TOTAL_LIQUIDITY_FEES_USD,
    SUM(LIQ_FEE_RUNE) AS TOTAL_LIQUIDITY_FEES_RUNE,
    SUM(
      CASE 
        WHEN SPLIT_PART(REPLACE(b.FROM_ASSET, '/', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END
    ) AS AFFILIATE_FEES_USD,
    SUM(1.0 *
      CASE 
        WHEN SPLIT_PART(REPLACE(b.FROM_ASSET, '/', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END / rp.RUNE_USD
    ) AS AFFILIATE_FEES_RUNE
  FROM thorchain.defi.fact_swaps AS b
  JOIN successful_txs AS s
    ON b.TX_ID = s.TX_ID
  JOIN rune_prices AS rp
    ON b.BLOCK_TIMESTAMP = rp.BLOCK_TIMESTAMP
  GROUP BY 1,2,3
)
, wallet_map AS (
  SELECT
     case 
      when AFFILIATE_ADDRESS in ('t', 'T', 'thor160yye65pf9rzwrgqmtgav69n6zlsyfpgm9a7xk') then 'THORSwap'
      when AFFILIATE_ADDRESS in ('wr', 'thor1a427q3v96psuj4fnughdw8glt5r7j38lj7rkp8') then 'THORWallet'
      when AFFILIATE_ADDRESS = 'tl' then 'TS Ledger'
      when AFFILIATE_ADDRESS = 'cb' then 'Team CoinBot'
      when AFFILIATE_ADDRESS = 'dx' then 'Asgardex'
      when AFFILIATE_ADDRESS = 'ss' then 'ShapeShift'
      when AFFILIATE_ADDRESS = 'xdf' then 'XDEFI'
      when AFFILIATE_ADDRESS = 'rg' then 'Rango'
      when AFFILIATE_ADDRESS = 'ej' then 'Edge Wallet'
      when AFFILIATE_ADDRESS = 'ds' then 'DefiSpot'
      when AFFILIATE_ADDRESS = 'lends' then 'Lends'
      when AFFILIATE_ADDRESS = 'decentralfi' then 'DecentralFi'
      when AFFILIATE_ADDRESS in ('ti', 'te', 'tr', 'td') then 'TrustWallet'
      when AFFILIATE_ADDRESS = 'lifi' then 'LiFi'
      when AFFILIATE_ADDRESS = 'oky' then 'OneKey Wallet'
      when AFFILIATE_ADDRESS = 'sy' then 'Symbiosis'
      when AFFILIATE_ADDRESS = 'vi' then 'Vultisig'
      when AFFILIATE_ADDRESS = 'cakewallet' then 'Cake Wallet'
      when AFFILIATE_ADDRESS = 'okw' then 'OKX'
      when AFFILIATE_ADDRESS is null then 'No Affiliate'
      else AFFILIATE_ADDRESS
    end as AFFILIATE,
    COUNT(DISTINCT TX_ID) AS TOTAL_SWAPS,
    SUM(TOTAL_VOLUME_USD) AS TOTAL_VOLUME_USD,
    SUM(AFFILIATE_FEES_USD) AS AFFILIATE_FEES_USD 
  FROM tx_agg
  GROUP BY 1
)
SELECT
  AFFILIATE,
  TOTAL_SWAPS,
  TOTAL_VOLUME_USD,
  AFFILIATE_FEES_USD
FROM wallet_map
WHERE AFFILIATE IS NOT NULL
ORDER BY 4 DESC
LIMIT 20
`

const dailyAffiliateMade = `
WITH
attempted_txs AS (
  SELECT
    TX_ID,
    SPLIT_PART(MEMO, ':', 4) LIKE '%/%/%' AS IS_STREAMING,
    CASE
      WHEN split_part(MEMO, ':',  5) != '' THEN split_part(MEMO, ':',  5)
      WHEN (MEMO LIKE '%::0' AND MEMO NOT LIKE '+%') THEN 'te-ios'
      ELSE NULL
    END AS AFFILIATE_ADDRESS,
    CASE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
      WHEN 'A' THEN 'AVAX.AVAX'
      WHEN 'B' THEN 'BTC.BTC'
      WHEN 'C' THEN 'BCH.BCH'
      WHEN 'N' THEN 'BNB.BNB'
      WHEN 'S' THEN 'BSC.BNB'
      WHEN 'D' THEN 'DOGE.DOGE'
      WHEN 'E' THEN 'ETH.ETH'
      WHEN 'G' THEN 'GAIA.ATOM'
      WHEN 'L' THEN 'LTC.LTC'
      WHEN 'R' THEN 'THOR.RUNE'
      ELSE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
    END AS OUTBOUND_ASSET,
    COUNT(1) AS SUB_SWAP_COUNT,
    COUNT(DISTINCT POOL_NAME) AS POOL_COUNT,
    MIN(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_1,
    MAX(UPPER(SPLIT_PART(POOL_NAME, '-',1))) AS _ASSET_2,
    CASE
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET = _ASSET_1 THEN _ASSET_2
      WHEN POOL_COUNT = 2 AND OUTBOUND_ASSET <> _ASSET_1 THEN _ASSET_1
      WHEN POOL_COUNT = 1 AND OUTBOUND_ASSET = 'THOR.RUNE' THEN _ASSET_1
      ELSE 'THOR.RUNE'
    END AS INBOUND_ASSET,
    MAX(FROM_ASSET LIKE '%~%' OR TO_ASSET LIKE '%~%') AS IS_TRADE_ASSET_SWAP,
    MAX(FROM_ASSET LIKE '%/%' OR TO_ASSET LIKE '/') AS IS_SYNTH_SWAP
  FROM thorchain.defi.fact_swaps_events
  WHERE UPPER(SPLIT_PART(MEMO, ':', 1)) IN ('SWAP', 'S', '=')
    AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1,2,3,4
)
, successful_txs AS (
  SELECT * FROM attempted_txs AS a
  WHERE NOT EXISTS (
      SELECT TX_ID
      FROM thorchain.defi.fact_refund_events
      WHERE TX_ID = a.TX_ID
    AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  )
)
, rune_prices AS (
  SELECT
    BLOCK_TIMESTAMP,
    AVG(RUNE_USD) AS RUNE_USD
  FROM thorchain.price.fact_prices
  WHERE TRUE
    AND BLOCK_TIMESTAMP >= GETDATE() - interval '30 days'
  GROUP BY 1
)
, tx_agg AS (
  SELECT
    b.BLOCK_TIMESTAMP::DATE AS DATE,
    b.TX_ID,
    IS_STREAMING,
    IS_TRADE_ASSET_SWAP,
    IS_SYNTH_SWAP,
    -- This is the protocol volume, i.e. for double swaps, add the volumes transferred in each pool to effectuate the user's intent.
    SUM(FROM_AMOUNT_USD) AS TOTAL_VOLUME_USD,
    SUM(1.0 * FROM_AMOUNT_USD / rp.RUNE_USD) AS TOTAL_VOLUME_RUNE,
    SUM(
      CASE 
        WHEN SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END
    ) AS AFFILIATE_FEES_USD,
    SUM(1.0 *
      CASE 
        WHEN SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1) = INBOUND_ASSET THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
        ELSE 0
      END / rp.RUNE_USD
    ) AS AFFILIATE_FEES_RUNE
  FROM thorchain.defi.fact_swaps AS b
  JOIN successful_txs AS s
    ON b.TX_ID = s.TX_ID
  JOIN rune_prices AS rp
    ON b.BLOCK_TIMESTAMP = rp.BLOCK_TIMESTAMP
  GROUP BY 1,2,3,4,5
)
, time_series AS (
  SELECT
    DATE,
    SUM(TOTAL_VOLUME_USD) AS DAILY_VOLUME_USD,
    SUM(TOTAL_VOLUME_RUNE) AS DAILY_VOLUME_RUNE,
    SUM(AFFILIATE_FEES_USD) AS DAILY_AFFILIATE_FEES_USD,
    SUM(AFFILIATE_FEES_RUNE) AS DAILY_AFFILIATE_FEES_RUNE
  FROM tx_agg
  GROUP BY 1
)
SELECT * FROM time_series ORDER BY DATE
`

module.exports = {
	swapsCategoricalMonthly,
	thorchainStatsDaily,
	feesVsRewardsMonthly,
	affiliateSwapsByWallet,
  affiliateByWallet,
  dailyAffiliateMade,
};