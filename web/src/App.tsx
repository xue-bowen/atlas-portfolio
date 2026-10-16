import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import "./App.css";
import { TransactionEditor } from "./components/TransactionEditor";
import { replaceLedgerEvent } from "./domain/editLedgerEvent";
import {
  CachedFxRateService,
  type FxRateResolution,
} from "./data/cachedFxRateService";
import {
  CachedSecurityQuoteService,
  type SecurityQuoteResolution,
} from "./data/cachedSecurityQuoteService";
import {
  hasInitializedPersonalLedger,
  initializeEmptyPersonalLedger,
  loadLedger,
  parsePortfolioBackup,
  saveLedger,
  savePersonalLedger,
  serializePortfolioBackup,
} from "./data/ledgerStorage";
import { IndexedDbMarketDataCache } from "./data/marketDataCache";
import { EastmoneyUsEodProvider } from "./data/providers/eastmoneyUsEodProvider";
import { FrankfurterFxProvider } from "./data/providers/frankfurterFxProvider";
import { createTradingViewSymbolUrl } from "./data/tradingViewLink";
import {
  clearSecurityProfiles,
  loadSecurityProfileRegistry,
  saveSecurityProfiles,
} from "./data/securityProfileStorage";
import { calculateBalances } from "./domain/calculateBalances";
import { calculateCashValuation } from "./domain/calculateCashValuation";
import { calculateUsdCashHistory } from "./domain/calculateUsdCashHistory";
import {
  calculateHoldingsValuation,
  type PositionSecurityMapping,
} from "./domain/calculateHoldingsValuation";
import {
  calculatePortfolioValuation,
  type PortfolioValuationUnavailableReason,
} from "./domain/calculatePortfolioValuation";
import type { Currency, LedgerEvent } from "./domain/ledger";
import type { FxRateRequest, MarketDataAssetType } from "./domain/marketData";
import { removeLedgerEvent } from "./domain/removeLedgerEvent";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const cny = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

const hkd = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
});

const currencyFormatters: Record<Currency, Intl.NumberFormat> = {
  CNY: cny,
  HKD: hkd,
  USD: usd,
};

const fxRateNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

type ValuationFxKey = "USD_CNY" | "HKD_CNY";

const valuationFxRequests: Array<{
  key: ValuationFxKey;
  label: string;
  request: FxRateRequest;
}> = [
  {
    key: "USD_CNY",
    label: "USD/CNY",
    request: { pair: { baseCurrency: "USD", quoteCurrency: "CNY" } },
  },
  {
    key: "HKD_CNY",
    label: "HKD/CNY",
    request: { pair: { baseCurrency: "HKD", quoteCurrency: "CNY" } },
  },
];

const valuationFxService = new CachedFxRateService(
  new IndexedDbMarketDataCache(),
  new FrankfurterFxProvider(),
);

const holdingsMarketDataCache = new IndexedDbMarketDataCache();

type ValuationFxRates = Partial<Record<ValuationFxKey, FxRateResolution>>;

type ExpenseCategory = "ADR_FEE" | "OTHER";

type TransactionEntryType =
  | "BUY"
  | "SELL"
  | "CNY_DEPOSIT"
  | "CNY_WITHDRAWAL"
  | "FX_TO_USD"
  | "DIVIDEND"
  | "INTEREST"
  | "FEE"
  | "IN_KIND_CONTRIBUTION";

const transactionEntryOptions: Array<{
  type: TransactionEntryType;
  label: string;
  legacyTargetId?: string;
}> = [
  { type: "BUY", label: "Buy security" },
  { type: "SELL", label: "Sell security" },
  {
    type: "CNY_DEPOSIT",
    label: "CNY deposit",
    legacyTargetId: "legacy-cny-deposit",
  },
  {
    type: "CNY_WITHDRAWAL",
    label: "CNY withdrawal",
    legacyTargetId: "legacy-cny-withdrawal",
  },
  {
    type: "FX_TO_USD",
    label: "CNY to USD conversion",
    legacyTargetId: "legacy-fx-to-usd",
  },
  {
    type: "DIVIDEND",
    label: "Dividend",
    legacyTargetId: "legacy-dividend",
  },
  {
    type: "INTEREST",
    label: "Interest income",
    legacyTargetId: "legacy-interest",
  },
  { type: "FEE", label: "USD expense", legacyTargetId: "legacy-expense" },
  {
    type: "IN_KIND_CONTRIBUTION",
    label: "Payment cashback shares",
    legacyTargetId: "legacy-cashback-shares",
  },
];

type PositionQuoteState =
  | { status: "LOADING" }
  | { status: "RESOLVED"; resolution: SecurityQuoteResolution }
  | { status: "ERROR"; error: string };

type PositionQuoteStates = Record<string, PositionQuoteState>;

function describeFxStatus(resolution: FxRateResolution): string {
  const baseStatus =
    resolution.status === "PROVIDER_FRESH"
      ? "Fresh from provider"
      : resolution.status === "CACHE_FRESH"
        ? "Fresh cache"
        : "Stale fallback";

  return resolution.refreshError
    ? `${baseStatus} · refresh failed`
    : baseStatus;
}

function describeSecurityQuoteStatus(
  resolution: SecurityQuoteResolution,
): string {
  const baseStatus =
    resolution.status === "PROVIDER_FRESH"
      ? "Fresh from provider"
      : resolution.status === "CACHE_FRESH"
        ? "Fresh cache"
        : "Stale cache";

  return resolution.refreshError
    ? `${baseStatus} · refresh unavailable`
    : baseStatus;
}

function displayDateTime(timestamp: string): string {
  const date = new Date(timestamp);

  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : timestamp;
}

function createLedgerEventId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

const portfolioValuationReasonLabels: Record<
  PortfolioValuationUnavailableReason,
  string
> = {
  CASH_VALUATION_INCOMPLETE: "a non-zero cash currency lacks an FX rate",
  SECURITY_COVERAGE_INCOMPLETE:
    "one or more open positions lack a profile or quote",
  USD_CNY_RATE_UNAVAILABLE:
    "USD/CNY is unavailable for securities conversion",
};

function describeEvent(event: LedgerEvent): string {
  switch (event.type) {
    case "CNY_DEPOSIT":
      return `Deposit ¥${event.amountCny.toFixed(2)}`;
    case "CNY_WITHDRAWAL":
      return `Withdraw ¥${event.amountCny.toFixed(2)}`;
    case "FX_TO_USD":
      return `Exchange ¥${event.amountCny.toFixed(2)} → $${event.amountUsd.toFixed(2)}`;
    case "FX_TO_CNY":
      return `Exchange $${event.amountUsd.toFixed(2)} → ¥${event.amountCny.toFixed(2)}`;
    case "BUY":
      return `Buy ${event.quantity} ${event.symbol} @ $${event.priceUsd.toFixed(2)}`;
    case "SELL":
      return `Sell ${event.quantity} ${event.symbol} @ $${event.priceUsd.toFixed(2)}`;
    case "IN_KIND_CONTRIBUTION":
      return `Payment cashback: ${event.quantity} ${event.symbol} @ $${event.priceUsd.toFixed(2)}`;
    case "DIVIDEND":
      return `${event.symbol} dividend: $${event.grossAmountUsd.toFixed(2)} gross`;
    case "INTEREST":
      if ("amountUsd" in event) {
        return `Interest received after tax: ${usd.format(event.amountUsd)}`;
      }

      return `Interest received after tax: ${currencyFormatters[
        event.currency
      ].format(event.amount)}`;
    case "FEE":
      return `${
        event.category === "ADR_FEE"
          ? "ADR custody fee"
          : event.category === "COMMISSION"
            ? "Commission"
            : "Other USD expense"
      }: ${usd.format(event.amountUsd)}`;
  }
}

export default function App() {
  const [ledger, setLedger] = useState(loadLedger);
  const [isPersonalLedger, setIsPersonalLedger] = useState(
    hasInitializedPersonalLedger,
  );
  const [depositDate, setDepositDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawalDate, setWithdrawalDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [fxDate, setFxDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [fxAmountCny, setFxAmountCny] = useState("");
  const [fxAmountUsd, setFxAmountUsd] = useState("");
  const [buyDate, setBuyDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [buySymbol, setBuySymbol] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("");
  const [buyPriceUsd, setBuyPriceUsd] = useState("");
  const [buyFeeUsd, setBuyFeeUsd] = useState("0");
  const [buyNote, setBuyNote] = useState("");
  const [cashbackDate, setCashbackDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [cashbackSymbol, setCashbackSymbol] = useState("");
  const [cashbackQuantity, setCashbackQuantity] = useState("");
  const [cashbackPriceUsd, setCashbackPriceUsd] = useState("");
  const [sellDate, setSellDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sellSymbol, setSellSymbol] = useState("");
  const [sellQuantity, setSellQuantity] = useState("");
  const [sellPriceUsd, setSellPriceUsd] = useState("");
  const [sellFeeUsd, setSellFeeUsd] = useState("0");
  const [sellNote, setSellNote] = useState("");
  const [dividendDate, setDividendDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [dividendSymbol, setDividendSymbol] = useState("");
  const [dividendGrossAmountUsd, setDividendGrossAmountUsd] = useState("");
  const [dividendWithholdingTaxUsd, setDividendWithholdingTaxUsd] =
    useState("0");
  const [dividendPaymentMethod, setDividendPaymentMethod] = useState("CASH");
  const [dividendReinvestmentPriceUsd, setDividendReinvestmentPriceUsd] =
    useState("");
  const [interestDate, setInterestDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [interestCurrency, setInterestCurrency] = useState<Currency>("USD");
  const [interestAmount, setInterestAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expenseCategory, setExpenseCategory] =
    useState<ExpenseCategory>("ADR_FEE");
  const [expenseAmountUsd, setExpenseAmountUsd] = useState("");
  const [selectedTransactionType, setSelectedTransactionType] =
    useState<TransactionEntryType | "">("");
  const [selectedLedgerEventId, setSelectedLedgerEventId] = useState<
    string | null
  >(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [isMoreNavigationOpen, setIsMoreNavigationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [securityProfileRegistry, setSecurityProfileRegistry] = useState(
    loadSecurityProfileRegistry,
  );
  const [profilePositionSymbol, setProfilePositionSymbol] = useState("");
  const [profileProviderSymbol, setProfileProviderSymbol] = useState("");
  const [profileExchange, setProfileExchange] = useState("");
  const [profileAssetType, setProfileAssetType] =
    useState<MarketDataAssetType>("STOCK");
  const [positionQuoteStates, setPositionQuoteStates] =
    useState<PositionQuoteStates>({});
  const holdingsQuoteRequestId = useRef(0);
  const [valuationFxRates, setValuationFxRates] =
    useState<ValuationFxRates>({});
  const [isValuationFxLoading, setIsValuationFxLoading] = useState(false);
  const [valuationFxError, setValuationFxError] = useState("");

  const refreshValuationFxRates = useCallback(
    async (forceRefresh: boolean) => {
      setIsValuationFxLoading(true);
      setValuationFxError("");

      const results = await Promise.all(
        valuationFxRequests.map(async (item) => {
          try {
            const resolution = await valuationFxService.getFxRate(
              item.request,
              { forceRefresh },
            );

            return { item, resolution };
          } catch (error) {
            return {
              item,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown valuation FX error.",
            };
          }
        }),
      );

      setValuationFxRates((currentRates) => {
        const nextRates = { ...currentRates };

        for (const result of results) {
          if ("resolution" in result) {
            nextRates[result.item.key] = result.resolution;
          }
        }

        return nextRates;
      });

      const errors = results
        .filter((result) => "error" in result)
        .map((result) => `${result.item.label}: ${result.error}`);

      setValuationFxError(errors.join(" "));
      setIsValuationFxLoading(false);
    },
    [],
  );

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshValuationFxRates(false);
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [refreshValuationFxRates]);

  const balances = calculateBalances(ledger);
  const securityProfiles = securityProfileRegistry.profiles;
  const resolvedSecurityQuotes = Object.values(positionQuoteStates)
    .filter(
      (state): state is Extract<PositionQuoteState, { status: "RESOLVED" }> =>
        state.status === "RESOLVED",
    )
    .map((state) => state.resolution.quote);
  const holdingsValuation = calculateHoldingsValuation(
    balances.positions,
    securityProfiles,
    resolvedSecurityQuotes,
  );
  const cashValuation = calculateCashValuation({
    cnyCash: balances.cnyCash,
    hkdCash: balances.hkdCash,
    usdCash: balances.usdCash,
    hkdCnyRate: valuationFxRates.HKD_CNY?.rate.rate,
    usdCnyRate: valuationFxRates.USD_CNY?.rate.rate,
  });
  const portfolioValuation = calculatePortfolioValuation({
    cashValuation,
    holdingsValuation,
    usdCnyRate: valuationFxRates.USD_CNY?.rate.rate,
  });
  const securityQuoteDates = holdingsValuation.valuedPositions
    .map((position) => position.quote.marketTimestamp.slice(0, 10))
    .sort();
  const securityQuoteDateRange =
    securityQuoteDates.length === 0
      ? "Unavailable"
      : securityQuoteDates[0] === securityQuoteDates.at(-1)
        ? securityQuoteDates[0]
        : `${securityQuoteDates[0]} to ${securityQuoteDates.at(-1)}`;
  const staleSecurityQuoteCount = Object.values(positionQuoteStates).filter(
    (state) =>
      state.status === "RESOLVED" &&
      state.resolution.status === "CACHE_STALE",
  ).length;
  const staleCashValuationCurrencies = valuationFxRequests
    .filter(({ key }) => {
      const resolution = valuationFxRates[key];
      const cashBalance = key === "USD_CNY" ? balances.usdCash : balances.hkdCash;

      return cashBalance !== 0 && resolution?.status === "CACHE_STALE";
    })
    .map(({ request }) => request.pair.baseCurrency);
  const usdCashHistory = calculateUsdCashHistory(ledger);
  const selectedLedgerEvent = ledger.find(
    (event) => event.id === selectedLedgerEventId,
  );
  const netDividendUsd =
    Number(dividendGrossAmountUsd) - Number(dividendWithholdingTaxUsd);
  const reinvestmentShares =
    netDividendUsd / Number(dividendReinvestmentPriceUsd);
  const previewBuySymbol = buySymbol.trim().toUpperCase();
  const previewBuyQuantity = Number(buyQuantity);
  const previewBuyPriceUsd = Number(buyPriceUsd);
  const previewBuyFeeUsd = Number(buyFeeUsd);
  const isBuyPreviewComplete =
    Boolean(buyDate && previewBuySymbol) &&
    Number.isFinite(previewBuyQuantity) &&
    previewBuyQuantity > 0 &&
    Number.isFinite(previewBuyPriceUsd) &&
    previewBuyPriceUsd > 0 &&
    Number.isFinite(previewBuyFeeUsd) &&
    previewBuyFeeUsd >= 0;
  const previewBuyTradeCostUsd = isBuyPreviewComplete
    ? previewBuyQuantity * previewBuyPriceUsd + previewBuyFeeUsd
    : undefined;
  const previewBuyPosition = balances.positions.find(
    (position) => position.symbol === previewBuySymbol,
  );
  const previewBuyResultingQuantity =
    isBuyPreviewComplete && previewBuyPosition
      ? previewBuyPosition.quantity + previewBuyQuantity
      : isBuyPreviewComplete
        ? previewBuyQuantity
        : undefined;
  const previewBuyResultingCostUsd =
    isBuyPreviewComplete && previewBuyTradeCostUsd !== undefined
      ? (previewBuyPosition?.costUsd ?? 0) + previewBuyTradeCostUsd
      : undefined;
  const canSaveBuy =
    previewBuyTradeCostUsd !== undefined &&
    previewBuyTradeCostUsd <= balances.usdCash;
  const previewSellSymbol = sellSymbol.trim().toUpperCase();
  const previewSellQuantity = Number(sellQuantity);
  const previewSellPriceUsd = Number(sellPriceUsd);
  const previewSellFeeUsd = Number(sellFeeUsd);
  const isSellPreviewComplete =
    Boolean(sellDate && previewSellSymbol) &&
    Number.isFinite(previewSellQuantity) &&
    previewSellQuantity > 0 &&
    Number.isFinite(previewSellPriceUsd) &&
    previewSellPriceUsd > 0 &&
    Number.isFinite(previewSellFeeUsd) &&
    previewSellFeeUsd >= 0;
  const previewSellPosition = balances.positions.find(
    (position) => position.symbol === previewSellSymbol,
  );
  let projectedSellBalances: ReturnType<typeof calculateBalances> | undefined;
  let sellImpact: { proceedsUsd: number; realizedPnlUsd: number } | undefined;
  let sellPreviewError = "";

  if (isSellPreviewComplete) {
    if (
      !previewSellPosition ||
      previewSellQuantity > previewSellPosition.quantity
    ) {
      sellPreviewError = "Sell quantity cannot exceed the current position.";
    } else {
      try {
        const sale: LedgerEvent = {
          id: "sell-preview",
          occurredAt: sellDate,
          accountId: "personal-main",
          type: "SELL",
          symbol: previewSellSymbol,
          quantity: previewSellQuantity,
          priceUsd: previewSellPriceUsd,
          feeUsd: previewSellFeeUsd,
        };
        // Same-day entries precede this new sale, just as they do on save.
        const precedingLedger = ledger.filter(
          (event) => event.occurredAt <= sellDate,
        );
        const beforeSale = calculateBalances(precedingLedger);
        const afterSale = calculateBalances([...precedingLedger, sale]);
        const projected = calculateBalances([...ledger, sale]);
        const proceedsUsd = afterSale.usdCash - beforeSale.usdCash;
        const realizedPnlUsd =
          afterSale.realizedPnlUsd - beforeSale.realizedPnlUsd;

        if (
          ![
            proceedsUsd,
            realizedPnlUsd,
            projected.usdCash,
            projected.realizedPnlUsd,
            projected.totalFeesUsd,
            ...projected.positions.flatMap((position) => [
              position.quantity,
              position.costUsd,
            ]),
          ].every(Number.isFinite)
        ) {
          throw new Error("Sale amounts are too large. Enter smaller values.");
        }

        sellImpact = { proceedsUsd, realizedPnlUsd };
        projectedSellBalances = projected;
      } catch (error) {
        sellPreviewError =
          error instanceof Error
            ? error.message
            : "This sale is not valid in chronological ledger order.";
      }
    }
  }

  const projectedSellPosition = projectedSellBalances?.positions.find(
    (position) => position.symbol === previewSellSymbol,
  );
  const canSaveSell = Boolean(projectedSellBalances && sellImpact);

  const refreshHoldingsQuotes = useCallback(
    async (forceRefresh: boolean) => {
      const requestId = holdingsQuoteRequestId.current + 1;
      holdingsQuoteRequestId.current = requestId;

      const openPositionSymbols = new Set(
        calculateBalances(ledger).positions.map((position) =>
          position.symbol.toUpperCase(),
        ),
      );
      const mappedOpenPositions = securityProfileRegistry.profiles.filter(
        (profile) => openPositionSymbols.has(profile.positionSymbol),
      );
      const loadingStates = Object.fromEntries(
        mappedOpenPositions.map((profile) => [
          profile.positionSymbol,
          { status: "LOADING" as const },
        ]),
      );

      setPositionQuoteStates(loadingStates);

      const quoteService = new CachedSecurityQuoteService(
        holdingsMarketDataCache,
        new EastmoneyUsEodProvider(),
      );

      const results = await Promise.all(
        mappedOpenPositions.map(async (profile) => {
          try {
            const resolution = await quoteService.getSecurityQuote(
              { security: profile.security },
              { forceRefresh },
            );

            return {
              positionSymbol: profile.positionSymbol,
              state: { status: "RESOLVED" as const, resolution },
            };
          } catch (error) {
            return {
              positionSymbol: profile.positionSymbol,
              state: {
                status: "ERROR" as const,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown security quote error.",
              },
            };
          }
        }),
      );

      if (holdingsQuoteRequestId.current !== requestId) {
        return;
      }

      setPositionQuoteStates(
        Object.fromEntries(
          results.map((result) => [result.positionSymbol, result.state]),
        ),
      );
    },
    [ledger, securityProfileRegistry.profiles],
  );

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshHoldingsQuotes(false);
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [refreshHoldingsQuotes]);

  function resetSecurityProfileForm() {
    setProfilePositionSymbol("");
    setProfileProviderSymbol("");
    setProfileExchange("");
    setProfileAssetType("STOCK");
  }

  function selectProfilePosition(positionSymbol: string) {
    setProfilePositionSymbol(positionSymbol);

    const existingProfile = securityProfiles.find(
      (profile) => profile.positionSymbol === positionSymbol,
    );

    setProfileProviderSymbol(
      existingProfile?.security.symbol ?? positionSymbol,
    );
    setProfileExchange(existingProfile?.security.exchange ?? "");
    setProfileAssetType(existingProfile?.security.assetType ?? "STOCK");
  }

  function saveSecurityProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const positionSymbol = profilePositionSymbol.trim().toUpperCase();
    const providerSymbol = profileProviderSymbol.trim().toUpperCase();
    const exchange = profileExchange.trim().toUpperCase();
    const positionExists = balances.positions.some(
      (position) => position.symbol.toUpperCase() === positionSymbol,
    );

    if (!positionExists || !providerSymbol || !exchange) {
      setMessage(
        "Choose an open position and enter its market-data symbol and exchange.",
      );
      return;
    }

    const profile: PositionSecurityMapping = {
      positionSymbol,
      security: {
        symbol: providerSymbol,
        exchange,
        currency: "USD",
        assetType: profileAssetType,
      },
    };
    const nextProfiles = [
      ...securityProfiles.filter(
        (item) => item.positionSymbol !== positionSymbol,
      ),
      profile,
    ];

    try {
      const savedProfiles = saveSecurityProfiles(nextProfiles);

      setSecurityProfileRegistry({
        status: "LOADED",
        profiles: savedProfiles,
      });
      setMessage(
        `Security profile for ${positionSymbol} saved locally in this browser.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Could not save the security profile: ${error.message}`
          : "Could not save the security profile.",
      );
    }
  }

  function persistLedgerChanges(events: LedgerEvent[]): boolean {
    try {
      const orderedEvents = saveLedger(events);

      setLedger(orderedEvents);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Could not save the transaction: ${error.message}`
          : "Could not save the transaction in chronological order.",
      );
      return false;
    }
  }

  function startEmptyPersonalLedger() {
    const confirmed = window.confirm(
      "This will replace the local demo/test ledger with an empty personal ledger. Continue?",
    );

    if (!confirmed) {
      return;
    }

    clearSecurityProfiles();
    setSecurityProfileRegistry({ status: "EMPTY", profiles: [] });
    resetSecurityProfileForm();
    setEditingEventId(null);
    setSelectedLedgerEventId(null);
    setLedger(initializeEmptyPersonalLedger());
    setIsPersonalLedger(true);
    setMessage("Empty personal ledger initialized locally in this browser.");
  }

  function addCnyDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(depositAmount);

    if (!depositDate || !Number.isFinite(amountCny) || amountCny <= 0) {
      setMessage("Please enter a valid date and a positive CNY amount.");
      return;
    }

    const deposit: LedgerEvent = {
      id: createLedgerEventId("deposit"),
      occurredAt: depositDate,
      accountId: "personal-main",
      type: "CNY_DEPOSIT",
      amountCny,
      note: "Manual CNY deposit",
    };

    if (!persistLedgerChanges([...ledger, deposit])) {
      return;
    }
    setDepositAmount("");
    setMessage("Deposit saved locally in this browser.");
  }

  function addCnyWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(withdrawalAmount);

    if (!withdrawalDate || !Number.isFinite(amountCny) || amountCny <= 0) {
      setMessage("Please enter a valid date and a positive CNY amount.");
      return;
    }

    if (amountCny > balances.cnyCash) {
      setMessage("Withdrawal cannot exceed current CNY cash.");
      return;
    }

    const withdrawal: LedgerEvent = {
      id: createLedgerEventId("withdrawal"),
      occurredAt: withdrawalDate,
      accountId: "personal-main",
      type: "CNY_WITHDRAWAL",
      amountCny,
      note: "Manual CNY withdrawal",
    };

    if (!persistLedgerChanges([...ledger, withdrawal])) {
      return;
    }
    setWithdrawalAmount("");
    setMessage("CNY withdrawal saved locally in this browser.");
  }

  function addFxToUsd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(fxAmountCny);
    const amountUsd = Number(fxAmountUsd);

    if (
      !fxDate ||
      !Number.isFinite(amountCny) ||
      amountCny <= 0 ||
      !Number.isFinite(amountUsd) ||
      amountUsd <= 0
    ) {
      setMessage("Please enter a valid date, CNY amount, and USD amount.");
      return;
    }

    if (amountCny > balances.cnyCash) {
      setMessage("CNY spent cannot exceed current CNY cash.");
      return;
    }

    const fxConversion: LedgerEvent = {
      id: createLedgerEventId("fx-usd"),
      occurredAt: fxDate,
      accountId: "personal-main",
      type: "FX_TO_USD",
      amountCny,
      amountUsd,
      note: "Manual CNY to USD conversion",
    };

    if (!persistLedgerChanges([...ledger, fxConversion])) {
      return;
    }
    setFxAmountCny("");
    setFxAmountUsd("");
    setMessage("FX conversion saved locally in this browser.");
  }

  function addBuy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = buySymbol.trim().toUpperCase();
    const quantity = Number(buyQuantity);
    const priceUsd = Number(buyPriceUsd);
    const feeUsd = Number(buyFeeUsd);

    if (
      !buyDate ||
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(priceUsd) ||
      priceUsd <= 0 ||
      !Number.isFinite(feeUsd) ||
      feeUsd < 0
    ) {
      setMessage(
        "Please enter a valid date, symbol, quantity, USD price, and fee.",
      );
      return;
    }

    const tradeCost = quantity * priceUsd + feeUsd;

    if (tradeCost > balances.usdCash) {
      setMessage("Trade cost cannot exceed current USD cash.");
      return;
    }

    const buy: LedgerEvent = {
      id: createLedgerEventId("buy"),
      occurredAt: buyDate,
      accountId: "personal-main",
      type: "BUY",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: buyNote.trim() || "Manual security purchase",
    };

    if (!persistLedgerChanges([...ledger, buy])) {
      return;
    }
    setBuySymbol("");
    setBuyQuantity("");
    setBuyPriceUsd("");
    setBuyFeeUsd("0");
    setBuyNote("");
    setMessage("Buy transaction saved locally in this browser.");
  }

  function addSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = sellSymbol.trim().toUpperCase();
    const quantity = Number(sellQuantity);
    const priceUsd = Number(sellPriceUsd);
    const feeUsd = Number(sellFeeUsd);

    if (
      !sellDate ||
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(priceUsd) ||
      priceUsd <= 0 ||
      !Number.isFinite(feeUsd) ||
      feeUsd < 0
    ) {
      setMessage(
        "Please enter a valid date, symbol, quantity, USD price, and fee.",
      );
      return;
    }

    const position = balances.positions.find(
      (currentPosition) => currentPosition.symbol === symbol,
    );

    if (!position || quantity > position.quantity) {
      setMessage("Sell quantity cannot exceed the current position.");
      return;
    }

    if (!canSaveSell) {
      setMessage(
        sellPreviewError ||
          "Complete the required fields to preview this sale.",
      );
      return;
    }

    const sell: LedgerEvent = {
      id: createLedgerEventId("sell"),
      occurredAt: sellDate,
      accountId: "personal-main",
      type: "SELL",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: sellNote.trim() || "Manual security sale",
    };

    if (!persistLedgerChanges([...ledger, sell])) {
      return;
    }
    setSellSymbol("");
    setSellQuantity("");
    setSellPriceUsd("");
    setSellFeeUsd("0");
    setSellNote("");
    setMessage("Sell transaction saved locally in this browser.");
  }

  function addCashbackShares(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = cashbackSymbol.trim().toUpperCase();
    const quantity = Number(cashbackQuantity);
    const priceUsd = Number(cashbackPriceUsd);

    if (
      !cashbackDate ||
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(priceUsd) ||
      priceUsd <= 0
    ) {
      setMessage(
        "Please enter a valid date, symbol, quantity, and USD acquisition price.",
      );
      return;
    }

    const contribution: LedgerEvent = {
      id: createLedgerEventId("cashback-shares"),
      occurredAt: cashbackDate,
      accountId: "personal-main",
      type: "IN_KIND_CONTRIBUTION",
      source: "CASHBACK_REWARD",
      symbol,
      quantity,
      priceUsd,
      currency: "USD",
      note: "Payment cashback received directly as shares",
    };

    if (!persistLedgerChanges([...ledger, contribution])) {
      return;
    }
    setCashbackSymbol("");
    setCashbackQuantity("");
    setCashbackPriceUsd("");
    setMessage(
      "Cashback shares saved as a non-cash contribution. Cash balances were not changed.",
    );
  }

  function addDividend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = dividendSymbol.trim().toUpperCase();
    const grossAmountUsd = Number(dividendGrossAmountUsd);
    const withholdingTaxUsd = Number(dividendWithholdingTaxUsd);
    const reinvestmentPriceUsd = Number(dividendReinvestmentPriceUsd);

    if (
      !dividendDate ||
      !symbol ||
      !Number.isFinite(grossAmountUsd) ||
      grossAmountUsd <= 0 ||
      !Number.isFinite(withholdingTaxUsd) ||
      withholdingTaxUsd < 0 ||
      withholdingTaxUsd > grossAmountUsd
    ) {
      setMessage(
        "Please enter a valid date, symbol, gross USD amount, and withholding tax.",
      );
      return;
    }

    const netDividendUsd = grossAmountUsd - withholdingTaxUsd;
    const isReinvested = dividendPaymentMethod === "REINVEST";
    const reinvestmentQuantity = netDividendUsd / reinvestmentPriceUsd;

    if (
      isReinvested &&
      (!Number.isFinite(reinvestmentPriceUsd) ||
        reinvestmentPriceUsd <= 0 ||
        netDividendUsd <= 0)
    ) {
      setMessage(
        "Reinvestment requires a positive net dividend and USD price.",
      );
      return;
    }

    const dividend: LedgerEvent = {
      id: createLedgerEventId("dividend"),
      occurredAt: dividendDate,
      accountId: "personal-main",
      type: "DIVIDEND",
      symbol,
      grossAmountUsd,
      withholdingTaxUsd,
      note: isReinvested
        ? "Manual dividend payment with reinvestment"
        : "Manual cash dividend payment",
    };

    const reinvestment: LedgerEvent[] = isReinvested
      ? [
          {
            id: createLedgerEventId("dividend-reinvest"),
            occurredAt: dividendDate,
            accountId: "personal-main",
            type: "BUY",
            symbol,
            quantity: reinvestmentQuantity,
            priceUsd: reinvestmentPriceUsd,
            feeUsd: 0,
            note: "Automatic dividend reinvestment",
          },
        ]
      : [];
    if (!persistLedgerChanges([...ledger, dividend, ...reinvestment])) {
      return;
    }
    setDividendSymbol("");
    setDividendGrossAmountUsd("");
    setDividendWithholdingTaxUsd("0");
    setDividendReinvestmentPriceUsd("");
    setMessage(
      isReinvested
        ? "Dividend and reinvestment saved locally in this browser."
        : "Cash dividend saved locally in this browser.",
    );
  }

  function addInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(interestAmount);

    if (!interestDate || !Number.isFinite(amount) || amount <= 0) {
      setMessage("Please enter a valid date and a positive amount received.");
      return;
    }

    const interest: LedgerEvent = {
      id: createLedgerEventId("interest"),
      occurredAt: interestDate,
      accountId: "personal-main",
      type: "INTEREST",
      currency: interestCurrency,
      amount,
      note: "Manual interest payment received after tax",
    };

    if (!persistLedgerChanges([...ledger, interest])) {
      return;
    }
    setInterestAmount("");
    setMessage(
      `${interestCurrency} interest saved locally as an after-tax amount.`,
    );
  }

  function addUsdExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountUsd = Number(expenseAmountUsd);

    if (!expenseDate || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      setMessage("Please enter a valid date and a positive USD amount.");
      return;
    }

    if (amountUsd > balances.usdCash) {
      setMessage("USD expense cannot exceed current USD cash.");
      return;
    }

    const expense: LedgerEvent = {
      id: createLedgerEventId("fee"),
      occurredAt: expenseDate,
      accountId: "personal-main",
      type: "FEE",
      amountUsd,
      category: expenseCategory,
      note:
        expenseCategory === "ADR_FEE"
          ? "Manual ADR custody fee"
          : "Manual other USD expense",
    };

    if (!persistLedgerChanges([...ledger, expense])) {
      return;
    }
    setExpenseAmountUsd("");
    setMessage(
      expenseCategory === "ADR_FEE"
        ? "ADR custody fee saved locally in this browser."
        : "Other USD expense saved locally in this browser.",
    );
  }

  function exportLedgerBackup() {
    const securityProfileRegistry = loadSecurityProfileRegistry();

    if (securityProfileRegistry.status === "INVALID") {
      setMessage(
        "Security profiles are invalid. The complete backup was not exported.",
      );
      return;
    }

    const backupJson = serializePortfolioBackup(
      ledger,
      securityProfileRegistry.profiles,
    );
    const backupBlob = new Blob([backupJson], {
      type: "application/json",
    });
    const backupUrl = URL.createObjectURL(backupBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = backupUrl;
    downloadLink.download = `atlas-portfolio-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    downloadLink.click();
    URL.revokeObjectURL(backupUrl);
    setMessage("Portfolio backup exported as a local JSON file.");
  }

  async function importLedgerBackup(event: ChangeEvent<HTMLInputElement>) {
    const fileInput = event.currentTarget;
    const backupFile = fileInput.files?.[0];

    if (!backupFile) {
      return;
    }

    try {
      const importedBackup = parsePortfolioBackup(await backupFile.text());

      const importedLedger = savePersonalLedger(importedBackup.ledger);
      if (importedBackup.securityProfiles.length > 0) {
        const importedProfiles = saveSecurityProfiles(
          importedBackup.securityProfiles,
        );
        setSecurityProfileRegistry({
          status: "LOADED",
          profiles: importedProfiles,
        });
      } else {
        clearSecurityProfiles();
        setSecurityProfileRegistry({ status: "EMPTY", profiles: [] });
      }
      resetSecurityProfileForm();
      setEditingEventId(null);
      setSelectedLedgerEventId(null);
      setLedger(importedLedger);
      setIsPersonalLedger(true);
      setMessage(
        `Imported ${importedBackup.ledger.length} ledger event(s) and ${importedBackup.securityProfiles.length} security profile(s).`,
      );
    } catch {
      setMessage("Could not import this file. Please choose a valid backup.");
    } finally {
      fileInput.value = "";
    }
  }

  function openTransactionEntry() {
    setIsMoreNavigationOpen(false);
    document.getElementById("transactions")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    document.getElementById("transaction-type")?.focus({ preventScroll: true });
  }

  function openLegacyTransactionForm() {
    const targetId = transactionEntryOptions.find(
      (option) => option.type === selectedTransactionType,
    )?.legacyTargetId;

    if (!targetId) {
      return;
    }

    document.getElementById(targetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function saveEditedLedgerEvent(replacement: LedgerEvent): boolean {
    try {
      const updatedLedger = replaceLedgerEvent(ledger, replacement);
      if (!persistLedgerChanges(updatedLedger)) return false;
      setEditingEventId(null);
      setMessage("Transaction updated and the entire ledger recalculated.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save this edit.",
      );
      return false;
    }
  }

  function deleteSelectedLedgerEvent() {
    if (!selectedLedgerEvent) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${describeEvent(selectedLedgerEvent)} on ${selectedLedgerEvent.occurredAt}? Atlas will recalculate the entire remaining ledger.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const remainingLedger = removeLedgerEvent(
        ledger,
        selectedLedgerEvent.id,
      );

      if (!persistLedgerChanges(remainingLedger)) {
        return;
      }
      setSelectedLedgerEventId(null);
      setMessage("Transaction deleted and the remaining ledger recalculated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Could not delete the transaction: ${error.message}`
          : "Could not delete the transaction because later records would become invalid.",
      );
    }
  }

  return (
    <main className="app-shell">
      <aside className="desktop-sidebar" aria-label="Primary navigation">
        <a className="sidebar-brand" href="#dashboard">
          Atlas Portfolio
        </a>
        <button
          className="global-add-transaction"
          type="button"
          onClick={openTransactionEntry}
        >
          Add transaction
        </button>
        <nav>
          <a href="#dashboard">Dashboard</a>
          <a href="#portfolio">Portfolio</a>
          <a href="#transactions">Transactions</a>
          <a href="#cash">Cash</a>
          <a href="#performance">Performance</a>
          <a href="#market-data">Market Data</a>
          <a href="#settings">Settings</a>
        </nav>
      </aside>

      <div className="app-content">
        <header id="dashboard" className="dashboard-header page-section">
          <p className="section-eyebrow">Dashboard</p>
          <h1>Atlas Portfolio</h1>
          <p>
            {isPersonalLedger
              ? "Personal ledger saved only in this browser."
              : "Demo ledger for calculation and development tests."}
          </p>
        </header>

        <section
          id="transactions"
          className="transaction-workspace page-section"
        >
          <div className="page-section-heading">
            <p className="section-eyebrow">Transactions</p>
            <h2>Add transaction</h2>
            <p>
              Choose the relevant transaction form below. A shared type,
              preview, and save flow will replace these forms incrementally.
            </p>
          </div>

          {isPersonalLedger && (
            <div className="transaction-entry-flow">
              <label
                className="transaction-type-selector"
                htmlFor="transaction-type"
              >
                <span>1. Select transaction type</span>
                <select
                  id="transaction-type"
                  value={selectedTransactionType}
                  onChange={(event) =>
                    setSelectedTransactionType(
                      event.target.value as TransactionEntryType | "",
                    )
                  }
                >
                  <option value="">Choose a transaction type</option>
                  {transactionEntryOptions.map((option) => (
                    <option key={option.type} value={option.type}>
                      {option.label}
                      {option.type === "BUY" || option.type === "SELL"
                        ? " · unified flow"
                        : " · existing form"}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTransactionType === "BUY" && (
                <form className="unified-transaction-form" onSubmit={addBuy}>
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>Buy security</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={buyDate}
                          onChange={(event) => setBuyDate(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Account
                        <input value="personal-main" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Instrument</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Symbol
                        <input
                          type="text"
                          value={buySymbol}
                          onChange={(event) => setBuySymbol(event.target.value)}
                          placeholder="e.g. VOO"
                          required
                        />
                      </label>
                      <label>
                        Currency
                        <input value="USD" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Execution</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={buyQuantity}
                          onChange={(event) => setBuyQuantity(event.target.value)}
                          placeholder="e.g. 2"
                          required
                        />
                      </label>
                      <label>
                        Price (USD per share)
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={buyPriceUsd}
                          onChange={(event) => setBuyPriceUsd(event.target.value)}
                          placeholder="e.g. 500"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Costs and notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Fee (USD)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={buyFeeUsd}
                          onChange={(event) => setBuyFeeUsd(event.target.value)}
                          placeholder="e.g. 1.23"
                          required
                        />
                      </label>
                      <label>
                        Note (optional)
                        <textarea
                          value={buyNote}
                          onChange={(event) => setBuyNote(event.target.value)}
                          placeholder="Broker reference or reason"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="buy-impact-preview"
                    data-testid="buy-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="buy-impact-preview">Ledger impact</h3>
                    </div>
                    {isBuyPreviewComplete &&
                    previewBuyTradeCostUsd !== undefined &&
                    previewBuyResultingQuantity !== undefined &&
                    previewBuyResultingCostUsd !== undefined ? (
                      <dl>
                        <div>
                          <dt>USD cash</dt>
                          <dd>
                            {usd.format(balances.usdCash)} →{" "}
                            {usd.format(
                              balances.usdCash - previewBuyTradeCostUsd,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Position</dt>
                          <dd>
                            +{previewBuyQuantity} {previewBuySymbol}; resulting{" "}
                            {previewBuyResultingQuantity}
                          </dd>
                        </div>
                        <div>
                          <dt>Cost basis</dt>
                          <dd>
                            +{usd.format(previewBuyTradeCostUsd)}; resulting{" "}
                            {usd.format(previewBuyResultingCostUsd)}
                          </dd>
                        </div>
                        <div>
                          <dt>Fees</dt>
                          <dd>+{usd.format(previewBuyFeeUsd)}</dd>
                        </div>
                        <div>
                          <dt>Realized P&amp;L</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>Complete the required fields to preview this purchase.</p>
                    )}
                    {previewBuyTradeCostUsd !== undefined && !canSaveBuy && (
                      <p className="transaction-impact-warning" role="alert">
                        Purchase cost exceeds current USD cash.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveBuy}>
                    4. Save purchase
                  </button>
                </form>
              )}

              {selectedTransactionType === "SELL" && (
                <form className="unified-transaction-form" onSubmit={addSell}>
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>Sell security</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={sellDate}
                          onChange={(event) => setSellDate(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Account
                        <input value="personal-main" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Instrument</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Symbol
                        <input
                          type="text"
                          list="open-position-symbols"
                          value={sellSymbol}
                          onChange={(event) => setSellSymbol(event.target.value)}
                          placeholder="e.g. VOO"
                          required
                        />
                        <datalist id="open-position-symbols">
                          {balances.positions.map((position) => (
                            <option
                              key={position.symbol}
                              value={position.symbol}
                            />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        Currency
                        <input value="USD" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Execution</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={sellQuantity}
                          onChange={(event) =>
                            setSellQuantity(event.target.value)
                          }
                          placeholder="e.g. 1"
                          required
                        />
                      </label>
                      <label>
                        Price (USD per share)
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={sellPriceUsd}
                          onChange={(event) =>
                            setSellPriceUsd(event.target.value)
                          }
                          placeholder="e.g. 550"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Costs and notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Fee (USD)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={sellFeeUsd}
                          onChange={(event) => setSellFeeUsd(event.target.value)}
                          placeholder="e.g. 1.23"
                          required
                        />
                      </label>
                      <label>
                        Note (optional)
                        <textarea
                          value={sellNote}
                          onChange={(event) => setSellNote(event.target.value)}
                          placeholder="Broker reference or reason"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="sell-impact-preview"
                    data-testid="sell-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="sell-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedSellBalances && sellImpact ? (
                      <dl>
                        <div>
                          <dt>Net sale proceeds</dt>
                          <dd>{usd.format(sellImpact.proceedsUsd)}</dd>
                        </div>
                        <div>
                          <dt>This sale realized P&amp;L</dt>
                          <dd>{usd.format(sellImpact.realizedPnlUsd)}</dd>
                        </div>
                        <div>
                          <dt>Added fees</dt>
                          <dd>{usd.format(previewSellFeeUsd)}</dd>
                        </div>
                        <div>
                          <dt>USD cash</dt>
                          <dd>
                            {usd.format(balances.usdCash)} →{" "}
                            {usd.format(projectedSellBalances.usdCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>Position</dt>
                          <dd>
                            {previewSellPosition?.quantity ?? 0} →{" "}
                            {projectedSellPosition?.quantity ?? 0}{" "}
                            {previewSellSymbol}
                          </dd>
                        </div>
                        <div>
                          <dt>Cost basis</dt>
                          <dd>
                            {usd.format(previewSellPosition?.costUsd ?? 0)} →{" "}
                            {usd.format(projectedSellPosition?.costUsd ?? 0)}
                          </dd>
                        </div>
                        <div>
                          <dt>Total realized P&amp;L</dt>
                          <dd>
                            {usd.format(balances.realizedPnlUsd)} →{" "}
                            {usd.format(projectedSellBalances.realizedPnlUsd)}
                          </dd>
                        </div>
                        <div>
                          <dt>Total fees</dt>
                          <dd>
                            {usd.format(balances.totalFeesUsd)} →{" "}
                            {usd.format(projectedSellBalances.totalFeesUsd)}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p>Complete the required fields to preview this sale.</p>
                    )}
                    {projectedSellBalances && (
                      <p>
                        Proceeds and this sale’s P&amp;L are net of the sale fee.
                        Position, cost basis, cash, and totals reflect the full
                        ledger after recalculation, including later transactions.
                      </p>
                    )}
                    {sellPreviewError && (
                      <p className="transaction-impact-warning" role="alert">
                        {sellPreviewError}
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveSell}>
                    4. Save sale
                  </button>
                </form>
              )}

              {selectedTransactionType &&
                selectedTransactionType !== "BUY" &&
                selectedTransactionType !== "SELL" && (
                  <div className="legacy-transaction-notice">
                    <p>
                      This transaction type still uses its verified existing form.
                      It will move into this shared flow in a later small step.
                    </p>
                    <button type="button" onClick={openLegacyTransactionForm}>
                      Open existing form
                    </button>
                  </div>
                )}
            </div>
          )}

      {!isPersonalLedger && (
        <section>
          <h2>Start personal ledger</h2>
          <p>
            The current records are anonymous demo data. Start with an empty
            personal ledger before entering real transactions.
          </p>
          <button type="button" onClick={startEmptyPersonalLedger}>
            Start with an empty personal ledger
          </button>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-cny-deposit">
          <h2>Add CNY deposit</h2>
          <form onSubmit={addCnyDeposit}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={depositDate}
                  onChange={(event) => setDepositDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Amount (CNY){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="e.g. 1000"
                />
              </label>
            </p>
            <button type="submit">Add deposit</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-cny-withdrawal">
          <h2>Add CNY withdrawal</h2>
          <form onSubmit={addCnyWithdrawal}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={withdrawalDate}
                  onChange={(event) => setWithdrawalDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Amount withdrawn (CNY){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={withdrawalAmount}
                  onChange={(event) => setWithdrawalAmount(event.target.value)}
                  placeholder="e.g. 500"
                />
              </label>
            </p>
            <button type="submit">Add withdrawal</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-fx-to-usd">
          <h2>Add CNY to USD conversion</h2>
          <form onSubmit={addFxToUsd}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={fxDate}
                  onChange={(event) => setFxDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                CNY spent{" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fxAmountCny}
                  onChange={(event) => setFxAmountCny(event.target.value)}
                  placeholder="e.g. 10000"
                />
              </label>
            </p>
            <p>
              <label>
                USD received{" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fxAmountUsd}
                  onChange={(event) => setFxAmountUsd(event.target.value)}
                  placeholder="e.g. 1380"
                />
              </label>
            </p>
            <button type="submit">Add FX conversion</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-cashback-shares">
          <h2>Add shares received from payment cashback</h2>
          <p>
            Record shares delivered directly by a rewards platform. This adds
            position quantity and cost basis at the acquisition value without
            creating a cash deposit, FX conversion, or USD cash movement.
          </p>
          <form onSubmit={addCashbackShares}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={cashbackDate}
                  onChange={(event) => setCashbackDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={cashbackSymbol}
                  onChange={(event) => setCashbackSymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Actual shares received{" "}
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={cashbackQuantity}
                  onChange={(event) => setCashbackQuantity(event.target.value)}
                  placeholder="e.g. 0.125"
                />
              </label>
            </p>
            <p>
              <label>
                Acquisition price (USD per share){" "}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={cashbackPriceUsd}
                  onChange={(event) => setCashbackPriceUsd(event.target.value)}
                  placeholder="e.g. 500"
                />
              </label>
            </p>
            <p>Source: Payment cashback · Account: personal-main</p>
            <button type="submit">Add cashback shares</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-dividend">
          <h2>Add USD dividend</h2>
          <form onSubmit={addDividend}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={dividendDate}
                  onChange={(event) => setDividendDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={dividendSymbol}
                  onChange={(event) => setDividendSymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Gross amount (USD){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={dividendGrossAmountUsd}
                  onChange={(event) =>
                    setDividendGrossAmountUsd(event.target.value)
                  }
                  placeholder="e.g. 6.20"
                />
              </label>
            </p>
            <p>
              <label>
                Withholding tax (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={dividendWithholdingTaxUsd}
                  onChange={(event) =>
                    setDividendWithholdingTaxUsd(event.target.value)
                  }
                  placeholder="e.g. 0.62"
                />
              </label>
            </p>
            <p>
              <label>
                Payment method{" "}
                <select
                  value={dividendPaymentMethod}
                  onChange={(event) =>
                    setDividendPaymentMethod(event.target.value)
                  }
                >
                  <option value="CASH">Cash dividend</option>
                  <option value="REINVEST">Reinvest dividend</option>
                </select>
              </label>
            </p>
            {dividendPaymentMethod === "REINVEST" && (
              <>
                <p>
                  <label>
                    Reinvestment price (USD per share){" "}
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={dividendReinvestmentPriceUsd}
                      onChange={(event) =>
                        setDividendReinvestmentPriceUsd(event.target.value)
                      }
                      placeholder="e.g. 500"
                    />
                  </label>
                </p>
                <p>
                  Reinvestment shares: {" "}
                  {Number.isFinite(reinvestmentShares) &&
                  reinvestmentShares > 0
                    ? reinvestmentShares.toFixed(6)
                    : "Not available"}
                </p>
              </>
            )}
            <button type="submit">Add dividend</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-interest">
          <h2>Add interest income</h2>
          <form onSubmit={addInterest}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={interestDate}
                  onChange={(event) => setInterestDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Currency{" "}
                <select
                  value={interestCurrency}
                  onChange={(event) =>
                    setInterestCurrency(event.target.value as Currency)
                  }
                >
                  <option value="USD">USD</option>
                  <option value="HKD">HKD</option>
                  <option value="CNY">CNY</option>
                </select>
              </label>
            </p>
            <p>
              <label>
                Amount received after tax ({interestCurrency}){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={interestAmount}
                  onChange={(event) => setInterestAmount(event.target.value)}
                  placeholder="e.g. 12.34"
                />
              </label>
            </p>
            <button type="submit">Add interest income</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section id="legacy-expense">
          <h2>Add USD expense</h2>
          <p>
            Record ADR custody fees or other USD cash deductions. Trading
            commissions belong in the related buy or sell transaction.
          </p>
          <form onSubmit={addUsdExpense}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Expense category{" "}
                <select
                  value={expenseCategory}
                  onChange={(event) =>
                    setExpenseCategory(event.target.value as ExpenseCategory)
                  }
                >
                  <option value="ADR_FEE">ADR custody fee</option>
                  <option value="OTHER">Other USD expense</option>
                </select>
              </label>
            </p>
            <p>
              <label>
                Amount paid (USD){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expenseAmountUsd}
                  onChange={(event) => setExpenseAmountUsd(event.target.value)}
                  placeholder="e.g. 2.50"
                />
              </label>
            </p>
            <button type="submit">Add USD expense</button>
          </form>
        </section>
      )}

      {message && <p>{message}</p>}

        </section>

      <section id="settings" className="page-section">
        <p className="section-eyebrow">Settings</p>
        <h2>Local backup</h2>
        <p>
          Export before entering more history. Imported files replace the
          local browser ledger and security profiles.
        </p>
        <button type="button" onClick={exportLedgerBackup}>
          Export JSON backup
        </button>
        <p>
          <label>
            Import JSON backup{" "}
            <input
              type="file"
              accept="application/json,.json"
              onChange={importLedgerBackup}
            />
          </label>
        </p>
      </section>

      <section id="cash" className="page-section">
        <p className="section-eyebrow">Cash</p>
        <h2>Current balances</h2>
        <ul>
          <li>CNY cash: {cny.format(balances.cnyCash)}</li>
          <li>HKD cash: {hkd.format(balances.hkdCash)}</li>
          <li>USD cash: {usd.format(balances.usdCash)}</li>
        </ul>
      </section>

      <section
        id="portfolio"
        className="portfolio-valuation-panel"
        aria-labelledby="portfolio-valuation"
        data-testid="portfolio-valuation"
      >
        <div>
          <h2 id="portfolio-valuation">Total portfolio value in CNY</h2>
          <p>
            Cash plus the latest covered securities value, translated with the
            displayed valuation FX rate. This read-only estimate never changes
            ledger cash, positions, costs, or transaction FX rates.
          </p>
        </div>

        <dl className="portfolio-valuation-grid">
          <div className="portfolio-valuation-total">
            <dt>Total portfolio value</dt>
            <dd>
              {portfolioValuation.totalPortfolioValueCny === undefined
                ? "Unavailable"
                : cny.format(portfolioValuation.totalPortfolioValueCny)}
            </dd>
            <small>Cash plus complete securities value</small>
          </div>
          <div>
            <dt>Total cash value</dt>
            <dd>
              {portfolioValuation.totalCashValueCny === undefined
                ? "Unavailable"
                : cny.format(portfolioValuation.totalCashValueCny)}
            </dd>
            <small>All cash currencies translated to CNY</small>
          </div>
          <div>
            <dt>Securities value</dt>
            <dd>
              {portfolioValuation.totalSecuritiesMarketValueUsd === undefined
                ? `${usd.format(portfolioValuation.coveredSecuritiesMarketValueUsd)} covered`
                : usd.format(
                    portfolioValuation.totalSecuritiesMarketValueUsd,
                  )}
            </dd>
            <small>
              {holdingsValuation.coveredPositionCount} / {" "}
              {holdingsValuation.totalPositionCount} positions covered
            </small>
          </div>
          <div>
            <dt>Securities value in CNY</dt>
            <dd>
              {portfolioValuation.totalSecuritiesMarketValueCny !== undefined
                ? cny.format(portfolioValuation.totalSecuritiesMarketValueCny)
                : portfolioValuation.coveredSecuritiesMarketValueCny !==
                    undefined
                  ? `${cny.format(portfolioValuation.coveredSecuritiesMarketValueCny)} covered`
                  : "Unavailable"}
            </dd>
            <small>
              {valuationFxRates.USD_CNY
                ? `USD/CNY ${fxRateNumber.format(valuationFxRates.USD_CNY.rate.rate)}`
                : "USD/CNY rate unavailable"}
            </small>
          </div>
          <div>
            <dt>Security close date</dt>
            <dd>{securityQuoteDateRange}</dd>
            <small>Range across covered positions</small>
          </div>
          <div>
            <dt>USD/CNY observation date</dt>
            <dd>
              {valuationFxRates.USD_CNY?.rate.marketTimestamp.slice(0, 10) ??
                "Unavailable"}
            </dd>
            <small>
              {valuationFxRates.USD_CNY
                ? describeFxStatus(valuationFxRates.USD_CNY)
                : "Valuation input missing"}
            </small>
          </div>
        </dl>

        {portfolioValuation.unavailableReasons.length > 0 && (
          <p className="portfolio-valuation-warning" role="status">
            Complete total unavailable because {" "}
            {portfolioValuation.unavailableReasons
              .map((reason) => portfolioValuationReasonLabels[reason])
              .join("; ")}.
          </p>
        )}
        {(staleSecurityQuoteCount > 0 ||
          staleCashValuationCurrencies.length > 0) && (
          <p className="portfolio-valuation-warning" role="status">
            This estimate includes stale cached market data: {" "}
            {staleSecurityQuoteCount > 0
              ? `${staleSecurityQuoteCount} security quote(s)`
              : ""}
            {staleSecurityQuoteCount > 0 &&
            staleCashValuationCurrencies.length > 0
              ? " and "
              : ""}
            {staleCashValuationCurrencies.length > 0
              ? `${staleCashValuationCurrencies.join(" and ")} FX`
              : ""}
            .
          </p>
        )}
      </section>

      <section
        className="cash-valuation-panel"
        aria-labelledby="cash-valuation"
      >
        <div>
          <h2 id="cash-valuation">Cash value in CNY</h2>
          <p>
            Read-only reference valuation of cash balances. This is not profit
            and does not change ledger cash or actual FX transactions.
          </p>
        </div>

        <dl className="cash-valuation-grid">
          <div>
            <dt>CNY cash</dt>
            <dd>{cny.format(cashValuation.cnyCashValueCny)}</dd>
            <small>Already denominated in CNY</small>
          </div>
          <div>
            <dt>USD cash in CNY</dt>
            <dd>
              {cashValuation.usdCashValueCny === undefined
                ? "Unavailable"
                : cny.format(cashValuation.usdCashValueCny)}
            </dd>
            <small>
              {cashValuation.usdCashValueCny === undefined
                ? "USD/CNY rate unavailable"
                : `${usd.format(balances.usdCash)} at the displayed USD/CNY rate`}
            </small>
          </div>
          <div>
            <dt>HKD cash in CNY</dt>
            <dd>
              {cashValuation.hkdCashValueCny === undefined
                ? "Unavailable"
                : cny.format(cashValuation.hkdCashValueCny)}
            </dd>
            <small>
              {cashValuation.hkdCashValueCny === undefined
                ? "HKD/CNY rate unavailable"
                : `${hkd.format(balances.hkdCash)} at the displayed HKD/CNY rate`}
            </small>
          </div>
          <div className="cash-valuation-total">
            <dt>Total cash value</dt>
            <dd>
              {cashValuation.totalCashValueCny === undefined
                ? "Unavailable"
                : cny.format(cashValuation.totalCashValueCny)}
            </dd>
            <small>
              {cashValuation.unavailableCurrencies.length > 0
                ? `Missing valuation rate for non-zero ${cashValuation.unavailableCurrencies.join(" and ")} cash`
                : "CNY reference value of cash only"}
            </small>
          </div>
        </dl>

        {staleCashValuationCurrencies.length > 0 && (
          <p className="cash-valuation-warning" role="status">
            Uses stale cached {staleCashValuationCurrencies.join(" and ")} FX
            rate data. Refresh the valuation rates when the provider is
            available.
          </p>
        )}
      </section>

      <section
        id="market-data"
        className="valuation-fx-panel page-section"
        aria-labelledby="valuation-fx"
      >
        <div className="valuation-fx-heading">
          <div>
            <h2 id="valuation-fx">Valuation FX rates</h2>
            <p>
              Reference rates for portfolio valuation only. They never replace
              actual broker or bank conversion rates in the ledger.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshValuationFxRates(true)}
            disabled={isValuationFxLoading}
          >
            {isValuationFxLoading ? "Refreshing…" : "Refresh valuation rates"}
          </button>
        </div>

        {isValuationFxLoading &&
          Object.keys(valuationFxRates).length === 0 && (
            <p role="status">Loading valuation rates…</p>
          )}
        {valuationFxError && (
          <p className="valuation-fx-error" role="alert">
            {valuationFxError}
          </p>
        )}

        <div className="valuation-fx-grid">
          {valuationFxRequests.map((item) => {
            const resolution = valuationFxRates[item.key];

            return (
              <article
                className="valuation-fx-card"
                data-status={resolution?.status ?? "UNAVAILABLE"}
                key={item.key}
              >
                <h3>{item.label}</h3>
                {resolution ? (
                  <>
                    <p className="valuation-fx-rate">
                      1 {resolution.rate.pair.baseCurrency} ={" "}
                      {fxRateNumber.format(resolution.rate.rate)}{" "}
                      {resolution.rate.pair.quoteCurrency}
                    </p>
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>{describeFxStatus(resolution)}</dd>
                      </div>
                      <div>
                        <dt>Observation date</dt>
                        <dd>{resolution.rate.marketTimestamp.slice(0, 10)}</dd>
                      </div>
                      <div>
                        <dt>Fetched</dt>
                        <dd>{displayDateTime(resolution.rate.fetchedAt)}</dd>
                      </div>
                      <div>
                        <dt>Data service</dt>
                        <dd>{resolution.rate.provider}</dd>
                      </div>
                    </dl>
                    <details>
                      <summary>Contributing sources</summary>
                      <p>{resolution.rate.sourceInstitution}</p>
                    </details>
                    {resolution.refreshError && (
                      <p className="valuation-fx-warning" role="status">
                        Refresh issue: {resolution.refreshError.message}
                      </p>
                    )}
                  </>
                ) : (
                  <p>Rate unavailable.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section id="performance" className="page-section">
        <p className="section-eyebrow">Performance</p>
        <h2>Realized result</h2>
        <ul>
          <li>Realized P&amp;L: {usd.format(balances.realizedPnlUsd)}</li>
          <li>
            Accumulated fees and USD expenses:{" "}
            {usd.format(balances.totalFeesUsd)}
          </li>
        </ul>
      </section>

      <h2>USD cash transaction history</h2>
      {usdCashHistory.length === 0 ? (
        <p>No USD cash movements recorded yet.</p>
      ) : (
        <div className="cash-history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Inflow</th>
                <th>Outflow</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {usdCashHistory.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.occurredAt}</td>
                  <td>{transaction.eventType}</td>
                  <td>{transaction.description}</td>
                  <td>
                    {transaction.inflowUsd > 0
                      ? usd.format(transaction.inflowUsd)
                      : "—"}
                  </td>
                  <td>
                    {transaction.outflowUsd > 0
                      ? usd.format(transaction.outflowUsd)
                      : "—"}
                  </td>
                  <td>{usd.format(transaction.balanceUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isPersonalLedger && (
        <section className="security-profile-panel">
          <h2>Security profiles</h2>
          <p>
            Map each open position to the identifier used by a future market
            data provider. This does not change transactions, cash, cost, or
            holdings. Quote currency is currently fixed to USD.
          </p>

          {securityProfileRegistry.status === "INVALID" && (
            <p className="security-profile-warning">
              The saved security profiles could not be read: {" "}
              {securityProfileRegistry.error} Saving a valid profile will
              replace the invalid registry.
            </p>
          )}

          {balances.positions.length === 0 ? (
            <p>Add a security purchase before creating a profile.</p>
          ) : (
            <>
              <ul className="security-profile-list">
                {balances.positions.map((position) => {
                  const profile = securityProfiles.find(
                    (item) => item.positionSymbol === position.symbol,
                  );

                  return (
                    <li
                      key={position.symbol}
                      data-testid={`security-profile-status-${position.symbol}`}
                    >
                      <strong>{position.symbol}</strong>
                      <span>
                        {profile
                          ? `${profile.security.symbol} · ${profile.security.exchange} · ${profile.security.assetType} · USD`
                          : "Not mapped"}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <form
                className="security-profile-form"
                onSubmit={saveSecurityProfile}
              >
                <label htmlFor="profile-position-symbol">
                  Open position
                  <select
                    id="profile-position-symbol"
                    value={profilePositionSymbol}
                    onChange={(event) =>
                      selectProfilePosition(event.target.value)
                    }
                    required
                  >
                    <option value="">Select a position</option>
                    {balances.positions.map((position) => (
                      <option key={position.symbol} value={position.symbol}>
                        {position.symbol}
                      </option>
                    ))}
                  </select>
                </label>

                <label htmlFor="profile-provider-symbol">
                  Market-data symbol
                  <input
                    id="profile-provider-symbol"
                    value={profileProviderSymbol}
                    onChange={(event) =>
                      setProfileProviderSymbol(event.target.value)
                    }
                    placeholder="e.g. VOO"
                    required
                  />
                </label>

                <label htmlFor="profile-exchange">
                  Exchange
                  <input
                    id="profile-exchange"
                    value={profileExchange}
                    onChange={(event) => setProfileExchange(event.target.value)}
                    placeholder="e.g. NYSE ARCA"
                    required
                  />
                </label>

                <label htmlFor="profile-asset-type">
                  Asset type
                  <select
                    id="profile-asset-type"
                    value={profileAssetType}
                    onChange={(event) =>
                      setProfileAssetType(
                        event.target.value as MarketDataAssetType,
                      )
                    }
                  >
                    <option value="STOCK">Stock</option>
                    <option value="ETF">ETF</option>
                  </select>
                </label>

                <label htmlFor="profile-currency">
                  Quote currency
                  <input id="profile-currency" value="USD" readOnly />
                </label>

                <button type="submit">Save security profile</button>
              </form>
            </>
          )}
        </section>
      )}

      <section className="holdings-valuation-panel">
        <div className="holdings-valuation-heading">
          <div>
            <h2>Open positions</h2>
            <p>
              Read-only valuation from mapped security profiles and locally
              cached quotes. Missing holdings are never valued at zero.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshHoldingsQuotes(true)}
            disabled={Object.values(positionQuoteStates).some(
              (state) => state.status === "LOADING",
            )}
          >
            Refresh closing prices
          </button>
        </div>

        <div className="security-quote-source-card">
          <h3>Automatic closing-price source</h3>
          <p>
            Atlas loads the latest available US daily close from Eastmoney's
            public market-data service and stores it in the local IndexedDB
            cache. No API key or manual quote entry is required. Cached prices
            remain available with an explicit stale status if refresh fails.
          </p>
        </div>

        {balances.positions.length === 0 ? (
          <p>No open positions.</p>
        ) : (
          <>
            <dl className="holdings-valuation-summary">
              <div>
                <dt>Quote coverage</dt>
                <dd>
                  {holdingsValuation.coveredPositionCount} /{" "}
                  {holdingsValuation.totalPositionCount} positions
                </dd>
              </div>
              <div>
                <dt>Covered market value</dt>
                <dd>{usd.format(holdingsValuation.coveredMarketValueUsd)}</dd>
              </div>
              <div>
                <dt>Total securities value</dt>
                <dd>
                  {holdingsValuation.totalMarketValueUsd === undefined
                    ? "Unavailable until all positions are covered"
                    : usd.format(holdingsValuation.totalMarketValueUsd)}
                </dd>
              </div>
            </dl>

            <div className="holdings-valuation-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Shares</th>
                    <th>Average cost</th>
                    <th>Last quote</th>
                    <th>Market value</th>
                    <th>Unrealized P&amp;L</th>
                    <th>Status</th>
                    <th>Market chart</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsValuation.positions.map((position) => {
                    const quoteState = positionQuoteStates[position.symbol];
                    const tradingViewUrl = position.security
                      ? createTradingViewSymbolUrl(position.security)
                      : undefined;
                    const statusText =
                      position.status === "MISSING_SECURITY_IDENTIFIER"
                        ? "Security profile required"
                        : quoteState?.status === "LOADING"
                          ? "Loading quote…"
                          : quoteState?.status === "ERROR"
                            ? quoteState.error
                            : position.status === "VALUED" &&
                                quoteState?.status === "RESOLVED"
                              ? describeSecurityQuoteStatus(
                                  quoteState.resolution,
                                ) +
                                ` · ${quoteState.resolution.quote.provider}`
                              : "Quote unavailable";

                    return (
                      <tr
                        key={position.symbol}
                        data-testid={`holding-valuation-${position.symbol}`}
                      >
                        <td>{position.symbol}</td>
                        <td>{position.quantity}</td>
                        <td>{usd.format(position.averageCostUsd)}</td>
                        <td>
                          {position.status === "VALUED"
                            ? `${usd.format(position.quote.price)} · ${position.quote.marketTimestamp.slice(0, 10)}`
                            : "—"}
                        </td>
                        <td>
                          {position.status === "VALUED"
                            ? usd.format(position.marketValueUsd)
                            : "—"}
                        </td>
                        <td>
                          {position.status === "VALUED"
                            ? usd.format(position.unrealizedPnlUsd)
                            : "—"}
                        </td>
                        <td>{statusText}</td>
                        <td>
                          {tradingViewUrl ? (
                            <a
                              href={tradingViewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`View ${position.symbol} on TradingView`}
                            >
                              View on TradingView
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="ledger-section" aria-labelledby="ledger-heading">
        <h2 id="ledger-heading">
          {isPersonalLedger ? "Personal ledger" : "Anonymous test ledger"}
        </h2>
        {ledger.length === 0 ? (
          <p>No transactions recorded yet.</p>
        ) : (
          <ol className="ledger-list">
            {ledger.map((event) => (
              <li key={event.id}>
                {isPersonalLedger ? (
                  <button
                    type="button"
                    className="ledger-event-button"
                    aria-pressed={selectedLedgerEventId === event.id}
                    onClick={() => {
                      setEditingEventId(null);
                      setSelectedLedgerEventId(event.id);
                    }}
                  >
                    <strong>{event.occurredAt}</strong> — {describeEvent(event)}
                  </button>
                ) : (
                  <>
                    <strong>{event.occurredAt}</strong> — {describeEvent(event)}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        {isPersonalLedger && selectedLedgerEvent && (
          <aside
            className="transaction-detail-panel"
            aria-labelledby="transaction-detail-heading"
          >
            <div className="transaction-detail-heading">
              <div>
                <p className="section-eyebrow">Transaction detail</p>
                <h3 id="transaction-detail-heading">
                  {describeEvent(selectedLedgerEvent)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingEventId(null);
                  setSelectedLedgerEventId(null);
                }}
              >
                Close
              </button>
            </div>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{selectedLedgerEvent.occurredAt}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selectedLedgerEvent.type}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{selectedLedgerEvent.accountId}</dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>{selectedLedgerEvent.note || "—"}</dd>
              </div>
            </dl>
            {editingEventId === selectedLedgerEvent.id ? (
              <TransactionEditor
                key={selectedLedgerEvent.id}
                event={selectedLedgerEvent}
                ledger={ledger}
                onSave={saveEditedLedgerEvent}
                onCancel={() => setEditingEventId(null)}
              />
            ) : (
              <>
                <p>
                  Editing or deletion recalculates the complete ledger and is
                  rejected if a later transaction would become invalid.
                </p>
                <div className="transaction-edit-actions">
                  <button
                    type="button"
                    onClick={() => setEditingEventId(selectedLedgerEvent.id)}
                  >
                    Edit transaction
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={deleteSelectedLedgerEvent}
                  >
                    Delete transaction
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </section>

        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <a href="#dashboard">Dashboard</a>
          <a href="#portfolio">Portfolio</a>
          <a href="#transactions">Transactions</a>
          <a href="#cash">Cash</a>
          <button
            type="button"
            aria-expanded={isMoreNavigationOpen}
            aria-controls="mobile-more-navigation"
            onClick={() => setIsMoreNavigationOpen((isOpen) => !isOpen)}
          >
            More
          </button>
          {isMoreNavigationOpen && (
            <div id="mobile-more-navigation" className="mobile-more-navigation">
              <a
                href="#performance"
                onClick={() => setIsMoreNavigationOpen(false)}
              >
                Performance
              </a>
              <a
                href="#market-data"
                onClick={() => setIsMoreNavigationOpen(false)}
              >
                Market Data
              </a>
              <a
                href="#settings"
                onClick={() => setIsMoreNavigationOpen(false)}
              >
                Settings
              </a>
              <button type="button" onClick={openTransactionEntry}>
                Add transaction
              </button>
            </div>
          )}
        </nav>
      </div>
    </main>
  );
}
