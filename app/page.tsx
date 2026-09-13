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

// ----------------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------------
interface RakutenLogState {
  totalInputRows: number;
  convertedRows: number;
  excludedRows: number;
  outputFilename: string;
  isMatch: boolean;
  convertedData: Record<string, string>[];
  excludedData: Record<string, string>[];
}

interface PayPayReportState {
  totalRows: number;
  excludedPoints: number;
  excludedPointData: Record<string, string>[];
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

export default function MainApp() {
  const [activeTab, setActiveTab] = useState<"rakuten" | "paypay">("rakuten");

  // ----------------------------------------------------------------------
  // 楽天カード変換 State & Handlers
  // ----------------------------------------------------------------------
  const [rakutenLogs, setRakutenLogs] = useState<RakutenLogState | null>(null);
  const [rakutenError, setRakutenError] = useState<string>("");
  const [rakutenProcessing, setRakutenProcessing] = useState<boolean>(false);
  const [rakutenDownloaded, setRakutenDownloaded] = useState<boolean>(false);

  const handleRakutenUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRakutenProcessing(true);
    setRakutenError("");
    setRakutenLogs(null);
    setRakutenDownloaded(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) return;

        const uint8Array = new Uint8Array(buffer);
        const detectedEncoding = Encoding.detect(uint8Array);
        const unicodeString = Encoding.convert(uint8Array, {
          to: "UNICODE",
          from: detectedEncoding || "AUTO",
          type: "string",
        });

        Papa.parse<Record<string, string>>(unicodeString, {
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
    reader.readAsArrayBuffer(file);
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
    const excludedData = rawData.filter((row) => !validRows.includes(row));

    const excludedRows = totalInputRows - validRows.length;
    const convertedRows = validRows.length;
    const convertedData: Record<string, string>[] = [];
    let targetMonth: number | null = null;

    validRows.forEach((row, index) => {
      const rawDateStr = row["利用日"]?.trim();
      const dateObj = new Date(rawDateStr.replace(/\//g, "-"));

      if (targetMonth === null && !isNaN(dateObj.getTime())) {
        targetMonth = dateObj.getMonth() + 1;
      }

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

    const monthMatch = fileName.match(/(\d{1,2})月/) || fileName.match(/\d{4}(\d{2})/);
    if (monthMatch) {
      targetMonth = parseInt(monthMatch[1], 10);
    }

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
      excludedData,
    });
    setRakutenProcessing(false);
  };

  const handleRakutenDownload = () => {
    if (!rakutenLogs) return;
    const csvString = Papa.unparse(rakutenLogs.convertedData, {
      columns: RAKUTEN_OUTPUT_HEADERS,
      newline: "\r\n",
    });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvString], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", rakutenLogs.outputFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setRakutenDownloaded(true);
  };

  // ----------------------------------------------------------------------
  // PayPay仕分け State & Handlers
  // ----------------------------------------------------------------------
  const [paypayReport, setPaypayReport] = useState<PayPayReportState | null>(null);
  const [paypayError, setPaypayError] = useState<string>("");
  const [paypayProcessing, setPaypayProcessing] = useState<boolean>(false);
  const [previewTab, setPreviewTab] = useState<"credit" | "balance" | "others" | "excluded">("credit");
  const [downloadedPayPayFiles, setDownloadedPayPayFiles] = useState<Record<string, boolean>>({});

  const handlePaypayUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPaypayProcessing(true);
    setPaypayError("");
    setPaypayReport(null);
    setDownloadedPayPayFiles({});

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) return;

        const uint8Array = new Uint8Array(buffer);
        const detectedEncoding = Encoding.detect(uint8Array);
        const unicodeString = Encoding.convert(uint8Array, {
          to: "UNICODE",
          from: detectedEncoding || "AUTO",
          type: "string",
        });

        Papa.parse<Record<string, string>>(unicodeString, {
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
    reader.readAsArrayBuffer(file);
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

    let targetMonth: number | null = null;

    const fileNameMatch = fileName.match(/(\d{1,2})月/) || fileName.match(/\d{4}(\d{2})/);
    if (fileNameMatch) {
      targetMonth = parseInt(fileNameMatch[1], 10);
    }

    if (targetMonth === null) {
      for (const row of df) {
        const rawDate = row["取引日時"] || row["取引日"] || "";
        if (rawDate) {
          const dateObj = new Date(rawDate.replace(/\//g, "-"));
          if (!isNaN(dateObj.getTime())) {
            targetMonth = dateObj.getMonth() + 1;
            break;
          }
        }
      }
    }

    const monthPrefix = targetMonth ? `${targetMonth}月分_` : "";

    const excludedPointData = df.filter((row) => (row["取引方法"] || "").trim() === "PayPayポイント");
    const dfFiltered = df.filter((row) => (row["取引方法"] || "").trim() !== "PayPayポイント");
    const excludedPoints = excludedPointData.length;

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
      excludedPointData,
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
    if (!data || data.length === 0) return;
    const csvString = Papa.unparse(data, { newline: "\r\n" });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvString], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadedPayPayFiles((prev) => ({ ...prev, [key]: true }));
  };

  const getActivePreviewData = () => {
    if (!paypayReport) return [];
    if (previewTab === "credit") return paypayReport.creditData;
    if (previewTab === "balance") return paypayReport.paypayBalanceData;
    if (previewTab === "excluded") return paypayReport.excludedPointData;
    return paypayReport.othersData;
  };

  // ----------------------------------------------------------------------
  // レンダリング
  // ----------------------------------------------------------------------
  return (
    <main style={{ width: "100%", maxWidth: "100vw", boxSizing: "border-box", margin: "0 auto", padding: "16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1a1a1a", backgroundColor: "#f8f9fa", minHeight: "100vh", overflowX: "hidden" }}>
      
      {/* メニュータブ */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", backgroundColor: "#e9ecef", padding: "4px", borderRadius: "10px" }}>
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
            backgroundColor: activeTab === "rakuten" ? "#ffffff" : "transparent",
            color: activeTab === "rakuten" ? "#0066cc" : "#666666",
            boxShadow: activeTab === "rakuten" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            transition: "all 0.2s"
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
            backgroundColor: activeTab === "paypay" ? "#ffffff" : "transparent",
            color: activeTab === "paypay" ? "#ff0033" : "#666666",
            boxShadow: activeTab === "paypay" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            transition: "all 0.2s"
          }}
        >
          📱 PayPay仕分け
        </button>
      </div>

      {/* 💳 楽天カード画面 */}
      {activeTab === "rakuten" && (
        <div>
          <header style={{ textAlign: "center", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "18px", margin: 0, color: "#1a1a1a" }}>💳 楽天カード明細 変換</h1>
          </header>

          <div style={{
            border: "2px dashed #0066cc",
            borderRadius: "12px",
            padding: "20px 12px",
            textAlign: "center",
            backgroundColor: "#ffffff",
            marginBottom: "20px",
            boxSizing: "border-box",
            width: "100%",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}>
            <label htmlFor="rakuten-file" style={{
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
              boxSizing: "border-box"
            }}>
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
            <p style={{ fontSize: "11px", color: "#666666", marginTop: "10px", marginBottom: 0 }}>
              タップして楽天カード明細CSVを選択してください
            </p>
            {rakutenProcessing && <p style={{ marginTop: "10px", color: "#0066cc", fontWeight: "bold" }}>⏳ 処理中...</p>}
          </div>

          {rakutenError && (
            <div style={{ backgroundColor: "#ffebee", color: "#c62828", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "13px" }}>
              ❌ {rakutenError}
            </div>
          )}

          {rakutenLogs && (
            <div style={{ border: "1px solid #e0e0e0", borderRadius: "12px", padding: "16px", backgroundColor: "#ffffff", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
              <h2 style={{ fontSize: "15px", marginTop: 0, marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "8px", color: "#1a1a1a" }}>📊 処理完了レポート</h2>
              
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <div style={{ flex: 1, backgroundColor: "#f5f5f5", padding: "8px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "10px", color: "#666666" }}>入力件数</div>
                  <div style={{ fontWeight: "bold", fontSize: "15px", color: "#1a1a1a" }}>{rakutenLogs.totalInputRows}件</div>
                </div>
                <div style={{ flex: 1, backgroundColor: "#e8f5e9", padding: "8px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "10px", color: "#2e7d32" }}>変換成功</div>
                  <div style={{ fontWeight: "bold", fontSize: "15px", color: "#2e7d32" }}>{rakutenLogs.convertedRows}件</div>
                </div>
              </div>

              <p style={{ fontSize: "12px", color: "#444444", margin: "6px 0", wordBreak: "break-all" }}>
                📄 <strong>保存名:</strong><br />{rakutenLogs.outputFilename}
              </p>

              {rakutenLogs.excludedRows > 0 && (
                <details style={{ fontSize: "11px", color: "#7a4300", backgroundColor: "#fff3e0", padding: "8px", borderRadius: "6px", margin: "8px 0" }}>
                  <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
                    ℹ️ ETC乗降区間など利用日なし {rakutenLogs.excludedRows} 件を自動除外しました（タップして確認）
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "220px", overflowY: "auto", marginTop: "8px" }}>
                    {rakutenLogs.excludedData.map((row, idx) => (
                      <div key={idx} style={{ backgroundColor: "#ffffff", border: "1px solid #ffd39b", borderRadius: "6px", padding: "8px" }}>
                        <div>#{idx + 1} | 利用日: {row["利用日"] || "未入力"}</div>
                        <div style={{ fontWeight: "bold", marginTop: "2px", wordBreak: "break-all" }}>{row["利用店名・商品名"] || "内容なし"}</div>
                        {row["支払総額"] && <div style={{ marginTop: "2px" }}>金額: ￥{row["支払総額"]}</div>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <button
                onClick={handleRakutenDownload}
                style={{
                  width: "100%",
                  backgroundColor: rakutenDownloaded ? "#4caf50" : "#2e7d32",
                  color: "#ffffff",
                  border: "none",
                  padding: "16px",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                  margin: "16px 0",
                  boxShadow: "0 4px 6px rgba(46,125,50,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px"
                }}
              >
                {rakutenDownloaded ? "✅ 保存済み (再ダウンロード)" : "📥 変換後CSVを保存する"}
              </button>

              <h3 style={{ fontSize: "13px", marginTop: "16px", marginBottom: "8px", color: "#1a1a1a" }}>
                ▼ プレビュー (全 {rakutenLogs.convertedData.length} 件)
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "350px", overflowY: "auto", border: "1px solid #eee", padding: "8px", borderRadius: "8px", backgroundColor: "#ffffff" }}>
                {rakutenLogs.convertedData.map((row, idx) => (
                  <div key={idx} style={{ border: "1px solid #e0e0e0", borderRadius: "8px", padding: "10px", backgroundColor: "#fafafa", fontSize: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ color: "#666666", fontSize: "11px" }}>#{idx + 1} | {row["取引日"]}</span>
                      <span style={{ fontWeight: "bold", color: "#d32f2f", fontSize: "13px" }}>￥{row["出金金額（円）"]}</span>
                    </div>
                    <div style={{ fontWeight: "bold", color: "#1a1a1a", fontSize: "12px", wordBreak: "break-all" }}>{row["取引先"]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 📱 PayPay画面 */}
      {activeTab === "paypay" && (
        <div>
          <header style={{ textAlign: "center", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "18px", margin: 0, color: "#1a1a1a" }}>📱 PayPay明細 自動仕分け</h1>
          </header>

          <div style={{
            border: "2px dashed #ff0033",
            borderRadius: "12px",
            padding: "20px 12px",
            textAlign: "center",
            backgroundColor: "#ffffff",
            marginBottom: "20px",
            boxSizing: "border-box",
            width: "100%",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}>
            <label htmlFor="paypay-file" style={{
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
              boxSizing: "border-box"
            }}>
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
            <p style={{ fontSize: "11px", color: "#666666", marginTop: "10px", marginBottom: 0 }}>
              タップしてPayPay明細CSVを選択してください
            </p>
            {paypayProcessing && <p style={{ marginTop: "10px", color: "#ff0033", fontWeight: "bold" }}>⏳ 処理中...</p>}
          </div>

          {paypayError && (
            <div style={{ backgroundColor: "#ffebee", color: "#c62828", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "13px" }}>
              ❌ {paypayError}
            </div>
          )}

          {paypayReport && (
            <div style={{ border: "1px solid #e0e0e0", borderRadius: "12px", padding: "16px", backgroundColor: "#ffffff", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
              <h2 style={{ fontSize: "15px", marginTop: 0, marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "8px", color: "#1a1a1a" }}>📊 処理結果サマリー</h2>
              
              <div style={{ fontSize: "13px", lineHeight: "1.8", color: "#333333", marginBottom: "16px" }}>
                <div>📥 <strong>入力データ総数:</strong> {paypayReport.totalRows} 件</div>
                <div style={{ paddingLeft: "8px", borderLeft: "3px solid #ddd", margin: "8px 0" }}>
                  <div>1️⃣ 除外 (ポイント) : {paypayReport.excludedPoints} 件</div>
                  <div>2️⃣ クレジット抽出 : {paypayReport.creditData.length} 件</div>
                  <div>3️⃣ 残高払い抽出 : {paypayReport.paypayBalanceData.length} 件</div>
                  <div>4️⃣ 未分類 (その他) : {paypayReport.othersData.length} 件</div>
                </div>
              </div>

              <div style={{ backgroundColor: "#f9f9f9", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
                <div style={{ fontWeight: "bold", fontSize: "12px", marginBottom: "6px" }}>【診断結果】</div>
                <div style={{ fontSize: "12px", color: paypayReport.isCountOk ? "#2e7d32" : "#c62828", margin: "2px 0" }}>
                  {paypayReport.isCountOk
                    ? "✅ データの漏れはありません（件数一致）"
                    : `❌ 警告：件数が一致しません`}
                </div>
                <div style={{ fontSize: "12px", color: !paypayReport.hasOthers ? "#2e7d32" : "#ef6c00", margin: "2px 0" }}>
                  {!paypayReport.hasOthers
                    ? "✅ 全てのデータが正しく分類されました"
                    : `⚠️ 注意：未分類のデータが ${paypayReport.othersData.length} 件あります`}
                </div>
              </div>

              {/* 各CSV個別ダウンロードボタン（保存済みステータス付き） */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                <button
                  onClick={() => handlePaypayDownload(paypayReport.creditData, paypayReport.creditFilename, "credit")}
                  disabled={paypayReport.creditData.length === 0}
                  style={{
                    width: "100%",
                    backgroundColor: paypayReport.creditData.length === 0 ? "#ccc" : downloadedPayPayFiles["credit"] ? "#2e7d32" : "#0066cc",
                    color: "#ffffff",
                    border: "none",
                    padding: "12px",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor: paypayReport.creditData.length > 0 ? "pointer" : "not-allowed",
                    textAlign: "left",
                    position: "relative",
                    transition: "background-color 0.2s"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>📥 クレジット保存 ({paypayReport.creditData.length}件)</span>
                    {downloadedPayPayFiles["credit"] && (
                      <span style={{ backgroundColor: "#ffffff", color: "#2e7d32", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "10px", opacity: 0.85, fontWeight: "normal", display: "block", marginTop: "2px" }}>📄 {paypayReport.creditFilename}</span>
                </button>

                <button
                  onClick={() => handlePaypayDownload(paypayReport.paypayBalanceData, paypayReport.balanceFilename, "balance")}
                  disabled={paypayReport.paypayBalanceData.length === 0}
                  style={{
                    width: "100%",
                    backgroundColor: paypayReport.paypayBalanceData.length === 0 ? "#ccc" : downloadedPayPayFiles["balance"] ? "#2e7d32" : "#ff0033",
                    color: "#ffffff",
                    border: "none",
                    padding: "12px",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    fontSize: "13px",
                    cursor: paypayReport.paypayBalanceData.length > 0 ? "pointer" : "not-allowed",
                    textAlign: "left",
                    position: "relative",
                    transition: "background-color 0.2s"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>📥 残高払い保存 ({paypayReport.paypayBalanceData.length}件)</span>
                    {downloadedPayPayFiles["balance"] && (
                      <span style={{ backgroundColor: "#ffffff", color: "#2e7d32", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                        ✅ 保存済み
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "10px", opacity: 0.85, fontWeight: "normal", display: "block", marginTop: "2px" }}>📄 {paypayReport.balanceFilename}</span>
                </button>

                {paypayReport.hasOthers && (
                  <button
                    onClick={() => handlePaypayDownload(paypayReport.othersData, paypayReport.othersFilename, "others")}
                    style={{
                      width: "100%",
                      backgroundColor: downloadedPayPayFiles["others"] ? "#2e7d32" : "#e65100",
                      color: "#ffffff",
                      border: "none",
                      padding: "12px",
                      borderRadius: "8px",
                      fontWeight: "bold",
                      fontSize: "13px",
                      cursor: "pointer",
                      textAlign: "left",
                      position: "relative",
                      transition: "background-color 0.2s"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>⚠️ 未分類(その他)保存 ({paypayReport.othersData.length}件)</span>
                      {downloadedPayPayFiles["others"] && (
                        <span style={{ backgroundColor: "#ffffff", color: "#2e7d32", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                          ✅ 保存済み
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "10px", opacity: 0.85, fontWeight: "normal", display: "block", marginTop: "2px" }}>📄 {paypayReport.othersFilename}</span>
                  </button>
                )}
              </div>

              {/* ファイル単位でのプレビュー切り替えタブ */}
              <div style={{ marginTop: "20px", borderTop: "1px solid #eee", paddingTop: "16px" }}>
                <h3 style={{ fontSize: "14px", marginTop: 0, marginBottom: "10px", color: "#1a1a1a" }}>
                  ▼ 生成ファイル別 プレビュー
                </h3>

                <div style={{ display: "flex", gap: "4px", marginBottom: "10px", backgroundColor: "#f0f0f0", padding: "3px", borderRadius: "8px" }}>
                  <button
                    onClick={() => setPreviewTab("credit")}
                    style={{
                      flex: 1,
                      padding: "8px 2px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: previewTab === "credit" ? "#ffffff" : "transparent",
                      color: previewTab === "credit" ? "#0066cc" : "#666666",
                      boxShadow: previewTab === "credit" ? "0 1px 2px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    クレジット ({paypayReport.creditData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("balance")}
                    style={{
                      flex: 1,
                      padding: "8px 2px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: previewTab === "balance" ? "#ffffff" : "transparent",
                      color: previewTab === "balance" ? "#ff0033" : "#666666",
                      boxShadow: previewTab === "balance" ? "0 1px 2px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    残高払い ({paypayReport.paypayBalanceData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("others")}
                    style={{
                      flex: 1,
                      padding: "8px 2px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: previewTab === "others" ? "#ffffff" : "transparent",
                      color: previewTab === "others" ? "#e65100" : "#666666",
                      boxShadow: previewTab === "others" ? "0 1px 2px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    未分類 ({paypayReport.othersData.length})
                  </button>
                  <button
                    onClick={() => setPreviewTab("excluded")}
                    style={{
                      flex: 1,
                      padding: "8px 2px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: previewTab === "excluded" ? "#ffffff" : "transparent",
                      color: previewTab === "excluded" ? "#7a4300" : "#666666",
                      boxShadow: previewTab === "excluded" ? "0 1px 2px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    除外 ({paypayReport.excludedPoints})
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", border: "1px solid #eee", padding: "8px", borderRadius: "8px", backgroundColor: "#ffffff" }}>
                  {getActivePreviewData().length === 0 ? (
                    <div style={{ textAlign: "center", padding: "20px", color: "#999999", fontSize: "12px" }}>
                      該当するデータはありません
                    </div>
                  ) : (
                    getActivePreviewData().map((row, idx) => (
                      <div key={idx} style={{ border: "1px solid #e0e0e0", borderRadius: "8px", padding: "10px", backgroundColor: "#fafafa", fontSize: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ color: "#666666", fontSize: "11px" }}>#{idx + 1} | {row["取引日時"] || row["取引日"] || "日付なし"}</span>
                          <span style={{ fontWeight: "bold", color: "#d32f2f", fontSize: "13px" }}>￥{row["金額（円）"] || row["出金金額（円）"] || "0"}</span>
                        </div>
                        <div style={{ fontWeight: "bold", color: "#1a1a1a", fontSize: "12px", wordBreak: "break-all" }}>
                          {row["店名・施設名"] || row["取引先"] || "取引先不明"}
                        </div>
                        <div style={{ fontSize: "11px", color: "#666666", marginTop: "2px" }}>
                          【取引方法】{row["取引方法"]}
                        </div>
                      </div>
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
