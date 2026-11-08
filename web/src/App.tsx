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
import {
  loadBenchmarkPriceChanges,
  type BenchmarkPriceChange,
} from "./data/loadBenchmarkPriceChanges";
import { loadHistoricalValuationInputs } from "./data/loadHistoricalValuationInputs";
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
import { calculateDailyPortfolioSnapshots } from "./domain/calculateDailyPortfolioSnapshots";
import {
  calculateCurrentCnyPerformance,
  type CurrentCnyPerformanceUnavailableReason,
} from "./domain/calculateCurrentCnyPerformance";
import { calculateUsdCashHistory } from "./domain/calculateUsdCashHistory";
import { calculateUsdTwrSeries } from "./domain/calculateUsdTwrSeries";
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
import { selectUsdTwrSnapshotDates } from "./domain/selectUsdTwrSnapshotDates";

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

const percentage = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
}> = [
  { type: "BUY", label: "Buy security" },
  { type: "SELL", label: "Sell security" },
  {
    type: "CNY_DEPOSIT",
    label: "CNY deposit",
  },
  {
    type: "CNY_WITHDRAWAL",
    label: "CNY withdrawal",
  },
  {
    type: "FX_TO_USD",
    label: "CNY to USD conversion",
  },
  {
    type: "DIVIDEND",
    label: "Dividend",
  },
  {
    type: "INTEREST",
    label: "Interest income",
  },
  { type: "FEE", label: "USD expense" },
  {
    type: "IN_KIND_CONTRIBUTION",
    label: "Payment cashback shares",
  },
];

type PositionQuoteState =
  | { status: "LOADING" }
  | { status: "RESOLVED"; resolution: SecurityQuoteResolution }
  | { status: "ERROR"; error: string };

type PositionQuoteStates = Record<string, PositionQuoteState>;

type InKindContributionValueState =
  | { status: "LOADING"; inputKey: string }
  | { status: "RESOLVED"; inputKey: string; valueCny: number }
  | { status: "ERROR"; inputKey: string; error: string };

type InKindContributionValueStates = Record<
  string,
  InKindContributionValueState
>;

type UsdTwrState =
  | { status: "IDLE" }
  | ({
      sourceLedger: readonly LedgerEvent[];
      sourceProfiles: readonly PositionSecurityMapping[];
    } & (
      | { status: "LOADING" }
      | {
          status: "READY";
          cumulativeReturn: number;
          startDate: string;
          endDate: string;
          snapshotCount: number;
          benchmarks: BenchmarkPriceChange[];
        }
      | { status: "UNAVAILABLE"; reasons: string[] }
    ));

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

const performanceUnavailableReasonLabels: Record<
  CurrentCnyPerformanceUnavailableReason,
  string
> = {
  NAV_UNAVAILABLE:
    "Current CNY NAV needs complete security-price and FX coverage.",
  IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE:
    "A historical USD/CNY rate is still needed for an in-kind contribution.",
  XIRR_UNAVAILABLE:
    "CNY XIRR needs complete NAV and dated investor cash flows with one valid solution.",
};

function currentLocalDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousLocalDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return currentLocalDate(yesterday);
}

function inKindContributionInputKey(
  event: Extract<LedgerEvent, { type: "IN_KIND_CONTRIBUTION" }>,
): string {
  return `${event.occurredAt}:${event.quantity}:${event.priceUsd}`;
}

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
  const [depositNote, setDepositNote] = useState("");
  const [withdrawalDate, setWithdrawalDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalNote, setWithdrawalNote] = useState("");
  const [fxDate, setFxDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [fxAmountCny, setFxAmountCny] = useState("");
  const [fxAmountUsd, setFxAmountUsd] = useState("");
  const [fxNote, setFxNote] = useState("");
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
  const [cashbackNote, setCashbackNote] = useState("");
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
  const [dividendNote, setDividendNote] = useState("");
  const [interestDate, setInterestDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [interestCurrency, setInterestCurrency] = useState<Currency>("USD");
  const [interestAmount, setInterestAmount] = useState("");
  const [interestNote, setInterestNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expenseCategory, setExpenseCategory] =
    useState<ExpenseCategory>("ADR_FEE");
  const [expenseAmountUsd, setExpenseAmountUsd] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
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
  const [inKindContributionValueStates, setInKindContributionValueStates] =
    useState<InKindContributionValueStates>({});
  const inKindContributionValueRequestId = useRef(0);
  const [usdTwrState, setUsdTwrState] = useState<UsdTwrState>({ status: "IDLE" });
  const usdTwrRequestId = useRef(0);

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

  useEffect(() => {
    const requestId = inKindContributionValueRequestId.current + 1;
    inKindContributionValueRequestId.current = requestId;
    const inKindContributions = ledger.filter(
      (event) => event.type === "IN_KIND_CONTRIBUTION",
    );
    const loadTimer = window.setTimeout(() => {
      if (inKindContributions.length === 0) {
        setInKindContributionValueStates({});
        return;
      }

      setInKindContributionValueStates(
        Object.fromEntries(
          inKindContributions.map((event) => [
            event.id,
            {
              status: "LOADING",
              inputKey: inKindContributionInputKey(event),
            },
          ]),
        ),
      );

      void Promise.all(
        inKindContributions.map(async (event) => {
          try {
            const resolution = await valuationFxService.getFxRate({
              pair: { baseCurrency: "USD", quoteCurrency: "CNY" },
              date: event.occurredAt,
            });
            return {
              eventId: event.id,
              state: {
                status: "RESOLVED" as const,
                inputKey: inKindContributionInputKey(event),
                valueCny:
                  event.quantity * event.priceUsd * resolution.rate.rate,
              },
            };
          } catch (error) {
            return {
              eventId: event.id,
              state: {
                status: "ERROR" as const,
                inputKey: inKindContributionInputKey(event),
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown historical USD/CNY error.",
              },
            };
          }
        }),
      ).then((results) => {
        if (inKindContributionValueRequestId.current !== requestId) {
          return;
        }

        setInKindContributionValueStates(
          Object.fromEntries(
            results.map((result) => [result.eventId, result.state]),
          ),
        );
      });
    }, 0);

    return () => {
      window.clearTimeout(loadTimer);
      if (inKindContributionValueRequestId.current === requestId) {
        inKindContributionValueRequestId.current += 1;
      }
    };
  }, [ledger]);

  const balances = calculateBalances(ledger);
  const openPositionSymbols = new Set(
    balances.positions.map((position) => position.symbol.toUpperCase()),
  );
  const historicalPositionSymbols = [
    ...new Set(
      ledger.flatMap((event) =>
        event.type === "BUY" ||
        event.type === "SELL" ||
        event.type === "IN_KIND_CONTRIBUTION"
          ? [event.symbol.toUpperCase()]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const securityProfiles = securityProfileRegistry.profiles;
  const displayedUsdTwrState: UsdTwrState =
    usdTwrState.status !== "IDLE" &&
    usdTwrState.sourceLedger === ledger &&
    usdTwrState.sourceProfiles === securityProfiles
      ? usdTwrState
      : { status: "IDLE" };
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
  const performanceAsOfDate = [
    currentLocalDate(),
    ...ledger.map((event) => event.occurredAt),
  ]
    .sort((left, right) => left.localeCompare(right))
    .at(-1)!;
  const currentInKindContributionInputKeys = new Map(
    ledger.flatMap((event) =>
      event.type === "IN_KIND_CONTRIBUTION"
        ? [[event.id, inKindContributionInputKey(event)] as const]
        : [],
    ),
  );
  const resolvedInKindContributionValues = Object.entries(
    inKindContributionValueStates,
  ).flatMap(([eventId, state]) =>
    state.status === "RESOLVED" &&
    currentInKindContributionInputKeys.get(eventId) === state.inputKey
      ? [{ eventId, valueCny: state.valueCny }]
      : [],
  );
  const isInKindContributionValueLoading = Object.entries(
    inKindContributionValueStates,
  ).some(
    ([eventId, state]) =>
      state.status === "LOADING" &&
      currentInKindContributionInputKeys.get(eventId) === state.inputKey,
  );
  const hasInKindContributionValueError = Object.entries(
    inKindContributionValueStates,
  ).some(
    ([eventId, state]) =>
      state.status === "ERROR" &&
      currentInKindContributionInputKeys.get(eventId) === state.inputKey,
  );
  const currentCnyPerformance = calculateCurrentCnyPerformance({
    events: ledger,
    asOfDate: performanceAsOfDate,
    navCny: portfolioValuation.totalPortfolioValueCny,
    inKindContributionValuesCny: resolvedInKindContributionValues,
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
  const previewDepositAmountCny = Number(depositAmount);
  const isDepositPreviewComplete =
    Boolean(depositDate) &&
    Number.isFinite(previewDepositAmountCny) &&
    previewDepositAmountCny > 0;
  const projectedDepositBalances = isDepositPreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "deposit-preview",
          occurredAt: depositDate,
          accountId: "personal-main",
          type: "CNY_DEPOSIT",
          amountCny: previewDepositAmountCny,
        },
      ])
    : undefined;
  const canSaveDeposit = Boolean(
    projectedDepositBalances &&
      Number.isFinite(projectedDepositBalances.cnyCash),
  );
  const previewWithdrawalAmountCny = Number(withdrawalAmount);
  const isWithdrawalPreviewComplete =
    Boolean(withdrawalDate) &&
    Number.isFinite(previewWithdrawalAmountCny) &&
    previewWithdrawalAmountCny > 0;
  const projectedWithdrawalBalances = isWithdrawalPreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "withdrawal-preview",
          occurredAt: withdrawalDate,
          accountId: "personal-main",
          type: "CNY_WITHDRAWAL",
          amountCny: previewWithdrawalAmountCny,
        },
      ])
    : undefined;
  const withdrawalExceedsCash =
    isWithdrawalPreviewComplete &&
    previewWithdrawalAmountCny > balances.cnyCash;
  const canSaveWithdrawal = Boolean(
    projectedWithdrawalBalances &&
      Number.isFinite(projectedWithdrawalBalances.cnyCash) &&
      !withdrawalExceedsCash,
  );
  const previewFxAmountCny = Number(fxAmountCny);
  const previewFxAmountUsd = Number(fxAmountUsd);
  const isFxPreviewComplete =
    Boolean(fxDate) &&
    Number.isFinite(previewFxAmountCny) &&
    previewFxAmountCny > 0 &&
    Number.isFinite(previewFxAmountUsd) &&
    previewFxAmountUsd > 0;
  const previewFxEffectiveCnyPerUsd = isFxPreviewComplete
    ? previewFxAmountCny / previewFxAmountUsd
    : undefined;
  const projectedFxBalances = isFxPreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "fx-to-usd-preview",
          occurredAt: fxDate,
          accountId: "personal-main",
          type: "FX_TO_USD",
          amountCny: previewFxAmountCny,
          amountUsd: previewFxAmountUsd,
        },
      ])
    : undefined;
  const fxExceedsCnyCash =
    isFxPreviewComplete && previewFxAmountCny > balances.cnyCash;
  const canSaveFx = Boolean(
    projectedFxBalances &&
      Number.isFinite(projectedFxBalances.cnyCash) &&
      Number.isFinite(projectedFxBalances.usdCash) &&
      previewFxEffectiveCnyPerUsd !== undefined &&
      Number.isFinite(previewFxEffectiveCnyPerUsd) &&
      !fxExceedsCnyCash,
  );
  const previewDividendSymbol = dividendSymbol.trim().toUpperCase();
  const previewDividendGrossAmountUsd = Number(dividendGrossAmountUsd);
  const previewDividendWithholdingTaxUsd = Number(
    dividendWithholdingTaxUsd,
  );
  const previewDividendNetAmountUsd =
    previewDividendGrossAmountUsd - previewDividendWithholdingTaxUsd;
  const previewDividendReinvestmentPriceUsd = Number(
    dividendReinvestmentPriceUsd,
  );
  const isDividendReinvested = dividendPaymentMethod === "REINVEST";
  const isDividendPreviewComplete =
    Boolean(dividendDate && previewDividendSymbol) &&
    Number.isFinite(previewDividendGrossAmountUsd) &&
    previewDividendGrossAmountUsd > 0 &&
    Number.isFinite(previewDividendWithholdingTaxUsd) &&
    previewDividendWithholdingTaxUsd >= 0 &&
    previewDividendWithholdingTaxUsd <= previewDividendGrossAmountUsd &&
    (!isDividendReinvested ||
      (previewDividendNetAmountUsd > 0 &&
        Number.isFinite(previewDividendReinvestmentPriceUsd) &&
        previewDividendReinvestmentPriceUsd > 0));
  const previewDividendReinvestmentShares =
    isDividendPreviewComplete && isDividendReinvested
      ? previewDividendNetAmountUsd / previewDividendReinvestmentPriceUsd
      : undefined;
  const previewDividendEvents: LedgerEvent[] = isDividendPreviewComplete
    ? [
        {
          id: "dividend-preview",
          occurredAt: dividendDate,
          accountId: "personal-main",
          type: "DIVIDEND",
          symbol: previewDividendSymbol,
          grossAmountUsd: previewDividendGrossAmountUsd,
          withholdingTaxUsd: previewDividendWithholdingTaxUsd,
        },
        ...(previewDividendReinvestmentShares !== undefined
          ? [
              {
                id: "dividend-reinvestment-preview",
                occurredAt: dividendDate,
                accountId: "personal-main",
                type: "BUY" as const,
                symbol: previewDividendSymbol,
                quantity: previewDividendReinvestmentShares,
                priceUsd: previewDividendReinvestmentPriceUsd,
                feeUsd: 0,
              },
            ]
          : []),
      ]
    : [];
  const projectedDividendBalances = isDividendPreviewComplete
    ? calculateBalances([...ledger, ...previewDividendEvents])
    : undefined;
  const previewDividendPosition = balances.positions.find(
    (position) => position.symbol === previewDividendSymbol,
  );
  const projectedDividendPosition = projectedDividendBalances?.positions.find(
    (position) => position.symbol === previewDividendSymbol,
  );
  const canSaveDividend = Boolean(
    projectedDividendBalances &&
      Number.isFinite(projectedDividendBalances.usdCash) &&
      (previewDividendReinvestmentShares === undefined ||
        Number.isFinite(previewDividendReinvestmentShares)),
  );
  const previewInterestAmount = Number(interestAmount);
  const isInterestPreviewComplete =
    Boolean(interestDate) &&
    Number.isFinite(previewInterestAmount) &&
    previewInterestAmount > 0;
  const projectedInterestBalances = isInterestPreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "interest-preview",
          occurredAt: interestDate,
          accountId: "personal-main",
          type: "INTEREST",
          currency: interestCurrency,
          amount: previewInterestAmount,
        },
      ])
    : undefined;
  const currentInterestCash =
    interestCurrency === "CNY"
      ? balances.cnyCash
      : interestCurrency === "HKD"
        ? balances.hkdCash
        : balances.usdCash;
  const projectedInterestCash = projectedInterestBalances
    ? interestCurrency === "CNY"
      ? projectedInterestBalances.cnyCash
      : interestCurrency === "HKD"
        ? projectedInterestBalances.hkdCash
        : projectedInterestBalances.usdCash
    : undefined;
  const canSaveInterest =
    projectedInterestCash !== undefined &&
    Number.isFinite(projectedInterestCash);
  const previewExpenseAmountUsd = Number(expenseAmountUsd);
  const isExpensePreviewComplete =
    Boolean(expenseDate) &&
    Number.isFinite(previewExpenseAmountUsd) &&
    previewExpenseAmountUsd > 0;
  const projectedExpenseBalances = isExpensePreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "expense-preview",
          occurredAt: expenseDate,
          accountId: "personal-main",
          type: "FEE",
          amountUsd: previewExpenseAmountUsd,
          category: expenseCategory,
        },
      ])
    : undefined;
  const expenseExceedsUsdCash =
    isExpensePreviewComplete && previewExpenseAmountUsd > balances.usdCash;
  const canSaveExpense = Boolean(
    projectedExpenseBalances &&
      Number.isFinite(projectedExpenseBalances.usdCash) &&
      Number.isFinite(projectedExpenseBalances.totalFeesUsd) &&
      !expenseExceedsUsdCash,
  );
  const previewCashbackSymbol = cashbackSymbol.trim().toUpperCase();
  const previewCashbackQuantity = Number(cashbackQuantity);
  const previewCashbackPriceUsd = Number(cashbackPriceUsd);
  const isCashbackPreviewComplete =
    Boolean(cashbackDate && previewCashbackSymbol) &&
    Number.isFinite(previewCashbackQuantity) &&
    previewCashbackQuantity > 0 &&
    Number.isFinite(previewCashbackPriceUsd) &&
    previewCashbackPriceUsd > 0;
  const previewCashbackValueUsd = isCashbackPreviewComplete
    ? previewCashbackQuantity * previewCashbackPriceUsd
    : undefined;
  const projectedCashbackBalances = isCashbackPreviewComplete
    ? calculateBalances([
        ...ledger,
        {
          id: "cashback-shares-preview",
          occurredAt: cashbackDate,
          accountId: "personal-main",
          type: "IN_KIND_CONTRIBUTION",
          source: "CASHBACK_REWARD",
          symbol: previewCashbackSymbol,
          quantity: previewCashbackQuantity,
          priceUsd: previewCashbackPriceUsd,
          currency: "USD",
        },
      ])
    : undefined;
  const previewCashbackPosition = balances.positions.find(
    (position) => position.symbol === previewCashbackSymbol,
  );
  const projectedCashbackPosition = projectedCashbackBalances?.positions.find(
    (position) => position.symbol === previewCashbackSymbol,
  );
  const canSaveCashback = Boolean(
    projectedCashbackBalances &&
      previewCashbackValueUsd !== undefined &&
      Number.isFinite(previewCashbackValueUsd) &&
      projectedCashbackPosition &&
      Number.isFinite(projectedCashbackPosition.quantity) &&
      Number.isFinite(projectedCashbackPosition.costUsd),
  );
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
    const positionExists = historicalPositionSymbols.includes(positionSymbol);

    if (!positionExists || !providerSymbol || !exchange) {
      setMessage(
        "Choose a historical position and enter its market-data symbol and exchange.",
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

  async function calculateHistoricalUsdTwr() {
    const dates = selectUsdTwrSnapshotDates(ledger, previousLocalDate());
    if (dates.length < 2) {
      setUsdTwrState({
        status: "UNAVAILABLE",
        sourceLedger: ledger,
        sourceProfiles: securityProfiles,
        reasons: ["At least one completed close after the first ledger date is needed."],
      });
      return;
    }

    const requestId = usdTwrRequestId.current + 1;
    usdTwrRequestId.current = requestId;
    setUsdTwrState({
      status: "LOADING",
      sourceLedger: ledger,
      sourceProfiles: securityProfiles,
    });

    try {
      const quoteService = new CachedSecurityQuoteService(
        holdingsMarketDataCache,
        new EastmoneyUsEodProvider(),
      );
      const loaded = await loadHistoricalValuationInputs(
        ledger,
        dates,
        securityProfiles,
        valuationFxService,
        quoteService,
      );
      if (usdTwrRequestId.current !== requestId) return;

      if (loaded.status === "UNAVAILABLE") {
        setUsdTwrState({
          status: "UNAVAILABLE",
          sourceLedger: ledger,
          sourceProfiles: securityProfiles,
          reasons: loaded.issues.map(
            (issue) => `${issue.date} · ${issue.symbol ?? issue.kind}: ${issue.message}`,
          ),
        });
        return;
      }

      const snapshots = calculateDailyPortfolioSnapshots(ledger, loaded.inputs);
      const points = calculateUsdTwrSeries(snapshots);
      const benchmarks = await loadBenchmarkPriceChanges(
        points[0].date,
        points.at(-1)!.date,
        quoteService,
      );
      if (usdTwrRequestId.current !== requestId) return;
      setUsdTwrState({
        status: "READY",
        sourceLedger: ledger,
        sourceProfiles: securityProfiles,
        cumulativeReturn: points.at(-1)!.cumulativeReturn,
        startDate: points[0].date,
        endDate: points.at(-1)!.date,
        snapshotCount: points.length,
        benchmarks,
      });
    } catch (error) {
      if (usdTwrRequestId.current !== requestId) return;
      setUsdTwrState({
        status: "UNAVAILABLE",
        sourceLedger: ledger,
        sourceProfiles: securityProfiles,
        reasons: [
          error instanceof Error ? error.message : "Historical return could not be calculated.",
        ],
      });
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

    if (!canSaveDeposit) {
      setMessage("Please enter a valid date and a positive CNY amount.");
      return;
    }

    const deposit: LedgerEvent = {
      id: createLedgerEventId("deposit"),
      occurredAt: depositDate,
      accountId: "personal-main",
      type: "CNY_DEPOSIT",
      amountCny,
      note: depositNote.trim() || "Manual CNY deposit",
    };

    if (!persistLedgerChanges([...ledger, deposit])) {
      return;
    }
    setDepositAmount("");
    setDepositNote("");
    setMessage("Deposit saved locally in this browser.");
  }

  function addCnyWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(withdrawalAmount);

    if (!isWithdrawalPreviewComplete) {
      setMessage("Please enter a valid date and a positive CNY amount.");
      return;
    }

    if (!canSaveWithdrawal) {
      setMessage("Withdrawal cannot exceed current CNY cash.");
      return;
    }

    const withdrawal: LedgerEvent = {
      id: createLedgerEventId("withdrawal"),
      occurredAt: withdrawalDate,
      accountId: "personal-main",
      type: "CNY_WITHDRAWAL",
      amountCny,
      note: withdrawalNote.trim() || "Manual CNY withdrawal",
    };

    if (!persistLedgerChanges([...ledger, withdrawal])) {
      return;
    }
    setWithdrawalAmount("");
    setWithdrawalNote("");
    setMessage("CNY withdrawal saved locally in this browser.");
  }

  function addFxToUsd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(fxAmountCny);
    const amountUsd = Number(fxAmountUsd);

    if (!isFxPreviewComplete) {
      setMessage("Please enter a valid date, CNY amount, and USD amount.");
      return;
    }

    if (fxExceedsCnyCash) {
      setMessage("CNY spent cannot exceed current CNY cash.");
      return;
    }

    if (!canSaveFx) {
      setMessage("Conversion amounts are too large. Enter smaller values.");
      return;
    }

    const fxConversion: LedgerEvent = {
      id: createLedgerEventId("fx-usd"),
      occurredAt: fxDate,
      accountId: "personal-main",
      type: "FX_TO_USD",
      amountCny,
      amountUsd,
      note: fxNote.trim() || "Manual CNY to USD conversion",
    };

    if (!persistLedgerChanges([...ledger, fxConversion])) {
      return;
    }
    setFxAmountCny("");
    setFxAmountUsd("");
    setFxNote("");
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
      note:
        cashbackNote.trim() || "Payment cashback received directly as shares",
    };

    if (!persistLedgerChanges([...ledger, contribution])) {
      return;
    }
    setCashbackSymbol("");
    setCashbackQuantity("");
    setCashbackPriceUsd("");
    setCashbackNote("");
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
      note:
        dividendNote.trim() ||
        (isReinvested
          ? "Manual dividend payment with reinvestment"
          : "Manual cash dividend payment"),
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
    setDividendNote("");
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
      note:
        interestNote.trim() || "Manual interest payment received after tax",
    };

    if (!persistLedgerChanges([...ledger, interest])) {
      return;
    }
    setInterestAmount("");
    setInterestNote("");
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
        expenseNote.trim() ||
        (expenseCategory === "ADR_FEE"
          ? "Manual ADR custody fee"
          : "Manual other USD expense"),
    };

    if (!persistLedgerChanges([...ledger, expense])) {
      return;
    }
    setExpenseAmountUsd("");
    setExpenseNote("");
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
              Choose a transaction type, enter its details, preview the ledger
              impact, and save it locally.
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
                      {option.label} · unified flow
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

              {selectedTransactionType === "CNY_DEPOSIT" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addCnyDeposit}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>CNY deposit</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={depositDate}
                          onChange={(event) =>
                            setDepositDate(event.target.value)
                          }
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
                    <legend>Cash flow</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Amount deposited (CNY)
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={depositAmount}
                          onChange={(event) =>
                            setDepositAmount(event.target.value)
                          }
                          placeholder="e.g. 1000"
                          required
                        />
                      </label>
                      <label>
                        Currency
                        <input value="CNY" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={depositNote}
                          onChange={(event) =>
                            setDepositNote(event.target.value)
                          }
                          placeholder="Bank reference or source"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="deposit-impact-preview"
                    data-testid="deposit-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="deposit-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedDepositBalances ? (
                      <dl>
                        <div>
                          <dt>CNY deposit</dt>
                          <dd>+{cny.format(previewDepositAmountCny)}</dd>
                        </div>
                        <div>
                          <dt>CNY cash</dt>
                          <dd>
                            {cny.format(balances.cnyCash)} →{" "}
                            {cny.format(projectedDepositBalances.cnyCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>Other balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>Enter a positive CNY amount to preview this deposit.</p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveDeposit}>
                    4. Save deposit
                  </button>
                </form>
              )}

              {selectedTransactionType === "CNY_WITHDRAWAL" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addCnyWithdrawal}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>CNY withdrawal</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={withdrawalDate}
                          onChange={(event) =>
                            setWithdrawalDate(event.target.value)
                          }
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
                    <legend>Cash flow</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Amount withdrawn (CNY)
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={withdrawalAmount}
                          onChange={(event) =>
                            setWithdrawalAmount(event.target.value)
                          }
                          placeholder="e.g. 500"
                          required
                        />
                      </label>
                      <label>
                        Currency
                        <input value="CNY" readOnly />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={withdrawalNote}
                          onChange={(event) =>
                            setWithdrawalNote(event.target.value)
                          }
                          placeholder="Bank reference or destination"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="withdrawal-impact-preview"
                    data-testid="withdrawal-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="withdrawal-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedWithdrawalBalances ? (
                      <dl>
                        <div>
                          <dt>CNY withdrawal</dt>
                          <dd>{cny.format(-previewWithdrawalAmountCny)}</dd>
                        </div>
                        <div>
                          <dt>CNY cash</dt>
                          <dd>
                            {cny.format(balances.cnyCash)} →{" "}
                            {cny.format(projectedWithdrawalBalances.cnyCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>Other balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>Enter a positive CNY amount to preview this withdrawal.</p>
                    )}
                    {withdrawalExceedsCash && (
                      <p className="transaction-impact-warning" role="alert">
                        Withdrawal exceeds current CNY cash.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveWithdrawal}>
                    4. Save withdrawal
                  </button>
                </form>
              )}

              {selectedTransactionType === "FX_TO_USD" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addFxToUsd}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>CNY to USD conversion</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={fxDate}
                          onChange={(event) => setFxDate(event.target.value)}
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
                    <legend>Conversion</legend>
                    <div className="transaction-form-grid">
                      <label>
                        CNY spent
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={fxAmountCny}
                          onChange={(event) =>
                            setFxAmountCny(event.target.value)
                          }
                          placeholder="e.g. 7200"
                          required
                        />
                      </label>
                      <label>
                        USD received
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={fxAmountUsd}
                          onChange={(event) =>
                            setFxAmountUsd(event.target.value)
                          }
                          placeholder="e.g. 1000"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={fxNote}
                          onChange={(event) => setFxNote(event.target.value)}
                          placeholder="Bank reference or conversion details"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="fx-impact-preview"
                    data-testid="fx-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="fx-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedFxBalances &&
                    previewFxEffectiveCnyPerUsd !== undefined ? (
                      <dl>
                        <div>
                          <dt>CNY cash</dt>
                          <dd>
                            {cny.format(balances.cnyCash)} →{" "}
                            {cny.format(projectedFxBalances.cnyCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>USD cash</dt>
                          <dd>
                            {usd.format(balances.usdCash)} →{" "}
                            {usd.format(projectedFxBalances.usdCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>Effective rate</dt>
                          <dd>
                            1 USD = {fxRateNumber.format(
                              previewFxEffectiveCnyPerUsd,
                            )} CNY
                          </dd>
                        </div>
                        <div>
                          <dt>Other balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>
                        Enter positive CNY spent and USD received amounts to
                        preview this conversion.
                      </p>
                    )}
                    {fxExceedsCnyCash && (
                      <p className="transaction-impact-warning" role="alert">
                        CNY spent exceeds current CNY cash.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveFx}>
                    4. Save conversion
                  </button>
                </form>
              )}

              {selectedTransactionType === "DIVIDEND" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addDividend}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>Dividend</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={dividendDate}
                          onChange={(event) =>
                            setDividendDate(event.target.value)
                          }
                          required
                        />
                      </label>
                      <label>
                        Account
                        <input value="personal-main" readOnly />
                      </label>
                      <label>
                        Symbol
                        <input
                          type="text"
                          value={dividendSymbol}
                          onChange={(event) =>
                            setDividendSymbol(event.target.value)
                          }
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
                    <legend>Payment and tax</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Gross amount (USD)
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={dividendGrossAmountUsd}
                          onChange={(event) =>
                            setDividendGrossAmountUsd(event.target.value)
                          }
                          placeholder="e.g. 6.20"
                          required
                        />
                      </label>
                      <label>
                        Withholding tax (USD)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={dividendWithholdingTaxUsd}
                          onChange={(event) =>
                            setDividendWithholdingTaxUsd(event.target.value)
                          }
                          placeholder="e.g. 0.62"
                          required
                        />
                      </label>
                      <label>
                        Payment method
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
                      {isDividendReinvested && (
                        <label>
                          Reinvestment price (USD per share)
                          <input
                            type="number"
                            min="0.000001"
                            step="0.000001"
                            value={dividendReinvestmentPriceUsd}
                            onChange={(event) =>
                              setDividendReinvestmentPriceUsd(
                                event.target.value,
                              )
                            }
                            placeholder="e.g. 500"
                            required
                          />
                        </label>
                      )}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={dividendNote}
                          onChange={(event) =>
                            setDividendNote(event.target.value)
                          }
                          placeholder="Broker reference or payment details"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="dividend-impact-preview"
                    data-testid="dividend-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="dividend-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedDividendBalances ? (
                      <dl>
                        <div>
                          <dt>Net dividend</dt>
                          <dd>+{usd.format(previewDividendNetAmountUsd)}</dd>
                        </div>
                        <div>
                          <dt>Withholding tax</dt>
                          <dd>{usd.format(previewDividendWithholdingTaxUsd)}</dd>
                        </div>
                        <div>
                          <dt>USD cash</dt>
                          <dd>
                            {usd.format(balances.usdCash)} →{" "}
                            {usd.format(projectedDividendBalances.usdCash)}
                          </dd>
                        </div>
                        {previewDividendReinvestmentShares !== undefined && (
                          <>
                            <div>
                              <dt>Reinvested shares</dt>
                              <dd>
                                +{previewDividendReinvestmentShares.toFixed(6)}{" "}
                                {previewDividendSymbol}
                              </dd>
                            </div>
                            <div>
                              <dt>Position</dt>
                              <dd>
                                {previewDividendPosition?.quantity ?? 0} →{" "}
                                {projectedDividendPosition?.quantity ?? 0}{" "}
                                {previewDividendSymbol}
                              </dd>
                            </div>
                            <div>
                              <dt>Cost basis</dt>
                              <dd>
                                {usd.format(
                                  previewDividendPosition?.costUsd ?? 0,
                                )}{" "}
                                →{" "}
                                {usd.format(
                                  projectedDividendPosition?.costUsd ?? 0,
                                )}
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                    ) : (
                      <p>
                        Complete the dividend and tax details
                        {isDividendReinvested
                          ? " plus the reinvestment price"
                          : ""}{" "}
                        to preview this payment.
                      </p>
                    )}
                    {Number.isFinite(previewDividendGrossAmountUsd) &&
                      previewDividendGrossAmountUsd > 0 &&
                      Number.isFinite(previewDividendWithholdingTaxUsd) &&
                      previewDividendWithholdingTaxUsd >
                        previewDividendGrossAmountUsd && (
                        <p className="transaction-impact-warning" role="alert">
                          Withholding tax cannot exceed the gross dividend.
                        </p>
                      )}
                  </section>

                  <button type="submit" disabled={!canSaveDividend}>
                    4. Save dividend
                  </button>
                </form>
              )}

              {selectedTransactionType === "INTEREST" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addInterest}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>Interest income</h3>
                  </div>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={interestDate}
                          onChange={(event) =>
                            setInterestDate(event.target.value)
                          }
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
                    <legend>Payment details</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Currency
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
                      <label>
                        Amount received after tax ({interestCurrency})
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={interestAmount}
                          onChange={(event) =>
                            setInterestAmount(event.target.value)
                          }
                          placeholder="e.g. 12.34"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={interestNote}
                          onChange={(event) =>
                            setInterestNote(event.target.value)
                          }
                          placeholder="Bank reference or interest period"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="interest-impact-preview"
                    data-testid="interest-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="interest-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedInterestCash !== undefined ? (
                      <dl>
                        <div>
                          <dt>Interest received</dt>
                          <dd>
                            +{currencyFormatters[interestCurrency].format(
                              previewInterestAmount,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{interestCurrency} cash</dt>
                          <dd>
                            {currencyFormatters[interestCurrency].format(
                              currentInterestCash,
                            )}{" "}
                            →{" "}
                            {currencyFormatters[interestCurrency].format(
                              projectedInterestCash,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Other balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>
                        Enter a positive after-tax amount to preview this
                        interest payment.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveInterest}>
                    4. Save interest
                  </button>
                </form>
              )}

              {selectedTransactionType === "FEE" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addUsdExpense}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>USD expense</h3>
                  </div>
                  <p>
                    Record ADR custody fees or other USD cash deductions.
                    Trading commissions belong in the related buy or sell
                    transaction.
                  </p>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={expenseDate}
                          onChange={(event) =>
                            setExpenseDate(event.target.value)
                          }
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
                    <legend>Payment details</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Expense category
                        <select
                          value={expenseCategory}
                          onChange={(event) =>
                            setExpenseCategory(
                              event.target.value as ExpenseCategory,
                            )
                          }
                        >
                          <option value="ADR_FEE">ADR custody fee</option>
                          <option value="OTHER">Other USD expense</option>
                        </select>
                      </label>
                      <label>
                        Amount paid (USD)
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={expenseAmountUsd}
                          onChange={(event) =>
                            setExpenseAmountUsd(event.target.value)
                          }
                          placeholder="e.g. 2.50"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={expenseNote}
                          onChange={(event) =>
                            setExpenseNote(event.target.value)
                          }
                          placeholder="Broker reference or fee period"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="expense-impact-preview"
                    data-testid="expense-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="expense-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedExpenseBalances ? (
                      <dl>
                        <div>
                          <dt>Expense</dt>
                          <dd>-{usd.format(previewExpenseAmountUsd)}</dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>
                            {expenseCategory === "ADR_FEE"
                              ? "ADR custody fee"
                              : "Other USD expense"}
                          </dd>
                        </div>
                        <div>
                          <dt>USD cash</dt>
                          <dd>
                            {usd.format(balances.usdCash)} →{" "}
                            {usd.format(projectedExpenseBalances.usdCash)}
                          </dd>
                        </div>
                        <div>
                          <dt>Accumulated fees</dt>
                          <dd>
                            {usd.format(balances.totalFeesUsd)} →{" "}
                            {usd.format(projectedExpenseBalances.totalFeesUsd)}
                          </dd>
                        </div>
                        <div>
                          <dt>Other balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>
                        Enter a positive USD amount to preview this expense.
                      </p>
                    )}
                    {expenseExceedsUsdCash && (
                      <p className="transaction-impact-warning" role="alert">
                        USD expense cannot exceed current USD cash.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveExpense}>
                    4. Save expense
                  </button>
                </form>
              )}

              {selectedTransactionType === "IN_KIND_CONTRIBUTION" && (
                <form
                  className="unified-transaction-form"
                  onSubmit={addCashbackShares}
                >
                  <div className="transaction-flow-heading">
                    <span>2. Enter details</span>
                    <h3>Payment cashback shares</h3>
                  </div>
                  <p>
                    Record shares delivered directly by a rewards platform.
                    This is a non-cash contribution and does not create a cash
                    deposit or FX conversion.
                  </p>

                  <fieldset>
                    <legend>Basic information</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Date
                        <input
                          type="date"
                          value={cashbackDate}
                          onChange={(event) =>
                            setCashbackDate(event.target.value)
                          }
                          required
                        />
                      </label>
                      <label>
                        Account
                        <input value="personal-main" readOnly />
                      </label>
                      <label>
                        Source
                        <input value="Payment cashback" readOnly />
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
                          value={cashbackSymbol}
                          onChange={(event) =>
                            setCashbackSymbol(event.target.value)
                          }
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
                    <legend>Acquisition details</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Actual shares received
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={cashbackQuantity}
                          onChange={(event) =>
                            setCashbackQuantity(event.target.value)
                          }
                          placeholder="e.g. 0.125"
                          required
                        />
                      </label>
                      <label>
                        Acquisition price (USD per share)
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={cashbackPriceUsd}
                          onChange={(event) =>
                            setCashbackPriceUsd(event.target.value)
                          }
                          placeholder="e.g. 500"
                          required
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>Notes</legend>
                    <div className="transaction-form-grid">
                      <label>
                        Note (optional)
                        <textarea
                          value={cashbackNote}
                          onChange={(event) =>
                            setCashbackNote(event.target.value)
                          }
                          placeholder="Reward reference or acquisition details"
                        />
                      </label>
                    </div>
                  </fieldset>

                  <section
                    className="transaction-impact-preview"
                    aria-labelledby="cashback-impact-preview"
                    data-testid="cashback-impact-preview"
                  >
                    <div className="transaction-flow-heading">
                      <span>3. Preview impact</span>
                      <h3 id="cashback-impact-preview">Ledger impact</h3>
                    </div>
                    {projectedCashbackBalances &&
                    projectedCashbackPosition &&
                    previewCashbackValueUsd !== undefined ? (
                      <dl>
                        <div>
                          <dt>Contribution value</dt>
                          <dd>+{usd.format(previewCashbackValueUsd)}</dd>
                        </div>
                        <div>
                          <dt>Position</dt>
                          <dd>
                            {previewCashbackPosition?.quantity ?? 0} →{" "}
                            {projectedCashbackPosition.quantity}{" "}
                            {previewCashbackSymbol}
                          </dd>
                        </div>
                        <div>
                          <dt>Cost basis</dt>
                          <dd>
                            {usd.format(
                              previewCashbackPosition?.costUsd ?? 0,
                            )}{" "}
                            → {usd.format(projectedCashbackPosition.costUsd)}
                          </dd>
                        </div>
                        <div>
                          <dt>Cash balances</dt>
                          <dd>Unchanged</dd>
                        </div>
                        <div>
                          <dt>Realized P&amp;L</dt>
                          <dd>Unchanged</dd>
                        </div>
                        <div>
                          <dt>Accumulated fees</dt>
                          <dd>Unchanged</dd>
                        </div>
                      </dl>
                    ) : (
                      <p>
                        Complete the instrument and acquisition details to
                        preview this non-cash contribution.
                      </p>
                    )}
                  </section>

                  <button type="submit" disabled={!canSaveCashback}>
                    4. Save cashback shares
                  </button>
                </form>
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

      <section id="performance" className="page-section performance-panel">
        <div className="page-section-heading">
          <p className="section-eyebrow">Performance</p>
          <h2>CNY portfolio performance</h2>
          <p>
            Current wealth, outside funding, total profit or loss, and the
            annualized return experienced by the investor.
          </p>
        </div>

        <dl className="performance-summary-grid">
          <div>
            <dt>Current NAV</dt>
            <dd>
              {currentCnyPerformance.navCny === undefined
                ? "Unavailable"
                : cny.format(currentCnyPerformance.navCny)}
            </dd>
            <small>Cash plus completely covered holdings</small>
          </div>
          <div>
            <dt>Net contributions</dt>
            <dd>
              {currentCnyPerformance.cumulativeNetContributionsCny === undefined
                ? isInKindContributionValueLoading
                  ? "Loading…"
                  : "Unavailable"
                : cny.format(
                    currentCnyPerformance.cumulativeNetContributionsCny,
                  )}
            </dd>
            <small>
              Cash {cny.format(
                currentCnyPerformance.cumulativeExternalCashContributionsCny,
              )}
              {" + in-kind "}
              {currentCnyPerformance.cumulativeExternalInKindContributionsCny ===
              undefined
                ? "pending"
                : cny.format(
                    currentCnyPerformance.cumulativeExternalInKindContributionsCny,
                  )}
              {" − withdrawals "}
              {cny.format(
                currentCnyPerformance.cumulativeExternalWithdrawalsCny,
              )}
            </small>
          </div>
          <div>
            <dt>Total P&amp;L</dt>
            <dd>
              {currentCnyPerformance.totalPnlCny === undefined
                ? "Unavailable"
                : cny.format(currentCnyPerformance.totalPnlCny)}
            </dd>
            <small>Current NAV minus net contributions</small>
          </div>
          <div>
            <dt>CNY XIRR</dt>
            <dd>
              {currentCnyPerformance.xirrAnnualRate === undefined
                ? "Unavailable"
                : percentage.format(currentCnyPerformance.xirrAnnualRate)}
            </dd>
            <small>
              Annualized · ACTUAL/365 · as of {currentCnyPerformance.asOfDate}
            </small>
          </div>
        </dl>

        {currentCnyPerformance.unavailableReasons.length > 0 && (
          <div className="performance-unavailable" role="status">
            <strong>Some performance metrics are unavailable</strong>
            <ul>
              {currentCnyPerformance.unavailableReasons.map((reason) => (
                <li key={reason}>
                  {reason === "IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE" &&
                  isInKindContributionValueLoading
                    ? "Loading the historical USD/CNY rate for an in-kind contribution."
                    : reason === "IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE" &&
                        hasInKindContributionValueError
                      ? "A historical USD/CNY rate could not be loaded for an in-kind contribution."
                      : performanceUnavailableReasonLabels[reason]}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="performance-usd-twr">
          <h3>USD time-weighted return</h3>
          <p>
            Cumulative investment return in USD, with deposits, withdrawals,
            and in-kind contributions removed at each completed daily close.
            The first close sets the 100-point starting index.
          </p>
          <button
            type="button"
            onClick={() => void calculateHistoricalUsdTwr()}
            disabled={!isPersonalLedger || displayedUsdTwrState.status === "LOADING"}
          >
            {displayedUsdTwrState.status === "LOADING"
              ? "Calculating…"
              : displayedUsdTwrState.status === "READY"
                ? "Recalculate USD TWR"
                : "Calculate USD TWR"}
          </button>
          {!isPersonalLedger && (
            <p>Start or import a personal ledger to calculate historical return.</p>
          )}
          {displayedUsdTwrState.status === "READY" && (
            <div role="status">
              <p className="performance-usd-twr-result">
                <strong>{percentage.format(displayedUsdTwrState.cumulativeReturn)}</strong>
                {" cumulative · "}
                {displayedUsdTwrState.startDate} to {displayedUsdTwrState.endDate}
                {` · ${displayedUsdTwrState.snapshotCount} closes`}
              </p>
              <h4>IVV and QQQ comparison</h4>
              <p>
                Same period, USD closing-price change. Benchmark prices are
                unadjusted and exclude distributions; portfolio TWR includes
                recorded dividends, so these are reference prices rather than
                like-for-like total returns.
              </p>
              <dl className="performance-benchmarks">
                {displayedUsdTwrState.benchmarks.map((benchmark) => (
                  <div key={benchmark.symbol}>
                    <dt>{benchmark.symbol}</dt>
                    {benchmark.status === "READY" ? (
                      <dd>
                        <strong>{percentage.format(benchmark.priceChange)}</strong>
                        <span>
                          Closes: {benchmark.startCloseDate} to {benchmark.endCloseDate}
                        </span>
                      </dd>
                    ) : (
                      <dd>Unavailable: {benchmark.reason}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </div>
          )}
          {displayedUsdTwrState.status === "UNAVAILABLE" && (
            <div className="performance-unavailable" role="status">
              <strong>USD TWR unavailable</strong>
              <ul>
                {displayedUsdTwrState.reasons.slice(0, 3).map((reason, index) => (
                  <li key={`${index}:${reason}`}>{reason}</li>
                ))}
              </ul>
              {displayedUsdTwrState.reasons.length > 3 && (
                <p>{displayedUsdTwrState.reasons.length - 3} more missing inputs.</p>
              )}
            </div>
          )}
        </div>

        <div className="performance-ledger-results">
          <h3>Supporting USD ledger results</h3>
          <dl>
            <div>
              <dt>Realized P&amp;L</dt>
              <dd>{usd.format(balances.realizedPnlUsd)}</dd>
            </div>
            <div>
              <dt>Accumulated fees and USD expenses</dt>
              <dd>{usd.format(balances.totalFeesUsd)}</dd>
            </div>
          </dl>
        </div>
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
            Map every security held now or in the past to its market-data
            identifier. Historical mappings support past portfolio valuation.
            This does not change transactions, cash, cost, or holdings. Quote
            currency is currently fixed to USD.
          </p>

          {securityProfileRegistry.status === "INVALID" && (
            <p className="security-profile-warning">
              The saved security profiles could not be read: {" "}
              {securityProfileRegistry.error} Saving a valid profile will
              replace the invalid registry.
            </p>
          )}

          {historicalPositionSymbols.length === 0 ? (
            <p>Add a security purchase before creating a profile.</p>
          ) : (
            <>
              <ul className="security-profile-list">
                {historicalPositionSymbols.map((symbol) => {
                  const profile = securityProfiles.find(
                    (item) => item.positionSymbol === symbol,
                  );

                  return (
                    <li
                      key={symbol}
                      data-testid={`security-profile-status-${symbol}`}
                    >
                      <strong>
                        {symbol}{openPositionSymbols.has(symbol) ? "" : " · closed"}
                      </strong>
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
                  Historical position
                  <select
                    id="profile-position-symbol"
                    value={profilePositionSymbol}
                    onChange={(event) =>
                      selectProfilePosition(event.target.value)
                    }
                    required
                  >
                    <option value="">Select a position</option>
                    {historicalPositionSymbols.map((symbol) => (
                      <option key={symbol} value={symbol}>
                        {symbol}{openPositionSymbols.has(symbol) ? "" : " (closed)"}
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
