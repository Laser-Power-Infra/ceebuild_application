'use client';

import React, { useEffect, useState, use, useRef } from 'react';
import { Printer, ArrowLeft, Download, FileText, CheckCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface Docket {
  id: number;
  docketNoQtnNo: string | null;
  partyName: string | null;
  address: string | null;
  state: string | null;
  utility: string | null;
  deliveryLocation: string | null;
  price: string | null;
  payment: string | null;
  delivery: string | null;
  warranty: string | null;
  approval: string | null;
  inspection: string | null;
}

interface Item {
  id: number;
  itemNameParty: string | null;
  ourItemName: string | null;
  qty: string | null;
  uom: string | null;
  price: string | null;
  uomOfQtn: string | null;
  unitWtOfMemberKg?: string | null;
}

export default function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [docket, setDocket] = useState<Docket | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const quotationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/quotation/${id}`);
        const data = await res.json();
        if (data.docket) setDocket(data.docket);
        if (data.items) setItems(data.items);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  const [aiCategorizing, setAiCategorizing] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleAiCategorize = async () => {
    if (!docket) return;
    setAiCategorizing(true);
    try {
      const res = await fetch('/api/ai/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docketNoQtnNo: docket.docketNoQtnNo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI categorization failed');

      if (data.updatedCount === 0) {
        showToast('AI Check Complete: No unclassified Manufacturing/Trading items found.');
      } else {
        showToast(`✨ AI Categorization Complete! Updated ${data.updatedCount} items.`);
        // Refetch updated items for this quotation
        const refreshedRes = await fetch(`/api/quotation/${id}`);
        const refreshedData = await refreshedRes.json();
        if (refreshedData.items) setItems(refreshedData.items);
      }
    } catch (err: any) {
      console.error('AI Error:', err);
      showToast(`AI Error: ${err.message || 'Categorization failed'}`);
    } finally {
      setAiCategorizing(false);
    }
  };

  // Download PDF function using html2pdf.js dynamically loaded
  const handleDownloadPDF = async () => {
    if (!quotationRef.current || !docket) return;
    setDownloading(true);

    try {
      // Load html2pdf script dynamically if not present
      if (!(window as any).html2pdf) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.body.appendChild(script);
        });
      }

      const element = quotationRef.current;
      const opt = {
        margin: [6, 6, 6, 6],
        filename: `CEEBUILD_Quotation_${docket.docketNoQtnNo || docket.id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          letterRendering: true,
          scrollY: 0,
          scrollX: 0,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
          mode: ['css', 'legacy'],
          before: '.page-break-before',
          avoid: ['tr', '.keep-together'],
        },
      };

      await (window as any).html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('PDF Generation Error:', err);
      // Fallback to print dialog
      window.print();
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 font-sans">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-600 font-bold text-sm">Loading CEEBUILD Quotation Sheet...</p>
        </div>
      </div>
    );
  }

  if (!docket) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 font-sans p-6">
        <h2 className="text-xl font-bold text-slate-800">Quotation Record Not Found</h2>
        <p className="text-slate-500 text-sm mt-1">Unable to locate docket record #{id}.</p>
        <Link
          href="/"
          className="mt-4 px-4 py-2 bg-blue-600 text-white font-bold rounded-xl text-sm hover:bg-blue-700 transition-all"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const CHUNK_SIZE = 20;
  const itemChunks: Item[][] = [];
  if (items.length === 0) {
    itemChunks.push([]);
  } else {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      itemChunks.push(items.slice(i, i + CHUNK_SIZE));
    }
  }
  const totalPages = 1 + itemChunks.length;

  return (
    <div className="quotation-wrapper min-h-screen bg-slate-200 text-slate-900 font-sans p-4 sm:p-8 flex flex-col items-center">
      {/* Global CSS for Print and PDF Alignment */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm;
          }
          html, body {
            background-color: white !important;
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .quotation-wrapper {
            background-color: white !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            min-height: 0 !important;
            width: 100% !important;
            display: block !important;
          }
          .pdf-page {
            border: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            page-break-after: always !important;
            break-after: page !important;
            min-height: 0 !important;
          }
          .page-break-before {
            break-before: page !important;
            page-break-before: always !important;
          }
          .keep-together {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .annexure-banner {
            break-after: avoid !important;
            page-break-after: avoid !important;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-semibold animate-bounce print:hidden">
          <CheckCircle className="w-5 h-5 text-emerald-200" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Action Bar (Hidden on Print) */}
      <div className="w-full max-w-4xl mb-6 flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-300 shadow-md print:hidden">
        <Link
          href="/"
          className="flex items-center space-x-2 text-slate-700 hover:text-slate-900 font-bold text-sm bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleAiCategorize}
            disabled={aiCategorizing}
            className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold text-sm px-4 py-2.5 rounded-xl shadow-md transition-all"
            title="Autofill unclassified Manufacturing & Trading items using Groq AI"
          >
            {aiCategorizing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>AI Categorizing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-yellow-300 animate-pulse" />
                <span>Autofill by AI</span>
              </>
            )}
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-md transition-all"
          >
            <Printer className="w-4 h-4" />
            <span>Print View</span>
          </button>

          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md transition-all"
          >
            {downloading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Downloading PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download PDF File</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Printable Quotation Document Container */}
      <div
        ref={quotationRef}
        className="w-full max-w-4xl space-y-6 print:space-y-0"
      >
        {/* PAGE 1: COVER LETTER & COMMERCIAL TERMS */}
        <div className="pdf-page bg-white p-2 box-border shadow-md">
          <div className="pdf-page-frame border-2 border-[#0284c7] p-5 sm:p-7 bg-white flex flex-col justify-between min-h-[268mm] box-border text-xs text-slate-900 leading-relaxed font-sans">
            <div className="space-y-3">
              {/* Header Block with Official Company Logo */}
              <div className="border border-blue-400 grid grid-cols-4 overflow-hidden rounded-none">
                <div className="col-span-3 bg-[#0284c7] text-white p-2.5 space-y-1 font-medium text-[10.5px] leading-snug">
                  <div>
                    <strong className="text-white font-bold">Head Office : </strong>
                    <span>ADVENTZ INFINITY@5, 19th Floor Near Technopolis, Sector V, Salt Lake, Kolkata-700091, WB, India.</span>
                  </div>
                  <div>
                    <strong className="text-white font-bold">Factory Address : </strong>
                    <span>Clipcon Complex, NH-6, Dhulagorh, Sankrail Howrah-711302</span>
                  </div>
                  <div>
                    <strong className="text-white font-bold">Email id : </strong>
                    <span>Info@ceebuildcompany.com</span>
                  </div>
                  <div>
                    <strong className="text-white font-bold">Phone : </strong>
                    <span>(+91) 9674766820</span>
                  </div>
                </div>
                <div className="bg-white flex flex-col justify-center items-center p-2 border-l border-blue-400">
                  <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="max-h-12 w-auto object-contain" />
                </div>
              </div>

              {/* Offer No Header Strip */}
              <div className="grid grid-cols-4 border border-blue-400 font-bold text-xs">
                <div className="bg-[#0284c7] text-white p-2 text-[11px] tracking-wider uppercase">OFFER NO</div>
                <div className="col-span-3 p-2 border-l border-blue-400 text-xs font-extrabold text-blue-900 bg-slate-50">
                  {docket.docketNoQtnNo || 'CEE-000000'}
                </div>
              </div>

              {/* Recipient Party Info */}
              <div className="border border-blue-400 p-2.5 bg-slate-50 space-y-0.5 text-xs">
                <p className="font-bold text-slate-800">TO,</p>
                <p className="font-extrabold text-xs text-slate-900 uppercase pl-3">
                  {docket.partyName || '<PARTY NAME>'}
                </p>
                <p className="text-slate-700 pl-3 whitespace-pre-line font-medium text-[11px] leading-snug">
                  {docket.address || '<ADDRESS>'}
                </p>
              </div>

              {/* Subject Strip */}
              <div className="grid grid-cols-4 border border-blue-400 font-bold text-xs">
                <div className="bg-[#0284c7] text-white p-1.5 text-[11px]">SUB: Offer For Supply under</div>
                <div className="col-span-3 p-1.5 border-l border-blue-400 text-[11px] font-extrabold text-slate-900 bg-slate-50">
                  {docket.utility || '<UTILITY>'}
                </div>
              </div>

              {/* Cover Letter Body */}
              <div className="space-y-1.5 text-slate-800 text-[11px] leading-relaxed font-medium">
                <p>
                  We are pleased to submit our offer for your kind consideration. This offer has been prepared in accordance with the technical requirements and commercial discussions held, and is subject to the terms and conditions outlined below. The detailed price schedule for the proposed scope of supply is enclosed herewith as Annexure–A for your reference.
                </p>
                <p>
                  We trust that our proposal meets your requirements and assures you of our commitment to quality, reliability, and timely execution. We look forward to the opportunity of working with your esteemed organization and request you to kindly review the enclosed details.
                </p>
                <p>
                  Please feel free to contact us for any clarification or additional information required.
                </p>
              </div>

              {/* Terms & Conditions Section */}
              <div className="border border-blue-400 rounded-none overflow-hidden">
                <div className="bg-[#0284c7] text-white px-2.5 py-1 font-bold text-[11px]">
                  Terms & Conditions :
                </div>
                <div className="p-2 bg-white space-y-1 text-[11px] divide-y divide-slate-100 font-medium">
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">1. Price :</span>
                    <span className="col-span-2 text-slate-800">{docket.price || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">2. Payment Terms :</span>
                    <span className="col-span-2 text-slate-800">{docket.payment || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">3. Delivery :</span>
                    <span className="col-span-2 text-slate-800">{docket.delivery || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">4. Warranty :</span>
                    <span className="col-span-2 text-slate-800">{docket.warranty || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">5. Approval :</span>
                    <span className="col-span-2 text-slate-800">{docket.approval || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">6. Inspection :</span>
                    <span className="col-span-2 text-slate-800">{docket.inspection || '-'}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-0.5">
                    <span className="font-bold text-blue-900">7. Delivery Destination :</span>
                    <span className="col-span-2 text-slate-800">{docket.deliveryLocation || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Signature & Enclosure Block */}
              <div className="pt-1 space-y-0.5 font-medium text-[11px] text-slate-800">
                <p className="font-bold">Thanks & Regards,</p>
                <p className="font-extrabold text-blue-900">For CEEBUILD COMPANY PRIVATE LIMITED</p>
                <p className="font-bold pt-0.5">Ms. Puja Agarwal</p>
                <p className="text-slate-600">Contact: 88200 44755 / 96747 55238</p>

                <div className="pt-1 flex items-center space-x-2 text-[11px] font-bold text-blue-900">
                  <span>Enclosed :</span>
                  <span className="underline text-blue-600">Annexure-A (Price Bid)</span>
                </div>
              </div>
            </div>

            {/* Document Footer for Page 1 */}
            <div className="pt-2 mt-3 border-t border-slate-300 flex justify-between items-center text-[10px] text-slate-500 font-mono">
              <span>Offer Ref: #{docket.docketNoQtnNo || docket.id}</span>
              <span>Page 1 of {totalPages}</span>
              <span>CEEBUILD Company (P) Ltd.</span>
            </div>
          </div>
        </div>

        {/* ANNEXURE A PAGES (EACH WITH A COMPLETE 4-SIDED BLUE BORDER FRAME - 20 ITEMS PER SHEET) */}
        {itemChunks.map((chunk, chunkIdx) => (
          <div
            key={chunkIdx}
            className="page-break-before pdf-page bg-white p-2 box-border shadow-md"
            style={{ pageBreakBefore: 'always', breakBefore: 'page' }}
          >
            <div className="pdf-page-frame border-2 border-[#0284c7] p-5 sm:p-7 bg-white flex flex-col justify-between min-h-[268mm] box-border text-xs text-slate-900 leading-relaxed font-sans">
              <div className="space-y-3">
                {/* Annexure Banner */}
                <div className="annexure-banner bg-[#0284c7] text-white p-2 text-center font-extrabold text-xs uppercase tracking-wider rounded-none border border-blue-500 box-border w-full flex justify-between items-center px-3">
                  <span className="tracking-wide">Annexure–A (Price Bid)</span>
                  <span className="text-[10px] font-semibold normal-case bg-blue-900/60 px-2.5 py-0.5 rounded border border-blue-300/30">
                    Sheet {chunkIdx + 1} of {itemChunks.length}
                  </span>
                </div>

                {/* Table with Explicit Cell Borders and Fixed Proportions */}
                <table className="w-full table-fixed border-collapse border border-blue-400 text-[10px] m-0 p-0 box-border">
                  <thead className="bg-[#e0f2fe] text-blue-900 font-extrabold uppercase text-[9.5px]">
                    <tr>
                      <th className="w-[7%] p-1.5 border border-blue-400 text-center whitespace-nowrap font-extrabold">SL NO</th>
                      <th className="w-[33%] p-1.5 border border-blue-400 text-left font-extrabold">PARTY ITEM NAME</th>
                      <th className="w-[24%] p-1.5 border border-blue-400 text-left font-extrabold">OUR ITEM NAME</th>
                      <th className="w-[9%] p-1.5 border border-blue-400 text-center whitespace-nowrap font-extrabold">QTY</th>
                      <th className="w-[7%] p-1.5 border border-blue-400 text-center whitespace-nowrap font-extrabold">UNIT</th>
                      <th className="w-[10%] p-1.5 border border-blue-400 text-center whitespace-nowrap font-extrabold">RATE/UNIT</th>
                      <th className="w-[10%] p-1.5 border border-blue-400 text-center font-extrabold leading-tight">UNIT OF QTN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-200 font-medium">
                    {chunk.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500 font-semibold border border-blue-300">
                          No quotation items listed under offer #{docket.docketNoQtnNo}.
                        </td>
                      </tr>
                    ) : (
                      chunk.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-50 border-b border-blue-200">
                          <td className="p-1.5 border border-blue-300 text-center font-bold text-slate-700 whitespace-nowrap">
                            {chunkIdx * CHUNK_SIZE + idx + 1}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-left font-medium leading-tight text-slate-800 break-words">
                            {item.itemNameParty || '-'}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-left text-blue-900 font-bold leading-tight break-words">
                            {item.ourItemName || '-'}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-center font-bold text-slate-800 whitespace-nowrap">
                            {item.qty || '-'}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-center text-slate-700 whitespace-nowrap">
                            {item.uom || '-'}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-center font-extrabold text-blue-900 whitespace-nowrap">
                            {item.price || '-'}
                          </td>
                          <td className="p-1.5 border border-blue-300 text-center font-bold text-slate-700 whitespace-nowrap">
                            {item.unitWtOfMemberKg || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Document Footer */}
              <div className="pt-2 mt-3 border-t border-slate-300 flex justify-between items-center text-[10px] text-slate-500 font-mono">
                <span>Offer Ref: #{docket.docketNoQtnNo || docket.id}</span>
                <span>Page {chunkIdx + 2} of {totalPages}</span>
                <span>CEEBUILD Company (P) Ltd.</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
