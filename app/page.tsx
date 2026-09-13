"use client";

import React, { useState } from "react";
import Papa from "papaparse";
import Encoding from "encoding-japanese";

// ======================================================================
// 1. 型定義 (Types)
// ======================================================================
type ActiveTab = "rakuten" | "paypay";
type PayPayPreviewTab = "credit" | "balance" | "others";

interface RakutenLogState {
  totalInputRows: number;
  convertedRows: number;
  excludedRows: number;
  outputFilename: string;
  isMatch: boolean;
  convertedData: Record<string, string>[];
}

interface PayPayReportState {
  totalRows: number;
  excludedPoints: number;
  creditData: Record<string, string>[];
  paypayBalanceData: Record<string, string>[];
  othersData: Record<string, string>[];
  isCountOk: boolean;
  hasOthers: boolean;
  targetMonth: number | null;
  creditFilename: string;
  balanceFilename: string;
  othersFilename: string;
}

// ======================================================================
// 2. 定数・共通ロジック (Utils & Constants)
// ======================================================================
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

function detectTargetMonth(fileName: string, rows: Record<string, string>[], dateKeys: string[]): number | null {
  const fileNameMatch = fileName.match(/(\d{1,2})月/) || fileName.match(/\d{4}(\d{2})/);
  if (fileNameMatch) {
    return parseInt(fileNameMatch[1], 10);
  }

  for (const row of rows) {
    for (const key of dateKeys) {
      const rawDate = row[key]?.trim();
      if (rawDate) {
        const dateObj = new Date(rawDate.replace(/\//g, "-"));
        if (!isNaN(dateObj.getTime())) {
          return dateObj.getMonth() + 1;
        }
      }
    }
  }

  return null;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) return resolve("");
        const uint8Array = new Uint8Array(buffer);
        const detectedEncoding = Encoding.detect(uint8Array);
        const unicodeString = Encoding.convert(uint8Array, {
          to: "UNICODE",
          from: detectedEncoding || "AUTO",
          type: "string",
        });
        resolve(unicodeString);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

function downloadCsv(data: Record<string, string>[], filename: string, columns?: string[]) {
  if (!data || data.length === 0) return;
  const csvString = Papa.unparse(data, {
    columns: columns,
    newline: "\r\n",
  });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const blob = new Blob([bom, csvString], { type: "text/csv;charset=utf-8;" });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ======================================================================
// 3. UI コンポーネント (Sub-Components)
// ======================================================================

function FileUploader({
  id,
  accept,
  label,
  subLabel,
  processing,
  accentColor,
  onFileSelect,
}: {
  id: string;
  accept: string;
  label: string;
  subLabel: string;
  processing: boolean;
  accentColor: "blue" | "red";
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const isBlue = accentColor === "blue";
  return (
    <div
      className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center bg-white dark:bg-gray-900 shadow-sm transition-all mb-6 group ${
        isBlue
          ? "border-blue-300 hover:border-blue-500 dark:border-blue-800 dark:hover:border-blue-600"
          : "border-red-300 hover:border-red-500 dark:border-red-800 dark:hover:border-red-600"
      }`}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={onFileSelect}
        disabled={processing}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
      />
      <div className="flex flex-col items-center justify-center pointer-events-none">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-transform group-hover:scale-110 ${
          isBlue ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400" : "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400"
        }`}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <span className="font-bold text-sm sm:text-base text-gray-800 dark:text-gray-200 mb-1">
          {label}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {subLabel}
        </span>
        <span className={`inline-block px-4 py-2 rounded-lg font-bold text-xs text-white shadow-sm transition-colors ${
          isBlue ? "bg-blue-600 group-hover:bg-blue-700" : "bg-red-600 group-hover:bg-red-700"
        } ${processing ? "opacity-50" : ""}`}>
          ファイルを選択する
        </span>
      </div>
      {processing && (
        <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center z-20">
          <div className={`w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-2 ${isBlue ? "border-blue-600" : "border-red-600"}`}></div>
          <p className={`font-bold text-sm ${isBlue ? "text-blue-600" : "text-red-600"}`}>
            データを解析中...
          </p>
        </div>
      )}
    </div>
  );
}

function TransactionCard({
  index,
  date,
  amount,
  title,
  subInfo,
}: {
  index: number;
  date: string;
  amount: string;
  title: string;
  subInfo?: string;
}) {
  return (
    <div className="border border-gray-100 dark:border-gray-800/80 rounded-xl p-3.5 bg-white dark:bg-gray-900/60 shadow-xs hover:shadow-sm transition-all">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-gray-400 dark:text-gray-500 text-[10px] sm:text-xs font-mono">
          #{index}・{date}
        </span>
        <span className="font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm font-mono">
          ￥{amount}
        </span>
      </div>
      <div className="font-semibold text-gray-800 dark:text-gray-200 text-xs sm:text-sm break-all">
        {title}
      </div>
      {subInfo && (
        <div className="inline-block bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] px-2 py-0.5 rounded-md mt-2">
          {subInfo}
        </div>
      )}
    </div>
  );
}

// ======================================================================
// 4. メインコンポーネント (Main App)
// ======================================================================
export default function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("rakuten");

  const [rakutenLogs, setRakutenLogs] = useState<RakutenLogState | null>(null);
  const [rakutenError, setRakutenError] = useState<string>("");
  const [rakutenProcessing, setRakutenProcessing] = useState<boolean>(false);
  const [rakutenDownloaded, setRakutenDownloaded] = useState<boolean>(false);

  const [paypayReport, setPaypayReport] = useState<PayPayReportState | null>(null);
  const [paypayError, setPaypayError] = useState<string>("");
  const [paypayProcessing, setPaypayProcessing] = useState<boolean>(false);
  const [previewTab, setPreviewTab] = useState<PayPayPreviewTab>("credit");
  const [downloadedPayPayFiles, setDownloadedPayPayFiles] = useState<Record<string, boolean>>({});

  const handleRakutenUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRakutenProcessing(true);
    setRakutenError("");
    setRakutenLogs(null);
    setRakutenDownloaded(false);

    try {
      const csvText = await readFileAsText(file);
      Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processRakutenCsv(results.data, file.name);
        },
        error: (err: Error) => {
          setRakutenError(`CSVパースエラー: ${err.message}`);
          setRakutenProcessing(false);
        },
      });
    } catch (err) {
      setRakutenError("ファイルの読み込み中にエラーが発生しました。");
      setRakutenProcessing(false);
    }
  };

  const processRakutenCsv = (rawData: Record<string, string>[], fileName: string) => {
    const totalInputRows = rawData.length;
    if (totalInputRows === 0) {
      setRakutenError("CSVファイルが空です。");
      setRakutenProcessing(false);
      return;
    }

    const firstRowKeys = Object.keys(rawData[0] || {});
    const requiredColumns = ["利用日", "利用店名・商品名", "支払総額"];
    const missingColumns = requiredColumns.filter((c) => !firstRowKeys.includes(c));

    if (missingColumns.length > 0) {
      setRakutenError(`必要なカラムが含まれていません: ${missingColumns.join(", ")}`);
      setRakutenProcessing(false);
      return;
    }

    const validRows = rawData.filter((row) => {
      const dateStr = row["利用日"]?.trim();
      return dateStr && !isNaN(Date.parse(dateStr.replace(/\//g, "-")));
    });

    const excludedRows = totalInputRows - validRows.length;
    const convertedRows = validRows.length;
    const convertedData: Record<string, string>[] = [];

    const targetMonth = detectTargetMonth(fileName, validRows, ["利用日"]);

    validRows.forEach((row, index) => {
      const rawDateStr = row["利用日"]?.trim();
      const dateObj = new Date(rawDateStr.replace(/\//g, "-"));

      const secOffset = index + 1;
      const hh = String(Math.floor(secOffset / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor((secOffset % 3600) / 60)).padStart(2, "0");
      const ss = String(secOffset % 60).padStart(2, "0");

      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      const dateFormatted = `${year}/${month}/${day} ${hh}:${mm}:${ss}`;

      const rawAmountStr = (row["支払総額"] || "0").replace(/,/g, "");
      const rawAmount = parseFloat(rawAmountStr) || 0;
      const amountHalfRound = Math.round(rawAmount / 2);
      const amountFormatted =
        Math.abs(amountHalfRound) >= 1000
          ? amountHalfRound.toLocaleString("ja-JP")
          : String(amountHalfRound);

      const ymdStr = `${year}${month}${day}`;
      const sequenceStr = String(index + 1).padStart(8, "0");
      const transactionId = `9000${ymdStr}${sequenceStr}`;

      convertedData.push({
        取引日: dateFormatted,
        "出金金額（円）": amountFormatted,
        "入金金額（円）": "-",
        海外出金金額: "-",
        通貨: "-",
        "変換レート（円）": "-",
        利用国: "-",
        取引内容: "支払い",
        取引先: (row["利用店名・商品名"] || "").trim(),
        取引方法: "楽天カード",
        支払い区分: "-",
        利用者: "-",
        取引番号: transactionId,
      });
    });

    const outputFilename = targetMonth
      ? `楽天カード${targetMonth}月分_MoneyForward取込用.csv`
      : "楽天カード_MoneyForward取込用.csv";

    setRakutenLogs({
      totalInputRows,
      convertedRows,
      excludedRows,
      outputFilename,
      isMatch: totalInputRows === convertedRows + excludedRows,
      convertedData,
    });
    setRakutenProcessing(false);
  };

  const handleRakutenDownload = () => {
    if (!rakutenLogs) return;
    downloadCsv(rakutenLogs.convertedData, rakutenLogs.outputFilename, RAKUTEN_OUTPUT_HEADERS);
    setRakutenDownloaded(true);
  };

  const handlePaypayUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPaypayProcessing(true);
    setPaypayError("");
    setPaypayReport(null);
    setDownloadedPayPayFiles({});

    try {
      const csvText = await readFileAsText(file);
      Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processPayPayData(results.data, file.name);
        },
        error: (err: Error) => {
          setPaypayError(`CSVパースエラー: ${err.message}`);
          setPaypayProcessing(false);
        },
      });
    } catch (err) {
      setPaypayError("ファイルの読み込み中にエラーが発生しました。");
      setPaypayProcessing(false);
    }
  };

  const processPayPayData = (df: Record<string, string>[], fileName: string) => {
    const totalRows = df.length;
    if (totalRows === 0) {
      setPaypayError("CSVファイルが空です。");
      setPaypayProcessing(false);
      return;
    }

    const firstRowKeys = Object.keys(df[0] || {});
    if (!firstRowKeys.includes("取引方法")) {
      setPaypayError("必要なカラム「取引方法」が含まれていません。");
      setPaypayProcessing(false);
      return;
    }

    const targetMonth = detectTargetMonth(fileName, df, ["取引日時", "取引日"]);
    const monthPrefix = targetMonth ? `${targetMonth}月分_` : "";

    const dfFiltered = df.filter((row) => (row["取引方法"] || "").trim() !== "PayPayポイント");
    const excludedPoints = totalRows - dfFiltered.length;

    const creditTargets = ["クレジット VISA 6099", "PayPayカード VISA 6099"];
    const dfCredit = dfFiltered.filter((row) =>
      creditTargets.includes((row["取引方法"] || "").trim())
    );

    const dfPaypayBalance = dfFiltered.filter(
      (row) => (row["取引方法"] || "").trim() === "PayPay残高"
    );

    const dfOthers = dfFiltered.filter((row) => {
      const method = (row["取引方法"] || "").trim();
      return !creditTargets.includes(method) && method !== "PayPay残高";
    });

    const processedSum = excludedPoints + dfCredit.length + dfPaypayBalance.length + dfOthers.length;
    const isCountOk = totalRows === processedSum;
    const hasOthers = dfOthers.length > 0;

    setPaypayReport({
      totalRows,
      excludedPoints,
      creditData: dfCredit,
      paypayBalanceData: dfPaypayBalance,
      othersData: dfOthers,
      isCountOk,
      hasOthers,
      targetMonth,
      creditFilename: `PayPayクレジット_${monthPrefix}VISA6099.csv`,
      balanceFilename: `PayPay残高払い_${monthPrefix}抽出.csv`,
      othersFilename: `PayPay未分類_${monthPrefix}要確認.csv`,
    });

    if (dfCredit.length > 0) {
      setPreviewTab("credit");
    } else if (dfPaypayBalance.length > 0) {
      setPreviewTab("balance");
    } else {
      setPreviewTab("others");
    }

    setPaypayProcessing(false);
  };

  const handlePaypayDownload = (data: Record<string, string>[], filename: string, key: string) => {
    downloadCsv(data, filename);
    setDownloadedPayPayFiles((prev) => ({ ...prev, [key]: true }));
  };

  const getActivePreviewData = () => {
    if (!paypayReport) return [];
    if (previewTab === "credit") return paypayReport.creditData;
    if (previewTab === "balance") return paypayReport.paypayBalanceData;
    return paypayReport.othersData;
  };

  return (
    <main className="w-full max-w-2xl mx-auto min-h-screen px-4 py-8 font-sans bg-gray-50/50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      
      {/* タブ切り替え */}
      <div className="flex gap-2 p-1.5 bg-gray-200/70 dark:bg-gray-900 rounded-2xl mb-8 shadow-inner">
        <button
          onClick={() => setActiveTab("rakuten")}
          className={`flex-1 py-3 px-3 text-xs sm:text-sm font-bold rounded-xl border-none cursor-pointer transition-all flex items-center justify-center gap-2 ${
            activeTab === "rakuten"
              ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm"
              : "bg-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
          }`}
        >
          <span>💳</span> <span>楽天カード変換</span>
        </button>
        <button
          onClick={() => setActiveTab("paypay")}
          className={`flex-1 py-3 px-3 text-xs sm:text-sm font-bold rounded-xl border-none cursor-pointer transition-all flex items-center justify-center gap-2 ${
            activeTab === "paypay"
              ? "bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 shadow-sm"
              : "bg-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
          }`}
        >
          <span>📱</span> <span>PayPay仕分け</span>
        </button>
      </div>

      {activeTab === "rakuten" && (
        <div className="animate-fade-in">
          <header className="mb-6">
            <h1 className="text-lg sm:text-xl font-extrabold m-0 flex items-center gap-2">
              <span>💳</span> 楽天カード明細 変換
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              マネーフォワード取込用のフォーマットに一括変換します
            </p>
          </header>

          <FileUploader
            id="rakuten-file"
            accept=".csv"
            label="楽天カードのCSVファイルをアップロード"
            subLabel="ここにファイルをドラッグ＆ドロップ、またはクリックして選択"
            processing={rakutenProcessing}
            accentColor="blue"
            onFileSelect={handleRakutenUpload}
          />

          {rakutenError && (
            <div className="bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 p-4 rounded-xl mb-6 text-xs sm:text-sm border border-red-200 dark:border-red-900 flex items-center gap-2">
              <span>❌</span> <span>{rakutenError}</span>
            </div>
          )}

          {rakutenLogs && (
            <div className="border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 sm:p-6 bg-white dark:bg-gray-900 shadow-sm">
              <h2 className="text-sm sm:text-base font-bold mt-0 mb-4 border-b border-gray-100 dark:border-gray-800 pb-3 flex items-center gap-2">
                <span>📊</span> 処理完了レポート
              </h2>
              
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl text-center border border-gray-100 dark:border-gray-800">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">入力件数</div>
                  <div className="font-extrabold text-base sm:text-lg font-mono">{rakutenLogs.totalInputRows}件</div>
                </div>
                <div className="bg-emerald-50/60 dark:bg-emerald-950/30 p-3 rounded-xl text-center border border-emerald-100 dark:border-emerald-900/40">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mb-1">変換成功</div>
                  <div className="font-extrabold text-base sm:text-lg text-emerald-700 dark:text-emerald-400 font-mono">
                    {rakutenLogs.convertedRows}件
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl mb-4 border border-gray-100 dark:border-gray-800 text-xs flex flex-col gap-1">
                <span className="text-gray-500 dark:text-gray-400">📄 保存ファイル名:</span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-200 break-all">{rakutenLogs.outputFilename}</span>
              </div>

              {rakutenLogs.excludedRows > 0 && (
                <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl mb-4 border border-amber-200 dark:border-amber-900 flex items-center gap-2">
                  <span>ℹ️</span>
                  <span>ETC乗降区間など利用日のない {rakutenLogs.excludedRows} 件を自動除外しました</span>
                </div>
              )}

              <button
                onClick={handleRakutenDownload}
                className={`w-full text-white border-none p-4 rounded-xl font-bold text-sm cursor-pointer mb-6 shadow-md transition-all flex items-center justify-center gap-2 ${
                  rakutenDownloaded
                    ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/20"
                }`}
              >
                <span>{rakutenDownloaded ? "✅" : "📥"}</span>
                <span>{rakutenDownloaded ? "保存済み (再ダウンロード)" : "変換後CSVを保存する"}</span>
              </button>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                <h3 className="text-xs sm:text-sm font-bold mb-3 flex items-center justify-between">
                  <span>▼ プレビュー</span>
                  <span className="text-xs font-normal text-gray-400">全 {rakutenLogs.convertedData.length} 件</span>
                </h3>
                <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
                  {rakutenLogs.convertedData.map((row, idx) => (
                    <TransactionCard
                      key={idx}
                      index={idx + 1}
                      date={row["取引日"]}
                      amount={row["出金金額（円）"]}
                      title={row["取引先"]}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "paypay" && (
        <div className="animate-fade-in">
          <header className="mb-6">
            <h1 className="text-lg sm:text-xl font-extrabold m-0 flex items-center gap-2">
              <span>📱</span> PayPay明細 自動仕分け
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              PayPayの明細をクレジット・残高払いなどに自動で振り分けます
            </p>
          </header>

          <FileUploader
            id="paypay-file"
            accept=".csv"
            label="PayPayのCSVファイルをアップロード"
            subLabel="ここにファイルをドラッグ＆ドロップ、またはクリックして選択"
            processing={paypayProcessing}
            accentColor="red"
            onFileSelect={handlePaypayUpload}
          />

          {paypayError && (
            <div className="bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 p-4 rounded-xl mb-6 text-xs sm:text-sm border border-red-200 dark:border-red-900 flex items-center gap-2">
              <span>❌</span> <span>{paypayError}</span>
            </div>
          )}

          {paypayReport && (
            <div className="border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 sm:p-6 bg-white dark:bg-gray-900 shadow-sm">
              <h2 className="text-sm sm:text-base font-bold mt-0 mb-4 border-b border-gray-100 dark:border-gray-800 pb-3 flex items-center gap-2">
                <span>📊</span> 処理結果サマリー
              </h2>
              
              <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-4 mb-4 border border-gray-100 dark:border-gray-800">
                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                  📥 入力データ総数: <span className="font-mono text-sm">{paypayReport.totalRows} 件</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400 pt-2 border-t border-gray-200/60 dark:border-gray-700/60">
                  <div>1️⃣ 除外(ポイント): <span className="font-mono font-semibold">{paypayReport.excludedPoints}件</span></div>
                  <div>2️⃣ クレジット: <span className="font-mono font-semibold">{paypayReport.creditData.length}件</span></div>
                  <div>3️⃣ 残高払い: <span className="font-mono font-semibold">{paypayReport.paypayBalanceData.length}件</span></div>
                  <div>4️⃣ 未分類(その他): <span className="font-mono font-semibold">{paypayReport.othersData.length}件</span></div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 mb-5 border border-gray-100 dark:border-gray-800 flex flex-col gap-1.5">
                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">【診断結果】</div>
                <div className={`text-xs flex items-center gap-1.5 ${paypayReport.isCountOk ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  <span>{paypayReport.isCountOk ? "✅" : "❌"}</span>
                  <span>{paypayReport.isCountOk ? "データの漏れはありません（件数一致）" : "警告：件数が一致しません"}</span>
                </div>
                <div className={`text-xs flex items-center gap-1.5 ${!paypayReport.hasOthers ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  <span>{!paypayReport.hasOthers ? "✅" : "⚠️"}</span>
                  <span>{!paypayReport.hasOthers ? "全てのデータが正しく分類されました" : `注意：未分類のデータが ${paypayReport.othersData.length} 件あります`}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 mb-6">
                <button
                  onClick={() => handlePaypayDownload(paypayReport.creditData, paypayReport.creditFilename, "credit")}
                  disabled={paypayReport.creditData.length === 0}
                  className={`w-full text-white border-none p-3.5 rounded-xl font-bold text-xs sm:text-sm cursor-pointer text-left transition-all shadow-sm ${
                    paypayReport.creditData.length === 0
                      ? "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed shadow-none"
                      : downloadedPayPayFiles["credit"]
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="flex items-center gap-1.5">
                      <span>📥</span> クレジット保存 ({paypayReport.creditData.length}件)
                    </span>
                    {downloadedPayPayFiles["credit"] && (
                      <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-md font-bold">
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] opacity-80 font-normal font-mono block">📄 {paypayReport.creditFilename}</span>
                </button>

                <button
                  onClick={() => handlePaypayDownload(paypayReport.paypayBalanceData, paypayReport.balanceFilename, "balance")}
                  disabled={paypayReport.paypayBalanceData.length === 0}
                  className={`w-full text-white border-none p-3.5 rounded-xl font-bold text-xs sm:text-sm cursor-pointer text-left transition-all shadow-sm ${
                    paypayReport.paypayBalanceData.length === 0
                      ? "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed shadow-none"
                      : downloadedPayPayFiles["balance"]
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="flex items-center gap-1.5">
                      <span>📥</span> 残高払い保存 ({paypayReport.paypayBalanceData.length}件)
                    </span>
                    {downloadedPayPayFiles["balance"] && (
                      <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-md font-bold">
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] opacity-80 font-normal font-mono block">📄 {paypayReport.balanceFilename}</span>
                </button>

                {paypayReport.hasOthers && (
                  <button
                    onClick={() => handlePaypayDownload(paypayReport.othersData, paypayReport.othersFilename, "others")}
                    className={`w-full text-white border-none p-3.5 rounded-xl font-bold text-xs sm:text-sm cursor-pointer text-left transition-all shadow-sm ${
                      downloadedPayPayFiles["others"]
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-amber-600 hover:bg-amber-700"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="flex items-center gap-1.5">
                        <span>⚠️</span> 未分類(その他)保存 ({paypayReport.othersData.length}件)
                      </span>
                      {downloadedPayPayFiles["others"] && (
                        <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-md font-bold">
                          ✅ 保存済み
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] opacity-80 font-normal font-mono block">📄 {paypayReport.othersFilename}</span>
                  </button>
                )}
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
                <h3 className="text-xs sm:text-sm font-bold mb-3">
                  ▼ 生成ファイル別 プレビュー
                </h3>

                <div className="flex gap-1.5 mb-3 bg-gray-100 dark:bg-gray-800/80 p-1 rounded-xl">
                  <button
                    onClick={() => setPreviewTab("credit")}
                    className={`flex-1 py-2 px-1 text-[11px] font-bold border-none rounded-lg cursor-pointer transition-all ${
                      previewTab === "credit"
                        ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    クレジット ({paypayReport.creditData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("balance")}
                    className={`flex-1 py-2 px-1 text-[11px] font-bold border-none rounded-lg cursor-pointer transition-all ${
                      previewTab === "balance"
                        ? "bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 shadow-xs"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    残高払い ({paypayReport.paypayBalanceData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("others")}
                    className={`flex-1 py-2 px-1 text-[11px] font-bold border-none rounded-lg cursor-pointer transition-all ${
                      previewTab === "others"
                        ? "bg-white dark:bg-gray-900 text-amber-600 dark:text-amber-400 shadow-xs"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    未分類 ({paypayReport.othersData.length})
                  </button>
                </div>

                <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto pr-1">
                  {getActivePreviewData().length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-xs bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
                      該当するデータはありません
                    </div>
                  ) : (
                    getActivePreviewData().map((row, idx) => (
                      <TransactionCard
                        key={idx}
                        index={idx + 1}
                        date={row["取引日時"] || row["取引日"] || "日付なし"}
                        amount={row["金額（円）"] || row["出金金額（円）"] || "0"}
                        title={row["店名・施設名"] || row["取引先"] || "取引先不明"}
                        subInfo={`【取引方法】${row["取引方法"] || "-"}`}
                      />
                    ))
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
