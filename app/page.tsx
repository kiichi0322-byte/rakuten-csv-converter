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
      className={`border-2 border-dashed rounded-xl p-5 text-center bg-white dark:bg-gray-900 shadow-sm transition-colors mb-5 ${
        isBlue
          ? "border-blue-500 hover:border-blue-600 dark:border-blue-600"
          : "border-red-500 hover:border-red-600 dark:border-red-600"
      }`}
    >
      <label
        htmlFor={id}
        className={`inline-block text-white px-5 py-3 rounded-lg font-bold text-sm cursor-pointer w-full max-w-xs transition-opacity ${
          isBlue ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"
        } ${processing ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={onFileSelect}
        disabled={processing}
        className="hidden"
      />
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 mb-0">{subLabel}</p>
      {processing && (
        <p className={`mt-2 font-bold text-sm ${isBlue ? "text-blue-600" : "text-red-600"}`}>
          ⏳ 処理中...
        </p>
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
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-2.5 sm:p-3 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm transition-colors">
      <div className="flex justify-between items-center mb-1">
        <span className="text-gray-500 dark:text-gray-400 text-[11px] sm:text-xs">
          #{index} | {date}
        </span>
        <span className="font-bold text-red-600 dark:text-red-400 text-xs sm:text-sm">
          ￥{amount}
        </span>
      </div>
      <div className="font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm break-all">
        {title}
      </div>
      {subInfo && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
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
    <main className="w-full max-w-full min-h-screen m-0 p-4 font-sans bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      <div className="flex gap-2 mb-5 bg-gray-200 dark:bg-gray-800 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab("rakuten")}
          className={`flex-1 py-2.5 px-1 text-xs sm:text-sm font-bold rounded-lg border-none cursor-pointer transition-all ${
            activeTab === "rakuten"
              ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm"
              : "bg-transparent text-gray-600 dark:text-gray-400"
          }`}
        >
          💳 楽天カード変換
        </button>
        <button
          onClick={() => setActiveTab("paypay")}
          className={`flex-1 py-2.5 px-1 text-xs sm:text-sm font-bold rounded-lg border-none cursor-pointer transition-all ${
            activeTab === "paypay"
              ? "bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 shadow-sm"
              : "bg-transparent text-gray-600 dark:text-gray-400"
          }`}
        >
          📱 PayPay仕分け
        </button>
      </div>

      {activeTab === "rakuten" && (
        <div>
          <header className="text-center mb-4">
            <h1 className="text-base sm:text-lg font-bold m-0">💳 楽天カード明細 変換</h1>
          </header>

          <FileUploader
            id="rakuten-file"
            accept=".csv"
            label="📁 CSVファイルを選択"
            subLabel="タップして楽天カード明細CSVを選択してください"
            processing={rakutenProcessing}
            accentColor="blue"
            onFileSelect={handleRakutenUpload}
          />

          {rakutenError && (
            <div className="bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 p-3 rounded-lg mb-5 text-xs sm:text-sm border border-red-200 dark:border-red-900">
              ❌ {rakutenError}
            </div>
          )}

          {rakutenLogs && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 shadow-sm">
              <h2 className="text-sm sm:text-base font-bold mt-0 mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                📊 処理完了レポート
              </h2>
              
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-gray-100 dark:bg-gray-800/80 p-2 rounded-lg text-center">
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">入力件数</div>
                  <div className="font-bold text-sm sm:text-base">{rakutenLogs.totalInputRows}件</div>
                </div>
                <div className="flex-1 bg-green-50 dark:bg-green-950/40 p-2 rounded-lg text-center">
                  <div className="text-[10px] text-green-700 dark:text-green-400">変換成功</div>
                  <div className="font-bold text-sm sm:text-base text-green-700 dark:text-green-400">
                    {rakutenLogs.convertedRows}件
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-700 dark:text-gray-300 my-1.5 break-all">
                📄 <strong>保存名:</strong><br />{rakutenLogs.outputFilename}
              </p>

              {rakutenLogs.excludedRows > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg my-2 border border-amber-200 dark:border-amber-900">
                  ℹ️ ETC乗降区間など利用日なし {rakutenLogs.excludedRows} 件を自動除外しました
                </p>
              )}

              <button
                onClick={handleRakutenDownload}
                className={`w-full text-white border-none p-3.5 rounded-lg font-bold text-sm cursor-pointer my-4 shadow-md transition-colors flex items-center justify-center gap-2 ${
                  rakutenDownloaded
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-green-700 hover:bg-green-800"
                }`}
              >
                {rakutenDownloaded ? "✅ 保存済み (再ダウンロード)" : "📥 変換後CSVを保存する"}
              </button>

              <h3 className="text-xs sm:text-sm font-bold mt-4 mb-2">
                ▼ プレビュー (全 {rakutenLogs.convertedData.length} 件)
              </h3>
              <div className="flex flex-col gap-2 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto border border-gray-100 dark:border-gray-800 p-2 rounded-lg bg-gray-50/50 dark:bg-gray-950/50">
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
          )}
        </div>
      )}

      {activeTab === "paypay" && (
        <div>
          <header className="text-center mb-4">
            <h1 className="text-base sm:text-lg font-bold m-0">📱 PayPay明細 自動仕分け</h1>
          </header>

          <FileUploader
            id="paypay-file"
            accept=".csv"
            label="📁 CSVファイルを選択"
            subLabel="タップしてPayPay明細CSVを選択してください"
            processing={paypayProcessing}
            accentColor="red"
            onFileSelect={handlePaypayUpload}
          />

          {paypayError && (
            <div className="bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 p-3 rounded-lg mb-5 text-xs sm:text-sm border border-red-200 dark:border-red-900">
              ❌ {paypayError}
            </div>
          )}

          {paypayReport && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 shadow-sm">
              <h2 className="text-sm sm:text-base font-bold mt-0 mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                📊 処理結果サマリー
              </h2>
              
              <div className="text-xs sm:text-sm leading-relaxed mb-4">
                <div>📥 <strong>入力データ総数:</strong> {paypayReport.totalRows} 件</div>
                <div className="pl-2 border-l-2 border-gray-300 dark:border-gray-700 my-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                  <div>1️⃣ 除外 (ポイント) : {paypayReport.excludedPoints} 件</div>
                  <div>2️⃣ クレジット抽出 : {paypayReport.creditData.length} 件</div>
                  <div>3️⃣ 残高払い抽出 : {paypayReport.paypayBalanceData.length} 件</div>
                  <div>4️⃣ 未分類 (その他) : {paypayReport.othersData.length} 件</div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 mb-4">
                <div className="font-bold text-xs mb-1">【診断結果】</div>
                <div className={`text-xs my-0.5 ${paypayReport.isCountOk ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {paypayReport.isCountOk
                    ? "✅ データの漏れはありません（件数一致）"
                    : "❌ 警告：件数が一致しません"}
                </div>
                <div className={`text-xs my-0.5 ${!paypayReport.hasOthers ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {!paypayReport.hasOthers
                    ? "✅ 全てのデータが正しく分類されました"
                    : `⚠️ 注意：未分類のデータが ${paypayReport.othersData.length} 件あります`}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 mb-5">
                <button
                  onClick={() => handlePaypayDownload(paypayReport.creditData, paypayReport.creditFilename, "credit")}
                  disabled={paypayReport.creditData.length === 0}
                  className={`w-full text-white border-none p-3 rounded-lg font-bold text-xs sm:text-sm cursor-pointer text-left transition-colors ${
                    paypayReport.creditData.length === 0
                      ? "bg-gray-300 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
                      : downloadedPayPayFiles["credit"]
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span>📥 クレジット保存 ({paypayReport.creditData.length}件)</span>
                    {downloadedPayPayFiles["credit"] && (
                      <span className="bg-white text-emerald-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] opacity-85 font-normal block mt-0.5">📄 {paypayReport.creditFilename}</span>
                </button>

                <button
                  onClick={() => handlePaypayDownload(paypayReport.paypayBalanceData, paypayReport.balanceFilename, "balance")}
                  disabled={paypayReport.paypayBalanceData.length === 0}
                  className={`w-full text-white border-none p-3 rounded-lg font-bold text-xs sm:text-sm cursor-pointer text-left transition-colors ${
                    paypayReport.paypayBalanceData.length === 0
                      ? "bg-gray-300 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
                      : downloadedPayPayFiles["balance"]
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span>📥 残高払い保存 ({paypayReport.paypayBalanceData.length}件)</span>
                    {downloadedPayPayFiles["balance"] && (
                      <span className="bg-white text-emerald-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] opacity-85 font-normal block mt-0.5">📄 {paypayReport.balanceFilename}</span>
                </button>

                {paypayReport.hasOthers && (
                  <button
                    onClick={() => handlePaypayDownload(paypayReport.othersData, paypayReport.othersFilename, "others")}
                    className={`w-full text-white border-none p-3 rounded-lg font-bold text-xs sm:text-sm cursor-pointer text-left transition-colors ${
                      downloadedPayPayFiles["others"]
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-amber-600 hover:bg-amber-700"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span>⚠️ 未分類(その他)保存 ({paypayReport.othersData.length}件)</span>
                      {downloadedPayPayFiles["others"] && (
                        <span className="bg-white text-emerald-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                          ✅ 保存済み
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] opacity-85 font-normal block mt-0.5">📄 {paypayReport.othersFilename}</span>
                  </button>
                )}
              </div>

              <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
                <h3 className="text-xs sm:text-sm font-bold mt-0 mb-2">
                  ▼ 生成ファイル別 プレビュー
                </h3>

                <div className="flex gap-1 mb-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                  <button
                    onClick={() => setPreviewTab("credit")}
                    className={`flex-1 py-1.5 px-1 text-[11px] font-bold border-none rounded-md cursor-pointer transition-all ${
                      previewTab === "credit"
                        ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    クレジット ({paypayReport.creditData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("balance")}
                    className={`flex-1 py-1.5 px-1 text-[11px] font-bold border-none rounded-md cursor-pointer transition-all ${
                      previewTab === "balance"
                        ? "bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 shadow-sm"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    残高払い ({paypayReport.paypayBalanceData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("others")}
                    className={`flex-1 py-1.5 px-1 text-[11px] font-bold border-none rounded-md cursor-pointer transition-all ${
                      previewTab === "others"
                        ? "bg-white dark:bg-gray-900 text-amber-600 dark:text-amber-400 shadow-sm"
                        : "bg-transparent text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    未分類 ({paypayReport.othersData.length})
                  </button>
                </div>

                <div className="flex flex-col gap-2 max-h-[45vh] sm:max-h-[55vh] overflow-y-auto border border-gray-100 dark:border-gray-800 p-2 rounded-lg bg-gray-50/50 dark:bg-gray-950/50">
                  {getActivePreviewData().length === 0 ? (
                    <div className="text-center py-5 text-gray-400 text-xs">
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
