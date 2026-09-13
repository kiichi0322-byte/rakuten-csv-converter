"use client";

import React, { useState } from "react";
import Papa from "papaparse";
import Encoding from "encoding-japanese";

// ----------------------------------------------------------------------
// 共通定数
// ----------------------------------------------------------------------

const RAKUTEN_OUTPUT_HEADERS = [
  "取引日",
  "出金金額（円）",
  "入金金額（円）",
  "海外出金金額",
  "通貨",
  "変換レート（円）",
  "利用国",
  "取引内容",
  "取引先",
  "取引方法",
  "支払い区分",
  "利用者",
  "取引番号",
];

const RAKUTEN_REQUIRED_COLUMNS = [
  "利用日",
  "利用店名・商品名",
  "支払総額",
];

const PAYPAY_REQUIRED_COLUMNS = [
  "取引方法",
];

// ----------------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------------

type CsvRow = Record<string, string>;

interface RakutenLogState {
  totalInputRows: number;
  convertedRows: number;
  excludedRows: number;
  outputFilename: string;
  isMatch: boolean;
  convertedData: CsvRow[];
}

interface PayPayBreakdownItem {
  method: string;
  count: number;
}

interface PayPayReportState {
  totalRows: number;
  excludedPoints: number;
  creditData: CsvRow[];
  paypayBalanceData: CsvRow[];
  othersData: CsvRow[];
  othersBreakdown: PayPayBreakdownItem[];
  isCountOk: boolean;
  hasOthers: boolean;
  targetYear: number | null;
  targetMonth: number | null;
  creditFilename: string;
  balanceFilename: string;
  othersFilename: string;
}

// ----------------------------------------------------------------------
// 共通関数
// ----------------------------------------------------------------------

const trimValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const validateRequiredColumns = (
  data: CsvRow[],
  requiredColumns: string[]
): string[] => {
  if (data.length === 0) {
    return requiredColumns;
  }

  const columns = Object.keys(data[0] || {});

  return requiredColumns.filter((column) => !columns.includes(column));
};

const parseDateSafe = (value: string): Date | null => {
  const normalized = trimValue(value).replace(/\//g, "-");

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}/${month}/${day}`;
};

const parseYearMonthFromFilename = (
  fileName: string
): { year: number | null; month: number | null } => {
  // 2026年08月 / 202608 / 2026-08 / 2026_08 など
  const yearMonthMatch = fileName.match(
    /(20\d{2})[年\-_./]?(\d{1,2})月?/
  );

  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const month = Number(yearMonthMatch[2]);

    if (month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  // 月だけの場合
  const monthMatch = fileName.match(/(\d{1,2})月/);

  if (monthMatch) {
    const month = Number(monthMatch[1]);

    if (month >= 1 && month <= 12) {
      return { year: null, month };
    }
  }

  return { year: null, month: null };
};

const detectFirstDate = (
  data: CsvRow[],
  columns: string[]
): Date | null => {
  for (const row of data) {
    for (const column of columns) {
      const date = parseDateSafe(row[column]);

      if (date) {
        return date;
      }
    }
  }

  return null;
};

const parseAmountStrict = (
  value: unknown,
  rowNumber: number
): number => {
  const raw = trimValue(value)
    .replace(/,/g, "")
    .replace(/円/g, "");

  if (!raw) {
    throw new Error(
      `金額エラー：${rowNumber}行目の金額が空欄です。`
    );
  }

  const amount = Number(raw);

  if (!Number.isFinite(amount)) {
    throw new Error(
      `金額エラー：${rowNumber}行目の「${String(value)}」を金額として認識できません。`
    );
  }

  return amount;
};

const downloadCsv = (
  data: CsvRow[],
  filename: string,
  columns?: string[]
): void => {
  const csvString = Papa.unparse(data, {
    ...(columns ? { columns } : {}),
    newline: "\r\n",
  });

  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);

  const blob = new Blob([bom, csvString], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const readCsvFile = (
  file: File,
  onComplete: (data: CsvRow[]) => void,
  onError: (message: string) => void
): void => {
  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const result = event.target?.result;

      if (!(result instanceof ArrayBuffer)) {
        throw new Error("ファイルデータを読み込めませんでした。");
      }

      const uint8Array = new Uint8Array(result);

      const detectedEncoding = Encoding.detect(uint8Array);

      const unicodeString = Encoding.convert(uint8Array, {
        to: "UNICODE",
        from: detectedEncoding || "AUTO",
        type: "string",
      });

      Papa.parse<CsvRow>(unicodeString, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            const firstError = results.errors[0];

            onError(
              `CSVパースエラー: ${firstError.message}`
            );

            return;
          }

          onComplete(results.data);
        },
        error: (error: Error) => {
          onError(`CSVパースエラー: ${error.message}`);
        },
      });
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "ファイルの読み込み中にエラーが発生しました。"
      );
    }
  };

  reader.onerror = () => {
    onError("ファイルの読み込みに失敗しました。");
  };

  reader.readAsArrayBuffer(file);
};

// ----------------------------------------------------------------------
// メイン
// ----------------------------------------------------------------------

export default function MainApp() {
  const [activeTab, setActiveTab] =
    useState<"rakuten" | "paypay">("rakuten");

  // ============================================================
  // 楽天カード
  // ============================================================

  const [rakutenLogs, setRakutenLogs] =
    useState<RakutenLogState | null>(null);

  const [rakutenError, setRakutenError] =
    useState<string>("");

  const [rakutenProcessing, setRakutenProcessing] =
    useState(false);

  const [rakutenDownloaded, setRakutenDownloaded] =
    useState(false);

  const processRakutenCsv = (
    rawData: CsvRow[],
    fileName: string
  ): void => {
    try {
      const totalInputRows = rawData.length;

      if (totalInputRows === 0) {
        throw new Error("CSVファイルが空です。");
      }

      const missingColumns = validateRequiredColumns(
        rawData,
        RAKUTEN_REQUIRED_COLUMNS
      );

      if (missingColumns.length > 0) {
        throw new Error(
          `必要なカラムが含まれていません: ${missingColumns.join(", ")}`
        );
      }

      const validRows: {
        row: CsvRow;
        date: Date;
        originalRowNumber: number;
      }[] = [];

      const excludedRows: number[] = [];

      rawData.forEach((row, index) => {
        const date = parseDateSafe(row["利用日"]);

        if (!date) {
          excludedRows.push(index + 2);
          return;
        }

        validRows.push({
          row,
          date,
          originalRowNumber: index + 2,
        });
      });

      const convertedData: CsvRow[] = [];

      let targetYear: number | null = null;
      let targetMonth: number | null = null;

      validRows.forEach(({ row, date, originalRowNumber }) => {
        if (targetYear === null) {
          targetYear = date.getFullYear();
          targetMonth = date.getMonth() + 1;
        }

        // ------------------------------------------------------------
        // 金額
        // ・楽天カードの共同利用分なので1/2
        // ・四捨五入
        // ・不正な金額は0にせずエラー
        // ------------------------------------------------------------

        const rawAmount = parseAmountStrict(
          row["支払総額"],
          originalRowNumber
        );

        const amountHalfRound = Math.round(rawAmount / 2);

        const amountFormatted =
          Math.abs(amountHalfRound) >= 1000
            ? amountHalfRound.toLocaleString("ja-JP")
            : String(amountHalfRound);

        // ------------------------------------------------------------
        // 取引番号
        // 既存仕様を維持
        // ------------------------------------------------------------

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        const ymdStr = `${year}${month}${day}`;

        const sequenceStr = String(
          validRows.findIndex(
            (item) => item.originalRowNumber === originalRowNumber
          ) + 1
        ).padStart(8, "0");

        const transactionId =
          `9000${ymdStr}${sequenceStr}`;

        // ------------------------------------------------------------
        // 人工的な時刻は付与しない
        // ------------------------------------------------------------

        convertedData.push({
          "取引日": formatDate(date),
          "出金金額（円）": amountFormatted,
          "入金金額（円）": "-",
          "海外出金金額": "-",
          "通貨": "-",
          "変換レート（円）": "-",
          "利用国": "-",
          "取引内容": "支払い",
          "取引先": trimValue(row["利用店名・商品名"]),
          "取引方法": "楽天カード",
          "支払い区分": "-",
          "利用者": "-",
          "取引番号": transactionId,
        });
      });

      // ------------------------------------------------------------
      // ファイル名から年月を優先して取得
      // ------------------------------------------------------------

      const filenameDate =
        parseYearMonthFromFilename(fileName);

      if (filenameDate.year !== null) {
        targetYear = filenameDate.year;
      }

      if (filenameDate.month !== null) {
        targetMonth = filenameDate.month;
      }

      const outputFilename =
        targetYear !== null && targetMonth !== null
          ? `楽天カード${targetYear}年${String(targetMonth).padStart(2, "0")}月分_MoneyForward取込用.csv`
          : "楽天カード_MoneyForward取込用.csv";

      const excludedCount = excludedRows.length;
      const convertedRows = convertedData.length;

      setRakutenLogs({
        totalInputRows,
        convertedRows,
        excludedRows: excludedCount,
        outputFilename,
        isMatch:
          totalInputRows ===
          convertedRows + excludedCount,
        convertedData,
      });
    } catch (error) {
      setRakutenError(
        error instanceof Error
          ? error.message
          : "楽天カードCSVの処理中にエラーが発生しました。"
      );

      setRakutenLogs(null);
    } finally {
      setRakutenProcessing(false);
    }
  };

  const handleRakutenUpload = (
    e: React.ChangeEvent<HTMLInputElement>
  ): void => {
    const input = e.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    setRakutenProcessing(true);
    setRakutenError("");
    setRakutenLogs(null);
    setRakutenDownloaded(false);

    readCsvFile(
      file,
      (data) => {
        processRakutenCsv(data, file.name);
      },
      (message) => {
        setRakutenError(message);
        setRakutenProcessing(false);
      }
    );

    // 同じファイルを再選択した場合でもonChangeを発火させる
    input.value = "";
  };

  const handleRakutenDownload = (): void => {
    if (!rakutenLogs) {
      return;
    }

    downloadCsv(
      rakutenLogs.convertedData,
      rakutenLogs.outputFilename,
      RAKUTEN_OUTPUT_HEADERS
    );

    setRakutenDownloaded(true);
  };

  // ============================================================
  // PayPay
  // ============================================================

  const [paypayReport, setPaypayReport] =
    useState<PayPayReportState | null>(null);

  const [paypayError, setPaypayError] =
    useState<string>("");

  const [paypayProcessing, setPaypayProcessing] =
    useState(false);

  const [previewTab, setPreviewTab] =
    useState<"credit" | "balance" | "others">("credit");

  const [downloadedPayPayFiles, setDownloadedPayPayFiles] =
    useState<Record<string, boolean>>({});

  const processPayPayData = (
    df: CsvRow[],
    fileName: string
  ): void => {
    try {
      const totalRows = df.length;

      if (totalRows === 0) {
        throw new Error("CSVファイルが空です。");
      }

      const missingColumns = validateRequiredColumns(
        df,
        PAYPAY_REQUIRED_COLUMNS
      );

      if (missingColumns.length > 0) {
        throw new Error(
          `必要なカラムが含まれていません: ${missingColumns.join(", ")}`
        );
      }

      // ------------------------------------------------------------
      // 年月取得
      // ------------------------------------------------------------

      let targetYear: number | null = null;
      let targetMonth: number | null = null;

      const filenameDate =
        parseYearMonthFromFilename(fileName);

      targetYear = filenameDate.year;
      targetMonth = filenameDate.month;

      if (
        targetYear === null ||
        targetMonth === null
      ) {
        const firstDate = detectFirstDate(df, [
          "取引日時",
          "取引日",
          "利用日",
          "日時",
        ]);

        if (firstDate) {
          targetYear = firstDate.getFullYear();
          targetMonth = firstDate.getMonth() + 1;
        }
      }

      // ------------------------------------------------------------
      // ポイント除外
      // ------------------------------------------------------------

      const dfFiltered = df.filter(
        (row) =>
          trimValue(row["取引方法"]) !==
          "PayPayポイント"
      );

      const excludedPoints =
        totalRows - dfFiltered.length;

      // ------------------------------------------------------------
      // 現在の分類ルールを維持
      // ------------------------------------------------------------

      const creditTargets = [
        "クレジット VISA 6099",
        "PayPayカード VISA 6099",
      ];

      const dfCredit = dfFiltered.filter((row) =>
        creditTargets.includes(
          trimValue(row["取引方法"])
        )
      );

      const dfPaypayBalance = dfFiltered.filter(
        (row) =>
          trimValue(row["取引方法"]) ===
          "PayPay残高"
      );

      const dfOthers = dfFiltered.filter((row) => {
        const method = trimValue(row["取引方法"]);

        return (
          !creditTargets.includes(method) &&
          method !== "PayPay残高"
        );
      });

      // ------------------------------------------------------------
      // 未分類の「取引方法」を集計
      // ------------------------------------------------------------

      const breakdownMap = new Map<string, number>();

      dfOthers.forEach((row) => {
        const method =
          trimValue(row["取引方法"]) ||
          "（取引方法が空欄）";

        breakdownMap.set(
          method,
          (breakdownMap.get(method) || 0) + 1
        );
      });

      const othersBreakdown: PayPayBreakdownItem[] =
        Array.from(breakdownMap.entries())
          .map(([method, count]) => ({
            method,
            count,
          }))
          .sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count;
            }

            return a.method.localeCompare(
              b.method,
              "ja"
            );
          });

      // ------------------------------------------------------------
      // 件数チェック
      // ------------------------------------------------------------

      const processedSum =
        excludedPoints +
        dfCredit.length +
        dfPaypayBalance.length +
        dfOthers.length;

      const isCountOk =
        totalRows === processedSum;

      const hasOthers = dfOthers.length > 0;

      const yearMonthPrefix =
        targetYear !== null &&
        targetMonth !== null
          ? `${targetYear}年${String(targetMonth).padStart(2, "0")}月分_`
          : "";

      setPaypayReport({
        totalRows,
        excludedPoints,
        creditData: dfCredit,
        paypayBalanceData: dfPaypayBalance,
        othersData: dfOthers,
        othersBreakdown,
        isCountOk,
        hasOthers,
        targetYear,
        targetMonth,
        creditFilename:
          `PayPayクレジット_${yearMonthPrefix}VISA6099.csv`,
        balanceFilename:
          `PayPay残高払い_${yearMonthPrefix}抽出.csv`,
        othersFilename:
          `PayPay未分類_${yearMonthPrefix}要確認.csv`,
      });

      if (dfCredit.length > 0) {
        setPreviewTab("credit");
      } else if (dfPaypayBalance.length > 0) {
        setPreviewTab("balance");
      } else {
        setPreviewTab("others");
      }
    } catch (error) {
      setPaypayError(
        error instanceof Error
          ? error.message
          : "PayPay CSVの処理中にエラーが発生しました。"
      );

      setPaypayReport(null);
    } finally {
      setPaypayProcessing(false);
    }
  };

  const handlePaypayUpload = (
    e: React.ChangeEvent<HTMLInputElement>
  ): void => {
    const input = e.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    setPaypayProcessing(true);
    setPaypayError("");
    setPaypayReport(null);
    setDownloadedPayPayFiles({});

    readCsvFile(
      file,
      (data) => {
        processPayPayData(data, file.name);
      },
      (message) => {
        setPaypayError(message);
        setPaypayProcessing(false);
      }
    );

    input.value = "";
  };

  const handlePaypayDownload = (
    data: CsvRow[],
    filename: string,
    key: string
  ): void => {
    if (!data || data.length === 0) {
      return;
    }

    downloadCsv(data, filename);

    setDownloadedPayPayFiles((prev) => ({
      ...prev,
      [key]: true,
    }));
  };

  const getActivePreviewData = (): CsvRow[] => {
    if (!paypayReport) {
      return [];
    }

    if (previewTab === "credit") {
      return paypayReport.creditData;
    }

    if (previewTab === "balance") {
      return paypayReport.paypayBalanceData;
    }

    return paypayReport.othersData;
  };

  // ============================================================
  // レンダリング
  // ============================================================

  return (
    <main
      style={{
        width: "100%",
        maxWidth: "100vw",
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1a1a1a",
        backgroundColor: "#f8f9fa",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      {/* メニュータブ */}

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "20px",
          backgroundColor: "#e9ecef",
          padding: "4px",
          borderRadius: "10px",
        }}
      >
        <button
          onClick={() => setActiveTab("rakuten")}
          style={{
            flex: 1,
            padding: "10px 4px",
            fontSize: "13px",
            fontWeight: "bold",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            backgroundColor:
              activeTab === "rakuten"
                ? "#ffffff"
                : "transparent",
            color:
              activeTab === "rakuten"
                ? "#0066cc"
                : "#666666",
            boxShadow:
              activeTab === "rakuten"
                ? "0 1px 3px rgba(0,0,0,0.1)"
                : "none",
          }}
        >
          💳 楽天カード変換
        </button>

        <button
          onClick={() => setActiveTab("paypay")}
          style={{
            flex: 1,
            padding: "10px 4px",
            fontSize: "13px",
            fontWeight: "bold",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            backgroundColor:
              activeTab === "paypay"
                ? "#ffffff"
                : "transparent",
            color:
              activeTab === "paypay"
                ? "#ff0033"
                : "#666666",
            boxShadow:
              activeTab === "paypay"
                ? "0 1px 3px rgba(0,0,0,0.1)"
                : "none",
          }}
        >
          📱 PayPay仕分け
        </button>
      </div>

      {/* ========================================================
          楽天カード
      ======================================================== */}

      {activeTab === "rakuten" && (
        <div>
          <header
            style={{
              textAlign: "center",
              marginBottom: "16px",
            }}
          >
            <h1
              style={{
                fontSize: "18px",
                margin: 0,
              }}
            >
              💳 楽天カード明細 変換
            </h1>
          </header>

          <div
            style={{
              border: "2px dashed #0066cc",
              borderRadius: "12px",
              padding: "20px 12px",
              textAlign: "center",
              backgroundColor: "#ffffff",
              marginBottom: "20px",
              boxSizing: "border-box",
              width: "100%",
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <label
              htmlFor="rakuten-file"
              style={{
                display: "inline-block",
                backgroundColor: "#0066cc",
                color: "#ffffff",
                padding: "12px 20px",
                borderRadius: "8px",
                fontWeight: "bold",
                fontSize: "14px",
                cursor: "pointer",
                width: "100%",
                maxWidth: "280px",
                boxSizing: "border-box",
              }}
            >
              📁 CSVファイルを選択
            </label>

            <input
              id="rakuten-file"
              type="file"
              accept=".csv"
              onChange={handleRakutenUpload}
              disabled={rakutenProcessing}
              style={{ display: "none" }}
            />

            <p
              style={{
                fontSize: "11px",
                color: "#666666",
                marginTop: "10px",
                marginBottom: 0,
              }}
            >
              タップして楽天カード明細CSVを選択してください
            </p>

            {rakutenProcessing && (
              <p
                style={{
                  marginTop: "10px",
                  color: "#0066cc",
                  fontWeight: "bold",
                }}
              >
                ⏳ 処理中...
              </p>
            )}
          </div>

          {rakutenError && (
            <div
              style={{
                backgroundColor: "#ffebee",
                color: "#c62828",
                padding: "12px",
                borderRadius: "8px",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              ❌ {rakutenError}
            </div>
          )}

          {rakutenLogs && (
            <div
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "12px",
                padding: "16px",
                backgroundColor: "#ffffff",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  marginTop: 0,
                  marginBottom: "12px",
                  borderBottom: "1px solid #eee",
                  paddingBottom: "8px",
                }}
              >
                📊 処理完了レポート
              </h2>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    backgroundColor: "#f5f5f5",
                    padding: "8px",
                    borderRadius: "6px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#666666",
                    }}
                  >
                    入力件数
                  </div>
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: "15px",
                    }}
                  >
                    {rakutenLogs.totalInputRows}件
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    backgroundColor: "#e8f5e9",
                    padding: "8px",
                    borderRadius: "6px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#2e7d32",
                    }}
                  >
                    変換成功
                  </div>
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: "15px",
                      color: "#2e7d32",
                    }}
                  >
                    {rakutenLogs.convertedRows}件
                  </div>
                </div>
              </div>

              {rakutenLogs.excludedRows > 0 && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "#e65100",
                    backgroundColor: "#fff3e0",
                    padding: "8px",
                    borderRadius: "6px",
                    margin: "8px 0",
                  }}
                >
                  ℹ️ 利用日を認識できなかった
                  {rakutenLogs.excludedRows}
                  件を除外しました
                </div>
              )}

              <p
                style={{
                  fontSize: "12px",
                  color: "#444444",
                  margin: "8px 0",
                  wordBreak: "break-all",
                }}
              >
                📄 <strong>保存名:</strong>
                <br />
                {rakutenLogs.outputFilename}
              </p>

              <button
                onClick={handleRakutenDownload}
                style={{
                  width: "100%",
                  backgroundColor:
                    rakutenDownloaded
                      ? "#4caf50"
                      : "#2e7d32",
                  color: "#ffffff",
                  border: "none",
                  padding: "16px",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                  margin: "16px 0",
                }}
              >
                {rakutenDownloaded
                  ? "✅ 保存済み（再ダウンロード）"
                  : "📥 変換後CSVを保存する"}
              </button>

              <h3
                style={{
                  fontSize: "13px",
                  marginTop: "16px",
                  marginBottom: "8px",
                }}
              >
                ▼ プレビュー（全{" "}
                {rakutenLogs.convertedData.length}件）
              </h3>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "350px",
                  overflowY: "auto",
                  border: "1px solid #eee",
                  padding: "8px",
                  borderRadius: "8px",
                }}
              >
                {rakutenLogs.convertedData.map(
                  (row, idx) => (
                    <div
                      key={idx}
                      style={{
                        border:
                          "1px solid #e0e0e0",
                        borderRadius: "8px",
                        padding: "10px",
                        backgroundColor: "#fafafa",
                        fontSize: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent:
                            "space-between",
                          marginBottom: "4px",
                        }}
                      >
                        <span
                          style={{
                            color: "#666666",
                            fontSize: "11px",
                          }}
                        >
                          #{idx + 1} |{" "}
                          {row["取引日"]}
                        </span>

                        <span
                          style={{
                            fontWeight: "bold",
                            color: "#d32f2f",
                            fontSize: "13px",
                          }}
                        >
                          ￥
                          {
                            row[
                              "出金金額（円）"
                            ]
                          }
                        </span>
                      </div>

                      <div
                        style={{
                          fontWeight: "bold",
                          fontSize: "12px",
                          wordBreak:
                            "break-all",
                        }}
                      >
                        {row["取引先"]}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          PayPay
      ======================================================== */}

      {activeTab === "paypay" && (
        <div>
          <header
            style={{
              textAlign: "center",
              marginBottom: "16px",
            }}
          >
            <h1
              style={{
                fontSize: "18px",
                margin: 0,
              }}
            >
              📱 PayPay明細 自動仕分け
            </h1>
          </header>

          <div
            style={{
              border: "2px dashed #ff0033",
              borderRadius: "12px",
              padding: "20px 12px",
              textAlign: "center",
              backgroundColor: "#ffffff",
              marginBottom: "20px",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            <label
              htmlFor="paypay-file"
              style={{
                display: "inline-block",
                backgroundColor: "#ff0033",
                color: "#ffffff",
                padding: "12px 20px",
                borderRadius: "8px",
                fontWeight: "bold",
                fontSize: "14px",
                cursor: "pointer",
                width: "100%",
                maxWidth: "280px",
                boxSizing: "border-box",
              }}
            >
              📁 CSVファイルを選択
            </label>

            <input
              id="paypay-file"
              type="file"
              accept=".csv"
              onChange={handlePaypayUpload}
              disabled={paypayProcessing}
              style={{ display: "none" }}
            />

            <p
              style={{
                fontSize: "11px",
                color: "#666666",
                marginTop: "10px",
                marginBottom: 0,
              }}
            >
              タップしてPayPay明細CSVを選択してください
            </p>

            {paypayProcessing && (
              <p
                style={{
                  marginTop: "10px",
                  color: "#ff0033",
                  fontWeight: "bold",
                }}
              >
                ⏳ 処理中...
              </p>
            )}
          </div>

          {paypayError && (
            <div
              style={{
                backgroundColor: "#ffebee",
                color: "#c62828",
                padding: "12px",
                borderRadius: "8px",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              ❌ {paypayError}
            </div>
          )}

          {paypayReport && (
            <div
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "12px",
                padding: "16px",
                backgroundColor: "#ffffff",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  marginTop: 0,
                  marginBottom: "12px",
                  borderBottom: "1px solid #eee",
                  paddingBottom: "8px",
                }}
              >
                📊 処理結果サマリー
              </h2>

              <div
                style={{
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#333333",
                  marginBottom: "16px",
                }}
              >
                <div>
                  📥 <strong>入力データ総数:</strong>{" "}
                  {paypayReport.totalRows} 件
                </div>

                <div
                  style={{
                    paddingLeft: "8px",
                    borderLeft:
                      "3px solid #ddd",
                    margin: "8px 0",
                  }}
                >
                  <div>
                    1️⃣ 除外（ポイント）:{" "}
                    {paypayReport.excludedPoints} 件
                  </div>

                  <div>
                    2️⃣ クレジット抽出:{" "}
                    {paypayReport.creditData.length} 件
                  </div>

                  <div>
                    3️⃣ 残高払い抽出:{" "}
                    {
                      paypayReport
                        .paypayBalanceData
                        .length
                    }{" "}
                    件
                  </div>

                  <div>
                    4️⃣ 未分類（その他）:{" "}
                    {paypayReport.othersData.length} 件
                  </div>
                </div>
              </div>

              {/* --------------------------------------------------
                  未分類の詳細
              -------------------------------------------------- */}

              {paypayReport.hasOthers && (
                <div
                  style={{
                    backgroundColor: "#fff8e1",
                    border:
                      "1px solid #ffcc80",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: "13px",
                      marginBottom: "8px",
                      color: "#e65100",
                    }}
                  >
                    ⚠️ 未分類の取引方法
                  </div>

                  <div
                    style={{
                      fontSize: "12px",
                      color: "#444444",
                      marginBottom: "8px",
                    }}
                  >
                    未分類{" "}
                    {paypayReport.othersData.length}
                    件
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    {paypayReport.othersBreakdown.map(
                      (item) => (
                        <div
                          key={item.method}
                          style={{
                            display: "flex",
                            justifyContent:
                              "space-between",
                            gap: "12px",
                            padding:
                              "5px 0",
                            borderBottom:
                              "1px solid #f0e0c0",
                          }}
                        >
                          <span
                            style={{
                              wordBreak:
                                "break-all",
                            }}
                          >
                            ・{item.method}
                          </span>

                          <strong
                            style={{
                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            {item.count}件
                          </strong>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* --------------------------------------------------
                  診断結果
              -------------------------------------------------- */}

              <div
                style={{
                  backgroundColor: "#f9f9f9",
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "12px",
                    marginBottom: "6px",
                  }}
                >
                  【診断結果】
                </div>

                <div
                  style={{
                    fontSize: "12px",
                    color:
                      paypayReport.isCountOk
                        ? "#2e7d32"
                        : "#c62828",
                    margin: "2px 0",
                  }}
                >
                  {paypayReport.isCountOk
                    ? "✅ データの漏れはありません（件数一致）"
                    : "❌ 警告：件数が一致しません"}
                </div>

                <div
                  style={{
                    fontSize: "12px",
                    color:
                      !paypayReport.hasOthers
                        ? "#2e7d32"
                        : "#ef6c00",
                    margin: "2px 0",
                  }}
                >
                  {!paypayReport.hasOthers
                    ? "✅ 全てのデータが正しく分類されました"
                    : `⚠️ 注意：未分類のデータが ${paypayReport.othersData.length} 件あります`}
                </div>
              </div>

              {/* --------------------------------------------------
                  ダウンロード
              -------------------------------------------------- */}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  marginBottom: "20px",
                }}
              >
                <button
                  onClick={() =>
                    handlePaypayDownload(
                      paypayReport.creditData,
                      paypayReport.creditFilename,
                      "credit"
                    )
                  }
                  disabled={
                    paypayReport.creditData.length === 0
                  }
                  style={{
                    width: "100%",
                    backgroundColor:
                      paypayReport.creditData
                        .length === 0
                        ? "#ccc"
                        : downloadedPayPayFiles[
                            "credit"
                          ]
                        ? "#2e7d32"
                        : "#0066cc",
                    color: "#ffffff",
                    border: "none",
                    padding: "12px",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor:
                      paypayReport.creditData
                        .length > 0
                        ? "pointer"
                        : "not-allowed",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      📥 クレジット保存 (
                      {
                        paypayReport
                          .creditData.length
                      }
                      件)
                    </span>

                    {downloadedPayPayFiles[
                      "credit"
                    ] && (
                      <span>
                        ✅ 保存済み
                      </span>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: "10px",
                      opacity: 0.85,
                      fontWeight: "normal",
                      display: "block",
                      marginTop: "2px",
                    }}
                  >
                    📄{" "}
                    {paypayReport.creditFilename}
                  </span>
                </button>

                <button
                  onClick={() =>
                    handlePaypayDownload(
                      paypayReport.paypayBalanceData,
                      paypayReport.balanceFilename,
                      "balance"
                    )
                  }
                  disabled={
                    paypayReport
                      .paypayBalanceData
                      .length === 0
                  }
                  style={{
                    width: "100%",
                    backgroundColor:
                      paypayReport
                        .paypayBalanceData
                        .length === 0
                        ? "#ccc"
                        : downloadedPayPayFiles[
                            "balance"
                          ]
                        ? "#2e7d32"
                        : "#ff0033",
                    color: "#ffffff",
                    border: "none",
                    padding: "12px",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor:
                      paypayReport
                        .paypayBalanceData
                        .length > 0
                        ? "pointer"
                        : "not-allowed",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      📥 残高払い保存 (
                      {
                        paypayReport
                          .paypayBalanceData
                          .length
                      }
                      件)
                    </span>

                    {downloadedPayPayFiles[
                      "balance"
                    ] && (
                      <span>
                        ✅ 保存済み
                      </span>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: "10px",
                      opacity: 0.85,
                      fontWeight: "normal",
                      display: "block",
                      marginTop: "2px",
                    }}
                  >
                    📄{" "}
                    {paypayReport.balanceFilename}
                  </span>
                </button>

                {paypayReport.hasOthers && (
                  <button
                    onClick={() =>
                      handlePaypayDownload(
                        paypayReport.othersData,
                        paypayReport.othersFilename,
                        "others"
                      )
                    }
                    style={{
                      width: "100%",
                      backgroundColor:
                        downloadedPayPayFiles[
                          "others"
                        ]
                          ? "#2e7d32"
                          : "#e65100",
                      color: "#ffffff",
                      border: "none",
                      padding: "12px",
                      borderRadius: "8px",
                      fontWeight: "bold",
                      fontSize: "13px",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent:
                          "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>
                        ⚠️ 未分類（その他）保存 (
                        {
                          paypayReport
                            .othersData.length
                        }
                        件)
                      </span>

                      {downloadedPayPayFiles[
                        "others"
                      ] && (
                        <span>
                          ✅ 保存済み
                        </span>
                      )}
                    </div>

                    <span
                      style={{
                        fontSize: "10px",
                        opacity: 0.85,
                        fontWeight: "normal",
                        display: "block",
                        marginTop: "2px",
                      }}
                    >
                      📄{" "}
                      {paypayReport.othersFilename}
                    </span>
                  </button>
                )}
              </div>

              {/* --------------------------------------------------
                  プレビュー
              -------------------------------------------------- */}

              <div
                style={{
                  marginTop: "20px",
                  borderTop:
                    "1px solid #eee",
                  paddingTop: "16px",
                }}
              >
                <h3
                  style={{
                    fontSize: "14px",
                    marginTop: 0,
                    marginBottom: "10px",
                  }}
                >
                  ▼ 生成ファイル別 プレビュー
                </h3>

                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    marginBottom: "10px",
                    backgroundColor: "#f0f0f0",
                    padding: "3px",
                    borderRadius: "8px",
                  }}
                >
                  {(
                    [
                      [
                        "credit",
                        "クレジット",
                        paypayReport.creditData
                          .length,
                      ],
                      [
                        "balance",
                        "残高払い",
                        paypayReport
                          .paypayBalanceData
                          .length,
                      ],
                      [
                        "others",
                        "未分類",
                        paypayReport
                          .othersData.length,
                      ],
                    ] as const
                  ).map(
                    ([key, label, count]) => (
                      <button
                        key={key}
                        onClick={() =>
                          setPreviewTab(key)
                        }
                        style={{
                          flex: 1,
                          padding: "8px 2px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          backgroundColor:
                            previewTab === key
                              ? "#ffffff"
                              : "transparent",
                          color:
                            previewTab === key
                              ? "#333333"
                              : "#666666",
                        }}
                      >
                        {label} ({count})
                      </button>
                    )
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "300px",
                    overflowY: "auto",
                    border:
                      "1px solid #eee",
                    padding: "8px",
                    borderRadius: "8px",
                  }}
                >
                  {getActivePreviewData()
                    .length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "20px",
                        color: "#999999",
                        fontSize: "12px",
                      }}
                    >
                      該当するデータはありません
                    </div>
                  ) : (
                    getActivePreviewData().map(
                      (row, idx) => (
                        <div
                          key={idx}
                          style={{
                            border:
                              "1px solid #e0e0e0",
                            borderRadius: "8px",
                            padding: "10px",
                            backgroundColor:
                              "#fafafa",
                            fontSize: "12px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent:
                                "space-between",
                              marginBottom:
                                "4px",
                            }}
                          >
                            <span
                              style={{
                                color:
                                  "#666666",
                                fontSize:
                                  "11px",
                              }}
                            >
                              #{idx + 1} |{" "}
                              {row[
                                "取引日時"
                              ] ||
                                row[
                                  "取引日"
                                ] ||
                                "日付なし"}
                            </span>

                            <span
                              style={{
                                fontWeight:
                                  "bold",
                                color:
                                  "#d32f2f",
                                fontSize:
                                  "13px",
                              }}
                            >
                              ￥
                              {row[
                                "金額（円）"
                              ] ||
                                row[
                                  "出金金額（円）"
                                ] ||
                                "0"}
                            </span>
                          </div>

                          <div
                            style={{
                              fontWeight:
                                "bold",
                              wordBreak:
                                "break-all",
                            }}
                          >
                            {row[
                              "店名・施設名"
                            ] ||
                              row[
                                "取引先"
                              ] ||
                              "取引先不明"}
                          </div>

                          <div
                            style={{
                              fontSize:
                                "11px",
                              color:
                                "#666666",
                              marginTop:
                                "2px",
                            }}
                          >
                            【取引方法】
                            {trimValue(
                              row[
                                "取引方法"
                              ]
                            ) ||
                              "（空欄）"}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
