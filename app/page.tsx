"use client";

import React, { useState } from "react";
import Papa from "papaparse";
import Encoding from "encoding-japanese";

// 出力するCSVのヘッダー定義
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
  previewData: Record<string, string>[];
}

export default function RakutenConverter() {
  const [logs, setLogs] = useState<LogState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // ファイル読み込み & 変換処理
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

        // 1. 文字コードの自動判別 & UTF-8文字列への変換 (cp932/shift_jis/utf-8に対応)
        const uint8Array = new Uint8Array(buffer);
        const detectedEncoding = Encoding.detect(uint8Array);
        const unicodeString = Encoding.convert(uint8Array, {
          to: "UNICODE",
          from: detectedEncoding || "AUTO",
          type: "string",
        });

        // 2. CSVパース
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

  // データ変換コアロジック
  const processCsvData = (rawData: Record<string, string>[], fileName: string) => {
    const totalInputRows = rawData.length;

    if (totalInputRows === 0) {
      setErrorMsg("CSVファイルが空です。");
      setIsProcessing(false);
      return;
    }

    // 必須カラムチェック
    const firstRowKeys = Object.keys(rawData[0] || {});
    const requiredColumns = ["利用日", "利用店名・商品名", "支払総額"];
    const missingColumns = requiredColumns.filter((c) => !firstRowKeys.includes(c));

    if (missingColumns.length > 0) {
      setErrorMsg(`必要なカラムが含まれていません: ${missingColumns.join(", ")}`);
      setIsProcessing(false);
      return;
    }

    // 1. 無効行（利用日がない行）の除外
    const validRows = rawData.filter((row) => {
      const dateStr = row["利用日"]?.trim();
      return dateStr && !isNaN(Date.parse(dateStr.replace(/\//g, "-")));
    });

    const excludedRows = totalInputRows - validRows.length;
    const convertedRows = validRows.length;

    // 2. 各フィールドの生成
    const convertedData: Record<string, string>[] = [];
    let targetMonth: number | null = null;

    validRows.forEach((row, index) => {
      const rawDateStr = row["利用日"]?.trim();
      const dateObj = new Date(rawDateStr.replace(/\//g, "-"));

      // 月の取得（最初の有効データから）
      if (targetMonth === null && !isNaN(dateObj.getTime())) {
        targetMonth = dateObj.getMonth() + 1;
      }

      // 取引日 (一意の時刻 HH:MM:SS 付与)
      const secOffset = index + 1;
      const hh = String(Math.floor(secOffset / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor((secOffset % 3600) / 60)).padStart(2, "0");
      const ss = String(secOffset % 60).padStart(2, "0");

      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      const dateFormatted = `${year}/${month}/${day} ${hh}:${mm}:${ss}`;

      // 出金金額（円）: 半額・四捨五入・カンマ区切り
      const rawAmountStr = (row["支払総額"] || "0").replace(/,/g, "");
      const rawAmount = parseFloat(rawAmountStr) || 0;
      const amountHalfRound = Math.round(rawAmount / 2);
      const amountFormatted =
        Math.abs(amountHalfRound) >= 1000
          ? amountHalfRound.toLocaleString("ja-JP")
          : String(amountHalfRound);

      // 取引番号 (20桁)
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

    // 出力ファイル名生成
    const monthMatch = fileName.match(/(\d{1,2})月/) || fileName.match(/\d{4}(\d{2})/);
    if (monthMatch) {
      targetMonth = parseInt(monthMatch[1], 10);
    }

    const outputFilename = targetMonth
      ? `楽天カード${targetMonth}月分_MoneyForward取込用.csv`
      : "楽天カード_MoneyForward取込用.csv";

    // レポート用のステート更新
    setLogs({
      totalInputRows,
      convertedRows,
      excludedRows,
      outputFilename,
      isMatch: totalInputRows === convertedRows + excludedRows,
      previewData: convertedData.slice(0, 5),
    });

    setIsProcessing(false);

    // 3. 自動ダウンロード実行
    downloadCsv(convertedData, outputFilename);
  };

  // CSVダウンロード処理 (BOM付き UTF-8)
  const downloadCsv = (data: Record<string, string>[], filename: string) => {
    const csvString = Papa.unparse(data, {
      columns: OUTPUT_HEADERS,
      newline: "\r\n",
    });

    // UTF-8 BOMを付与して文字化け防止
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvString], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main style={{ maxWidth: "800px", margin: "40px auto", padding: "0 20px", fontFamily: "sans-serif" }}>
      <h1>💳 楽天カード明細 変換ツール</h1>
      <p style={{ color: "#666" }}>
        楽天カードのCSVをMoneyForward取込用の形式（半額変換・フォーマット整形）へ自動変換します。
        <br />
        <small>※データはサーバーに送信されず、お使いのブラウザ内でのみ処理されます。</small>
      </p>

      {/* ファイル選択エリア */}
      <div style={{ border: "2px dashed #ccc", padding: "30px", textAlign: "center", borderRadius: "8px", margin: "20px 0" }}>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={isProcessing}
          style={{ fontSize: "16px" }}
        />
        {isProcessing && <p style={{ marginTop: "10px", color: "#0066cc" }}>処理中...</p>}
      </div>

      {/* エラーメッセージ */}
      {errorMsg && (
        <div style={{ backgroundColor: "#ffebee", color: "#c62828", padding: "12px", borderRadius: "4px", marginBottom: "20px" }}>
          ❌ {errorMsg}
        </div>
      )}

      {/* 処理レポート */}
      {logs && (
        <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "20px", backgroundColor: "#fdfdfd" }}>
          <h2>📊 処理結果サマリー</h2>
          <hr />
          <ul>
            <li>📥 <strong>入力データ総数:</strong> {logs.totalInputRows} 件</li>
            <li>1️⃣ <strong>変換成功データ:</strong> {logs.convertedRows} 件</li>
            <li>2️⃣ <strong>除外データ(区間等):</strong> {logs.excludedRows} 件</li>
            <li>📄 <strong>出力ファイル名:</strong> {logs.outputFilename}</li>
          </ul>

          <div style={{ marginTop: "15px", padding: "10px", backgroundColor: logs.isMatch ? "#e8f5e9" : "#fff3e0", borderRadius: "4px" }}>
            <h3>【診断結果】</h3>
            {logs.isMatch ? (
              <p style={{ color: "#2e7d32", margin: 0 }}>✅ 全ての行が正しく検証・処理されました（件数一致）</p>
            ) : (
              <p style={{ color: "#ef6c00", margin: 0 }}>⚠️ 警告：件数が一致しません</p>
            )}
            {logs.excludedRows > 0 && (
              <p style={{ fontSize: "14px", color: "#555", marginTop: "5px" }}>
                ℹ️ ETC乗降区間などの利用日なしデータ {logs.excludedRows} 件を自動除外しました
              </p>
            )}
          </div>

          {/* プレビューテーブル */}
          <h3 style={{ marginTop: "20px" }}>▼ 変換後のデータプレビュー (先頭5件)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ backgroundColor: "#f0f0f0" }}>
                  {OUTPUT_HEADERS.map((h) => (
                    <th key={h} style={{ border: "1px solid #ccc", padding: "6px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.previewData.map((row, idx) => (
                  <tr key={idx}>
                    {OUTPUT_HEADERS.map((h) => (
                      <td key={h} style={{ border: "1px solid #ccc", padding: "6px", whiteSpace: "nowrap" }}>
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: "18px", fontWeight: "bold", textAlign: "center", marginTop: "20px" }}>
            🎉 CSVファイルのダウンロードが完了しました！
          </p>
        </div>
      )}
    </main>
  );
}
