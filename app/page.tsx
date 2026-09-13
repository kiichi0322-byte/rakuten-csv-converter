"use client";

import React, { useState } from "react";
import Papa from "papaparse";
import Encoding from "encoding-japanese";

const OUTPUT_HEADERS = [
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

interface LogState {
  totalInputRows: number;
  convertedRows: number;
  excludedRows: number;
  outputFilename: string;
  isMatch: boolean;
  convertedData: Record<string, string>[];
}

export default function RakutenConverter() {
  const [logs, setLogs] = useState<LogState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setErrorMsg("");
    setLogs(null);

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
            processCsvData(results.data, file.name);
          },
          error: (err: Error) => {
            setErrorMsg(`CSVパースエラー: ${err.message}`);
            setIsProcessing(false);
          },
        });
      } catch (err) {
        setErrorMsg("ファイルの読み込み中にエラーが発生しました。");
        setIsProcessing(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const processCsvData = (rawData: Record<string, string>[], fileName: string) => {
    const totalInputRows = rawData.length;

    if (totalInputRows === 0) {
      setErrorMsg("CSVファイルが空です。");
      setIsProcessing(false);
      return;
    }

    const firstRowKeys = Object.keys(rawData[0] || {});
    const requiredColumns = ["利用日", "利用店名・商品名", "支払総額"];
    const missingColumns = requiredColumns.filter((c) => !firstRowKeys.includes(c));

    if (missingColumns.length > 0) {
      setErrorMsg(`必要なカラムが含まれていません: ${missingColumns.join(", ")}`);
      setIsProcessing(false);
      return;
    }

    const validRows = rawData.filter((row) => {
      const dateStr = row["利用日"]?.trim();
      return dateStr && !isNaN(Date.parse(dateStr.replace(/\//g, "-")));
    });

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

    setLogs({
      totalInputRows,
      convertedRows,
      excludedRows,
      outputFilename,
      isMatch: totalInputRows === convertedRows + excludedRows,
      convertedData,
    });

    setIsProcessing(false);
  };

  const handleManualDownload = () => {
    if (!logs) return;

    const csvString = Papa.unparse(logs.convertedData, {
      columns: OUTPUT_HEADERS,
      newline: "\r\n",
    });

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvString], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", logs.outputFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main style={{ width: "100%", maxWidth: "100vw", boxSizing: "border-box", margin: "0 auto", padding: "20px 16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#333", overflowX: "hidden" }}>
      <header style={{ textAlign: "center", marginBottom: "20px", width: "100%" }}>
        <h1 style={{ fontSize: "20px", margin: "0 0 8px 0" }}>💳 楽天カード明細 変換</h1>
        <p style={{ fontSize: "12px", color: "#666", lineHeight: "1.5", margin: 0 }}>
          楽天カードCSVをMoneyForward取込用（半額変換）に自動整形します。
          <br />
          <span style={{ color: "#2e7d32", fontWeight: "bold" }}>🔒 個人情報はサーバーに送信されません</span>
        </p>
      </header>

      <div style={{
        border: "2px dashed #0066cc",
        borderRadius: "12px",
        padding: "20px 12px",
        textAlign: "center",
        backgroundColor: "#f4f8ff",
        marginBottom: "20px",
        boxSizing: "border-box",
        width: "100%"
      }}>
        <label htmlFor="file-upload" style={{
          display: "inline-block",
          backgroundColor: "#0066cc",
          color: "#fff",
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
          id="file-upload"
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={isProcessing}
          style={{ display: "none" }}
        />
        <p style={{ fontSize: "11px", color: "#666", marginTop: "10px", marginBottom: 0 }}>
          タップして明細CSVを選択してください
        </p>
        {isProcessing && <p style={{ marginTop: "10px", color: "#0066cc", fontWeight: "bold" }}>⏳ 処理中...</p>}
      </div>

      {errorMsg && (
        <div style={{ backgroundColor: "#ffebee", color: "#c62828", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "13px", boxSizing: "border-box" }}>
          ❌ {errorMsg}
        </div>
      )}

      {logs && (
        <div style={{ border: "1px solid #e0e0e0", borderRadius: "12px", padding: "16px", backgroundColor: "#fff", boxSizing: "border-box", width: "100%" }}>
          <h2 style={{ fontSize: "16px", marginTop: 0, marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "8px" }}>📊 処理完了レポート</h2>
          
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", width: "100%", boxSizing: "border-box" }}>
            <div style={{ flex: 1, backgroundColor: "#f9f9f9", padding: "8px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#666" }}>入力件数</div>
              <div style={{ fontWeight: "bold", fontSize: "15px" }}>{logs.totalInputRows}件</div>
            </div>
            <div style={{ flex: 1, backgroundColor: "#e8f5e9", padding: "8px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#2e7d32" }}>変換成功</div>
              <div style={{ fontWeight: "bold", fontSize: "15px", color: "#2e7d32" }}>{logs.convertedRows}件</div>
            </div>
          </div>

          <p style={{ fontSize: "12px", color: "#555", margin: "6px 0", wordBreak: "break-all" }}>
            📄 <strong>保存名:</strong><br />{logs.outputFilename}
          </p>

          {logs.excludedRows > 0 && (
            <p style={{ fontSize: "11px", color: "#e65100", backgroundColor: "#fff3e0", padding: "8px", borderRadius: "6px", margin: "8px 0" }}>
              ℹ️ ETC乗降区間など利用日なし {logs.excludedRows} 件を自動除外しました
            </p>
          )}

          {/* 手動ダウンロードボタン */}
          <button
            onClick={handleManualDownload}
            style={{
              width: "100%",
              backgroundColor: "#2e7d32",
              color: "#fff",
              border: "none",
              padding: "14px",
              borderRadius: "8px",
              fontWeight: "bold",
              fontSize: "15px",
              cursor: "pointer",
              margin: "16px 0",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}
          >
            📥 変換後CSVをダウンロードする
          </button>

          <h3 style={{ fontSize: "14px", marginTop: "16px", marginBottom: "8px" }}>
            ▼ プレビュー (全 {logs.convertedData.length} 件)
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxHeight: "400px", overflowY: "auto", border: "1px solid #eee", padding: "8px", borderRadius: "8px", boxSizing: "border-box" }}>
            {logs.convertedData.map((row, idx) => (
              <div key={idx} style={{ border: "1px solid #e0e0e0", borderRadius: "8px", padding: "10px", backgroundColor: "#fafafa", fontSize: "12px", boxSizing: "border-box", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "#666", fontSize: "11px" }}>#{idx + 1} | {row["取引日"]}</span>
                  <span style={{ fontWeight: "bold", color: "#d32f2f", fontSize: "13px" }}>￥{row["出金金額（円）"]}</span>
                </div>
                <div style={{ fontWeight: "bold", color: "#333", fontSize: "12px", wordBreak: "break-all" }}>{row["取引先"]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
