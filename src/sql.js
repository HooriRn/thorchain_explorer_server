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

function affiliatSwapsDuration(period = '30 days') {
  const affiliateSwapsByWallet = `
  -- forked from (THORSwap) Top 10 Directed Swap Pairs By Affiliate Address @ https://flipsidecrypto.xyz/edit/queries/dd2bdbc7-f3f0-4332-b970-d18ef5cc9822
  WITH
  date_range AS (
    SELECT
      GETDATE() - interval '${period ?? '31 days'}' AS start_date,
      CURRENT_DATE AS end_date
  )
  , date_spine AS (
    SELECT
      DATEADD(DAY, seq, start_date) AS DATE
    FROM
    date_range
    , (
      -- Arbitrarily large table to create a date spine
      SELECT SEQ4() AS seq
      FROM TABLE(GENERATOR(ROWCOUNT => 10000))
    ) AS sequence
    -- TO-DO make this parameterizable
    WHERE seq <= DATEDIFF(DAY, start_date, end_date)
  )
  , true_memos AS (
    SELECT DISTINCT
      TX_ID,
      FIRST_VALUE(MEMO) OVER (PARTITION BY TX_ID ORDER BY EVENT_ID) AS MEMO
    FROM thorchain.defi.fact_swaps_events
    WHERE TRUE
      AND UPPER(SPLIT_PART(MEMO, ':', 1)) IN ('SWAP', 'S', '=')
  )
  -- 1. Swap Volume Stats
  , attempted_swaps AS (
    SELECT
      s.TX_ID,
      SPLIT_PART(m.MEMO, ':', 4) LIKE '%/%/%' AS IS_STREAMING,
      CASE
        WHEN split_part(m.MEMO, ':',  5) != '' THEN split_part(m.MEMO, ':',  5)
        WHEN (m.MEMO LIKE '%::0' AND m.MEMO NOT LIKE '+%') THEN 'te-ios'
        ELSE NULL
      END AS AFFILIATE_ADDRESS,
      CASE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(m.MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
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
        ELSE UPPER(SPLIT_PART(REGEXP_REPLACE(SPLIT_PART(m.MEMO, ':', 2), '[~/]{1}', '.'), '-', 1))
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
      MAX(FROM_ASSET LIKE '%/%' OR TO_ASSET LIKE '/') AS IS_SYNTH_SWAP,
      MIN(m.MEMO) AS MEMO
    FROM thorchain.defi.fact_swaps_events AS s
    JOIN true_memos AS m
      ON s.TX_ID = m.TX_ID
    WHERE TRUE
      AND (AFFILIATE_ADDRESS IS NOT NULL AND AFFILIATE_ADDRESS <> '')
      AND UPPER(SPLIT_PART(m.MEMO, ':', 1)) IN ('SWAP', 'S', '=')
      AND BLOCK_TIMESTAMP >= (SELECT start_date FROM date_range)
      AND BLOCK_TIMESTAMP < (SELECT end_date FROM date_range) + INTERVAL '1 DAY'
    GROUP BY 1,2,3,4
  )
  , successful_swaps AS (
    SELECT * FROM attempted_swaps AS a
    WHERE NOT EXISTS (
        SELECT TX_ID
        FROM thorchain.defi.fact_refund_events
        WHERE TX_ID = a.TX_ID
        AND BLOCK_TIMESTAMP >= (SELECT start_date FROM date_range)
        AND BLOCK_TIMESTAMP < (SELECT end_date FROM date_range) + INTERVAL '1 DAY'
    )
  )
  , rune_prices AS (
    SELECT
      BLOCK_TIMESTAMP,
      AVG(RUNE_USD) AS RUNE_USD
    FROM thorchain.price.fact_prices
    WHERE TRUE
      AND BLOCK_TIMESTAMP >= (SELECT start_date FROM date_range)
      AND BLOCK_TIMESTAMP < (SELECT end_date FROM date_range) + INTERVAL '1 DAY'
    GROUP BY 1
  )
  , inbound AS (
    SELECT
      s.AFFILIATE_ADDRESS,
      b.BLOCK_TIMESTAMP::DATE AS DATE,
      b.TX_ID,
      s.MEMO,
      IS_STREAMING,
      IS_TRADE_ASSET_SWAP,
      IS_SYNTH_SWAP,
      INBOUND_ASSET,
      OUTBOUND_ASSET,
      MIN(b.BLOCK_TIMESTAMP) AS BLOCK_TIMESTAMP,
      MIN(
        CASE UPPER(SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1)) = INBOUND_ASSET
          WHEN TRUE THEN LOWER(FROM_ADDRESS)
        END
      ) AS INBOUND_ADDRESS,
      SUM(
        CASE UPPER(SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1)) = INBOUND_ASSET
          WHEN TRUE THEN FROM_AMOUNT_USD
          ELSE 0
        END)   		  -- Edge case where THORNode pulls out affiliate fees for inbound THOR.RUNE for affiliate fees but doesn't broadcast to Midgard.
          / (CASE WHEN INBOUND_ASSET <> 'THOR.RUNE' THEN 1 ELSE 1.0*(10000 - SPLIT_PART(s.MEMO, ':', 6)::INT)/1E4 END) AS INBOUND_AMOUNT_USD,
      SUM(
        CASE UPPER(SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1)) = INBOUND_ASSET
          WHEN TRUE THEN FROM_AMOUNT
          ELSE 0
        END)
          -- Edge case where THORNode pulls out affiliate fees for inbound THOR.RUNE for affiliate fees but doesn't broadcast to Midgard.
          / (CASE WHEN INBOUND_ASSET <> 'THOR.RUNE' THEN 1 ELSE 1.0*(10000 - SPLIT_PART(s.MEMO, ':', 6)::INT)/1E4 END) AS INBOUND_AMOUNT,
      -- To get net affiliate fees, subtract out 0.02 RUNE (in USD) for the transfer from Pool Module
      SUM(
        CASE UPPER(SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1)) = INBOUND_ASSET 
          WHEN TRUE THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4
          ELSE 0
        END
      ) - (CASE WHEN MAX(COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0)) = 0 THEN 0 ELSE 0.02 / AVG(RUNE_USD) END) AS AFFILIATE_FEES_USD,
      -- To get net affiliate fees, subtract out 0.02 RUNE for the transfer from Pool Module
      SUM(
        CASE UPPER(SPLIT_PART(REGEXP_REPLACE(b.FROM_ASSET, '[~/]{1}', '.'), '-', 1)) = INBOUND_ASSET 
          WHEN TRUE THEN 1.0 * FROM_AMOUNT_USD * COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0) / 1e4 / RUNE_USD
          ELSE 0
        END
      ) - CASE WHEN MAX(COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0)) = 0 THEN 0 ELSE 0.02 END AS AFFILIATE_FEES_RUNE,
      SUM(LIQ_FEE_RUNE_USD) AS LIQUIDITY_FEES_USD,
      (1.0 * LIQUIDITY_FEES_USD / INBOUND_AMOUNT_USD * 1E4)::INT AS SWAP_SLIP_BPS,
      MAX(COALESCE(AFFILIATE_FEE_BASIS_POINTS, 0)) AS AFFILIATE_FEE_BASIS_POINTS
    FROM thorchain.defi.fact_swaps AS b
    JOIN successful_swaps AS s
      ON b.TX_ID = s.TX_ID
    WHERE TRUE
      AND b.BLOCK_TIMESTAMP >= (SELECT start_date FROM date_range)
      AND b.BLOCK_TIMESTAMP < (SELECT end_date FROM date_range) + INTERVAL '1 DAY'
    GROUP BY 1,2,3,4,5,6,7,8,9
  )
  , outbound AS (
      SELECT
          IN_TX AS TX_ID,
          SUM(ASSET_E8)/1e8 AS OUTBOUND_AMOUNT
      FROM thorchain.defi.fact_outbound_events
      WHERE TRUE
          AND BLOCK_TIMESTAMP >= (SELECT start_date FROM date_range)
          AND BLOCK_TIMESTAMP < (SELECT end_date FROM date_range) + INTERVAL '1 DAY'
          AND TX_ID IS NOT NULL
      GROUP BY 1
  )
  , base AS (
  SELECT
    DATE,
    AFFILIATE_ADDRESS,
    i.BLOCK_TIMESTAMP,
    b.BLOCK_ID AS BLOCK_HEIGHT,
    i.TX_ID,
    MEMO,
    INBOUND_AMOUNT_USD AS SWAP_SIZE_USD,
    INBOUND_ADDRESS,
    INBOUND_AMOUNT,
    INBOUND_ASSET,
    LOWER(SPLIT_PART(MEMO,':', 3)) AS OUTBOUND_ADDRESS,
    OUTBOUND_AMOUNT,
    OUTBOUND_ASSET,
    AFFILIATE_FEES_USD,
    LIQUIDITY_FEES_USD,
    SWAP_SLIP_BPS,
    IS_STREAMING,
    IS_TRADE_ASSET_SWAP,
    IS_SYNTH_SWAP,
    AFFILIATE_FEE_BASIS_POINTS
  FROM inbound AS i
  JOIN outbound AS o
      ON i.TX_ID = o.TX_ID
  JOIN thorchain.core.dim_block AS b
    ON i.BLOCK_TIMESTAMP = b.BLOCK_TIMESTAMP
  ORDER BY i.BLOCK_TIMESTAMP 
  )
  SELECT
    CASE 
      when AFFILIATE_ADDRESS in ('t', 'T', 'thor160yye65pf9rzwrgqmtgav69n6zlsyfpgm9a7xk') then 'THORSwap'
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
      when AFFILIATE_ADDRESS in ('va', 'vi', 'v0', 'wr', 'thor1a427q3v96psuj4fnughdw8glt5r7j38lj7rkp8') then 'vultisig'
      when AFFILIATE_ADDRESS = 'cakewallet' then 'Cake Wallet'
      when AFFILIATE_ADDRESS = 'okw' then 'OKX'
      else AFFILIATE_ADDRESS
    end AS AFFILIATE,
    MIN(DATE) AS START_DATE,
    MAX(DATE) AS END_DATE,
    SUM(SWAP_SIZE_USD) AS TOTAL_VOLUME_USD,
    SUM(AFFILIATE_FEES_USD) AS AFFILIATE_FEES_USD,
    COUNT(DISTINCT TX_ID) AS TOTAL_SWAPS,
    AVG(SWAP_SLIP_BPS) AS AVG_SWAP_SLIP_BPS,
    MEDIAN(SWAP_SLIP_BPS) AS MEDIAN_SWAP_SLIP_BPS,
    AVG(SWAP_SIZE_USD) AS VC,
    MEDIAN(SWAP_SIZE_USD) AS MEDIAN_SWAP_SIZE_USD,
    AVG(AFFILIATE_FEE_BASIS_POINTS) AS AVG_AFFILIATE_FEE_BASIS_POINTS
  FROM base
  GROUP BY 1
  ORDER BY 4 DESC
 `; 

 return affiliateSwapsByWallet
}

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
	affiliatSwapsDuration,
  dailyAffiliateMade,
};