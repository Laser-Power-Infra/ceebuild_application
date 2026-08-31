'use client';

import React, { useEffect, useState, use, useRef } from 'react';
import { Printer, ArrowLeft, Download, FileText, CheckCircle } from 'lucide-react';
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
        margin: [8, 8, 8, 8],
        filename: `CEEBUILD_Quotation_${docket.docketNoQtnNo || docket.id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'], before: '.html2pdf__page-break', avoid: ['tr', '.keep-together'] },
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

  return (
    <div className="quotation-wrapper min-h-screen bg-slate-200 text-slate-900 font-sans p-4 sm:p-8 flex flex-col items-center">
      {/* Global CSS for Print and PDF Alignment */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
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
          .quotation-paper {
            max-width: 100% !important;
            width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .html2pdf__page-break, .page-break-before {
            break-before: page !important;
            page-break-before: always !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
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
        className="quotation-paper w-full max-w-4xl bg-white border border-blue-200 shadow-xl rounded-none p-6 sm:p-10 space-y-5 text-xs text-slate-900 leading-relaxed font-sans"
      >
        {/* PAGE 1 COVER LETTER SECTION (KEPT TOGETHER TO PREVENT SLICING SIGNATURE) */}
        <div className="keep-together space-y-4">
          {/* Header Block with Official Company Logo */}
          <div className="border border-blue-400 grid grid-cols-1 md:grid-cols-4 overflow-hidden rounded-xs">
            <div className="md:col-span-3 bg-[#0284c7] text-white p-3.5 space-y-1.5 font-medium text-[11px] leading-snug">
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
            <div className="bg-white flex flex-col justify-center items-center p-3 border-l border-blue-400">
              <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="max-h-14 w-auto object-contain" />
            </div>
          </div>

          {/* Offer No Header Strip */}
          <div className="grid grid-cols-4 border border-blue-400 font-bold">
            <div className="bg-[#0284c7] text-white p-2.5 text-xs tracking-wider">OFFER NO</div>
            <div className="col-span-3 p-2.5 border-l border-blue-400 text-sm font-extrabold text-blue-900 bg-slate-50">
              {docket.docketNoQtnNo || 'CEE-000000'}
            </div>
          </div>

          {/* Recipient Party Info */}
          <div className="border border-blue-400 p-3.5 bg-slate-50 space-y-1 text-xs">
            <p className="font-bold text-slate-800">TO,</p>
            <p className="font-extrabold text-sm text-slate-900 uppercase pl-4">
              {docket.partyName || '<PARTY NAME>'}
            </p>
            <p className="text-slate-700 pl-4 whitespace-pre-line font-medium">
              {docket.address || '<ADDRESS>'}
            </p>
          </div>

          {/* Subject Strip */}
          <div className="grid grid-cols-4 border border-blue-400 font-bold">
            <div className="bg-[#0284c7] text-white p-2 text-xs">SUB: Offer For Supply under</div>
            <div className="col-span-3 p-2 border-l border-blue-400 text-xs font-extrabold text-slate-900 bg-slate-50">
              {docket.utility || '<UTILITY>'}
            </div>
          </div>

          {/* Cover Letter Body */}
          <div className="space-y-2 text-slate-800 text-xs leading-relaxed font-medium">
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
          <div className="border border-blue-400 rounded-xs overflow-hidden keep-together">
            <div className="bg-[#0284c7] text-white px-3 py-1.5 font-bold text-xs">
              Terms & Conditions :
            </div>
            <div className="p-2.5 bg-white space-y-1.5 text-xs divide-y divide-slate-100 font-medium">
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
          <div className="pt-2 space-y-1 font-medium text-xs text-slate-800 keep-together">
            <p className="font-bold">Thanks & Regards,</p>
            <p className="font-extrabold text-blue-900">For CEEBUILD COMPANY PRIVATE LIMITED</p>
            <p className="font-bold pt-1">Ms. Puja Agarwal</p>
            <p className="text-slate-600">Contact: 88200 44755 / 96747 55238</p>

            <div className="pt-2 flex items-center space-x-2 text-xs font-bold text-blue-900">
              <span>Enclosed :</span>
              <span className="underline text-blue-600">Annexure-A (Price Bid)</span>
            </div>
          </div>
        </div>

        {/* Explicit Hard Page Break Directive for PDF and Print */}
        <div className="html2pdf__page-break page-break-before" style={{ pageBreakBefore: 'always', breakBefore: 'page' }} />

        {/* Annexure A Section (Guaranteed to start on Page 2) */}
        <div className="space-y-4 pt-2">
          <div className="annexure-banner bg-[#0284c7] text-white p-2.5 text-center font-extrabold text-sm uppercase tracking-wider rounded-xs border border-blue-400 box-border w-full">
            Annexure–A (Price Bid)
          </div>

          <table className="w-full table-fixed text-left border-collapse border border-blue-400 text-xs">
            <thead className="bg-[#e0f2fe] text-blue-900 font-extrabold border-b border-blue-400 text-[11px] uppercase">
              <tr>
                <th className="p-2 border border-blue-400 text-center w-[5%] leading-tight font-extrabold">SL NO</th>
                <th className="p-2 border border-blue-400 text-left w-[33%] leading-tight font-extrabold">PARTY ITEM NAME</th>
                <th className="p-2 border border-blue-400 text-left w-[20%] leading-tight font-extrabold">OUR ITEM NAME</th>
                <th className="p-2 border border-blue-400 text-center w-[8%] leading-tight font-extrabold">QTY</th>
                <th className="p-2 border border-blue-400 text-center w-[7%] leading-tight font-extrabold">UNIT</th>
                <th className="p-2 border border-blue-400 text-center w-[12%] leading-tight font-extrabold">RATE/UNIT</th>
                <th className="p-2 border border-blue-400 text-center w-[15%] leading-tight font-extrabold">UNIT OF QUOTATION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-200 font-medium">
              {items.length === 0 ? (
                <tr className="keep-together">
                  <td colSpan={7} className="p-6 text-center text-slate-500 font-semibold">
                    No quotation items listed under offer #{docket.docketNoQtnNo}.
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <tr key={item.id} className="keep-together hover:bg-slate-50">
                    <td className="p-2.5 border border-blue-300 text-center font-bold">{idx + 1}</td>
                    <td className="p-2.5 border border-blue-300 text-left font-semibold leading-snug break-words">{item.itemNameParty || '-'}</td>
                    <td className="p-2.5 border border-blue-300 text-left text-blue-900 font-bold break-words">{item.ourItemName || '-'}</td>
                    <td className="p-2.5 border border-blue-300 text-center font-extrabold">{item.qty || '-'}</td>
                    <td className="p-2.5 border border-blue-300 text-center">{item.uom || '-'}</td>
                    <td className="p-2.5 border border-blue-300 text-center font-extrabold">{item.price || '-'}</td>
                    <td className="p-2.5 border border-blue-300 text-center">{item.uomOfQtn || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Document Footer */}
        <div className="pt-4 border-t border-slate-300 flex justify-between items-center text-[10px] text-slate-500 font-mono keep-together">
          <span>Offer Ref: #{docket.docketNoQtnNo || docket.id}</span>
          <span>CEEBUILD Company (P) Ltd.</span>
        </div>
      </div>
    </div>
  );
}
