import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import "./App.css";
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
import { CacheOnlySecurityQuoteProvider } from "./data/providers/cacheOnlySecurityQuoteProvider";
import { FrankfurterFxProvider } from "./data/providers/frankfurterFxProvider";
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
import type { Currency, LedgerEvent } from "./domain/ledger";
import type { FxRateRequest, MarketDataAssetType } from "./domain/marketData";

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

const holdingsQuoteService = new CachedSecurityQuoteService(
  new IndexedDbMarketDataCache(),
  new CacheOnlySecurityQuoteProvider(),
);

type ValuationFxRates = Partial<Record<ValuationFxKey, FxRateResolution>>;

type ExpenseCategory = "ADR_FEE" | "OTHER";

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
  const [sellDate, setSellDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sellSymbol, setSellSymbol] = useState("");
  const [sellQuantity, setSellQuantity] = useState("");
  const [sellPriceUsd, setSellPriceUsd] = useState("");
  const [sellFeeUsd, setSellFeeUsd] = useState("0");
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
  const staleCashValuationCurrencies = valuationFxRequests
    .filter(({ key }) => {
      const resolution = valuationFxRates[key];
      const cashBalance = key === "USD_CNY" ? balances.usdCash : balances.hkdCash;

      return cashBalance !== 0 && resolution?.status === "CACHE_STALE";
    })
    .map(({ request }) => request.pair.baseCurrency);
  const usdCashHistory = calculateUsdCashHistory(ledger);
  const netDividendUsd =
    Number(dividendGrossAmountUsd) - Number(dividendWithholdingTaxUsd);
  const reinvestmentShares =
    netDividendUsd / Number(dividendReinvestmentPriceUsd);

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

      const results = await Promise.all(
        mappedOpenPositions.map(async (profile) => {
          try {
            const resolution = await holdingsQuoteService.getSecurityQuote(
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
      id: `deposit-${Date.now()}`,
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
      id: `withdrawal-${Date.now()}`,
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
      id: `fx-usd-${Date.now()}`,
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
      id: `buy-${Date.now()}`,
      occurredAt: buyDate,
      accountId: "personal-main",
      type: "BUY",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: "Manual security purchase",
    };

    if (!persistLedgerChanges([...ledger, buy])) {
      return;
    }
    setBuySymbol("");
    setBuyQuantity("");
    setBuyPriceUsd("");
    setBuyFeeUsd("0");
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

    const sell: LedgerEvent = {
      id: `sell-${Date.now()}`,
      occurredAt: sellDate,
      accountId: "personal-main",
      type: "SELL",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: "Manual security sale",
    };

    if (!persistLedgerChanges([...ledger, sell])) {
      return;
    }
    setSellSymbol("");
    setSellQuantity("");
    setSellPriceUsd("");
    setSellFeeUsd("0");
    setMessage("Sell transaction saved locally in this browser.");
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
      id: `dividend-${Date.now()}`,
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
            id: `dividend-reinvest-${Date.now()}`,
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
      id: `interest-${Date.now()}`,
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
      id: `fee-${Date.now()}`,
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

  return (
    <main>
      <h1>Atlas Portfolio</h1>
      <p>
        {isPersonalLedger
          ? "Personal ledger saved only in this browser."
          : "Demo ledger for calculation and development tests."}
      </p>

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
        <section>
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
        <section>
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
        <section>
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
        <section>
          <h2>Add USD security purchase</h2>
          <form onSubmit={addBuy}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={buyDate}
                  onChange={(event) => setBuyDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={buySymbol}
                  onChange={(event) => setBuySymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Quantity{" "}
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={buyQuantity}
                  onChange={(event) => setBuyQuantity(event.target.value)}
                  placeholder="e.g. 2"
                />
              </label>
            </p>
            <p>
              <label>
                Price (USD per share){" "}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={buyPriceUsd}
                  onChange={(event) => setBuyPriceUsd(event.target.value)}
                  placeholder="e.g. 500"
                />
              </label>
            </p>
            <p>
              <label>
                Fee (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={buyFeeUsd}
                  onChange={(event) => setBuyFeeUsd(event.target.value)}
                  placeholder="e.g. 1.23"
                />
              </label>
            </p>
            <button type="submit">Add purchase</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add USD security sale</h2>
          <form onSubmit={addSell}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={sellDate}
                  onChange={(event) => setSellDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={sellSymbol}
                  onChange={(event) => setSellSymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Quantity{" "}
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={sellQuantity}
                  onChange={(event) => setSellQuantity(event.target.value)}
                  placeholder="e.g. 1"
                />
              </label>
            </p>
            <p>
              <label>
                Price (USD per share){" "}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={sellPriceUsd}
                  onChange={(event) => setSellPriceUsd(event.target.value)}
                  placeholder="e.g. 550"
                />
              </label>
            </p>
            <p>
              <label>
                Fee (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={sellFeeUsd}
                  onChange={(event) => setSellFeeUsd(event.target.value)}
                  placeholder="e.g. 1.23"
                />
              </label>
            </p>
            <button type="submit">Add sale</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
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
        <section>
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
        <section>
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

      <section>
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

      <h2>Current balances</h2>
      <ul>
        <li>CNY cash: {cny.format(balances.cnyCash)}</li>
        <li>HKD cash: {hkd.format(balances.hkdCash)}</li>
        <li>USD cash: {usd.format(balances.usdCash)}</li>
      </ul>

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

      <section className="valuation-fx-panel" aria-labelledby="valuation-fx">
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

      <h2>Realized result</h2>
      <ul>
        <li>Realized P&amp;L: {usd.format(balances.realizedPnlUsd)}</li>
        <li>
          Accumulated fees and USD expenses: {usd.format(balances.totalFeesUsd)}
        </li>
      </ul>

      <h2>USD cash transaction history</h2>
      {usdCashHistory.length === 0 ? (
        <p>No USD cash movements recorded yet.</p>
      ) : (
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
            Refresh security quotes
          </button>
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
                  </tr>
                </thead>
                <tbody>
                  {holdingsValuation.positions.map((position) => {
                    const quoteState = positionQuoteStates[position.symbol];
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
                                )
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <h2>{isPersonalLedger ? "Personal ledger" : "Anonymous test ledger"}</h2>
      {ledger.length === 0 ? (
        <p>No transactions recorded yet.</p>
      ) : (
        <ol>
          {ledger.map((event) => (
            <li key={event.id}>
              <strong>{event.occurredAt}</strong> — {describeEvent(event)}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
