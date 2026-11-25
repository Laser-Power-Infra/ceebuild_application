// Drawing primitives for the fabrication-drawing PDF (pdf-lib). Coordinates are mm on the sheet,
// origin bottom-left (PDF convention). Standard Helvetica only (no font files: works in the
// standalone Docker build); text outside WinAnsi is replaced, so drawing never throws on a glyph.

import { degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

export const MM = 72 / 25.4;
export const A3_LANDSCAPE: [number, number] = [420, 297];
export const BLACK = rgb(0, 0, 0);
export const GREY = rgb(0.45, 0.45, 0.45);
export const LIGHT = rgb(0.85, 0.85, 0.85);
export const RED = rgb(0.75, 0.1, 0.1);

// WinAnsi (Windows-1252) characters above 0x7E that Helvetica can show.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = { '≥': '>=', '≤': '<=', '✓': 'OK', '→': '->', '←': '<-', '≈': '~', '\t': ' ' };

/** Text Helvetica (WinAnsi) can encode: known symbols mapped, others "?". */
export function safeText(s: string): string {
  let out = '';
  for (const ch of String(s)) {
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else {
      const c = ch.codePointAt(0)!;
      out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch) ? ch : c === 0x0a ? ' ' : '?';
    }
  }
  return out;
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: 'left' | 'center' | 'right';
  /** Shrink (down to 4.5 pt) then cut with "..." to fit this width (mm). */
  maxWidth?: number;
  rotate90?: boolean;
}

/** One sheet: mm drawing helpers over a pdf-lib page. */
export class Sheet {
  constructor(
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {}

  textWidth(s: string, size: number, bold = false) {
    return (bold ? this.bold : this.font).widthOfTextAtSize(safeText(s), size) / MM;
  }

  text(s: string, x: number, y: number, o: TextOpts = {}) {
    if (!s) return;
    const f = o.bold ? this.bold : this.font;
    let size = o.size ?? 8;
    let t = safeText(s);
    if (o.maxWidth) {
      while (size > 4.5 && f.widthOfTextAtSize(t, size) / MM > o.maxWidth) size -= 0.25;
      if (f.widthOfTextAtSize(t, size) / MM > o.maxWidth) {
        while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) / MM > o.maxWidth) t = t.slice(0, -1);
        t = `${t}...`;
      }
    }
    const w = f.widthOfTextAtSize(t, size) / MM;
    const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
    if (o.rotate90) {
      this.page.drawText(t, { x: x * MM, y: (y + dx) * MM, size, font: f, color: o.color ?? BLACK, rotate: degrees(90) });
    } else {
      this.page.drawText(t, { x: (x + dx) * MM, y: y * MM, size, font: f, color: o.color ?? BLACK });
    }
  }

  /** Word-wrapped paragraph; returns the y below the last line. */
  para(s: string, x: number, y: number, width: number, o: { size?: number; bold?: boolean; lead?: number; color?: RGB; indent?: number } = {}) {
    const size = o.size ?? 8;
    const lead = o.lead ?? size * 0.45;
    const words = safeText(s).split(/\s+/).filter(Boolean);
    let line = '';
    let first = true;
    const flush = () => {
      const ix = first ? 0 : (o.indent ?? 0);
      this.text(line, x + ix, y, { size, bold: o.bold, color: o.color });
      y -= lead;
      line = '';
      first = false;
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      const ix = first ? 0 : (o.indent ?? 0);
      if (line && this.textWidth(next, size, o.bold) > width - ix) flush();
      line = line ? `${line} ${w}` : w;
    }
    if (line) flush();
    return y;
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { w?: number; color?: RGB; dash?: number[] } = {}) {
    this.page.drawLine({
      start: { x: x1 * MM, y: y1 * MM },
      end: { x: x2 * MM, y: y2 * MM },
      thickness: (o.w ?? 0.25) * MM,
      color: o.color ?? BLACK,
      dashArray: o.dash?.map((d) => d * MM),
    });
  }

  rect(x: number, y: number, w: number, h: number, o: { w?: number; fill?: RGB; stroke?: RGB | null } = {}) {
    this.page.drawRectangle({
      x: x * MM,
      y: y * MM,
      width: w * MM,
      height: h * MM,
      borderWidth: o.stroke === null ? 0 : (o.w ?? 0.25) * MM,
      borderColor: o.stroke === null ? undefined : (o.stroke ?? BLACK),
      color: o.fill,
    });
  }

  circle(x: number, y: number, r: number, o: { w?: number; fill?: RGB } = {}) {
    this.page.drawCircle({ x: x * MM, y: y * MM, size: r * MM, borderWidth: (o.w ?? 0.25) * MM, borderColor: BLACK, color: o.fill ?? rgb(1, 1, 1) });
  }

  /** Closed polygon (mm points). */
  poly(pts: [number, number][], o: { w?: number; fill?: RGB } = {}) {
    // drawSvgPath: SVG y grows downwards from the given origin, so flip y.
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${(x * MM).toFixed(2)} ${(-y * MM).toFixed(2)}`).join(' ') + ' Z';
    this.page.drawSvgPath(d, { x: 0, y: 0, borderWidth: (o.w ?? 0.25) * MM, borderColor: BLACK, color: o.fill });
  }

  /** Arrow head at (x, y) pointing in direction (dx, dy). */
  arrow(x: number, y: number, dx: number, dy: number, len = 2) {
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const bx = x - ux * len;
    const by = y - uy * len;
    const px = -uy * len * 0.3;
    const py = ux * len * 0.3;
    this.poly([[x, y], [bx + px, by + py], [bx - px, by - py]], { w: 0.1, fill: BLACK });
  }

  /** Horizontal dimension between x1 and x2 at height y, with extension lines from yFrom. */
  dimH(x1: number, x2: number, y: number, label: string, yFrom?: number, size = 7) {
    if (yFrom !== undefined) {
      const dir = y < yFrom ? -1 : 1;
      this.line(x1, yFrom + dir, x1, y + dir * 1.5, { w: 0.15 });
      this.line(x2, yFrom + dir, x2, y + dir * 1.5, { w: 0.15 });
    }
    this.line(x1, y, x2, y, { w: 0.18 });
    const len = Math.min(2, Math.abs(x2 - x1) / 3);
    this.arrow(x1, y, x1 - x2, 0, len);
    this.arrow(x2, y, x2 - x1, 0, len);
    this.text(label, (x1 + x2) / 2, y + 1, { size, align: 'center' });
  }

  /** Vertical dimension between y1 and y2 at x. */
  dimV(y1: number, y2: number, x: number, label: string, size = 7) {
    this.line(x, y1, x, y2, { w: 0.18 });
    const len = Math.min(2, Math.abs(y2 - y1) / 3);
    this.arrow(x, y1, 0, y1 - y2, len);
    this.arrow(x, y2, 0, y2 - y1, len);
    this.text(label, x - 1, (y1 + y2) / 2, { size, align: 'center', rotate90: true });
  }

  /** Simple table: columns (title, width mm, align); returns the y below the last row. */
  /** A row with a single cell spans the full width (section heading). */
  table(x: number, yTop: number, cols: { title: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: { cells: string[]; bold?: boolean; fill?: RGB }[], rowH = 6, size = 7.5) {
    const width = cols.reduce((a, c) => a + c.w, 0);
    const pad = 1.2;
    const ty = (y: number) => y - rowH + rowH * 0.32;
    const drawRow = (cells: string[], y: number, bold: boolean, fill?: RGB) => {
      if (fill) this.rect(x, y - rowH, width, rowH, { fill, stroke: null });
      if (cells.length === 1) {
        this.text(cells[0], x + pad, ty(y), { size, bold, maxWidth: width - 2 * pad });
      } else {
        let cx = x;
        cols.forEach((c, i) => {
          const tx = c.align === 'right' ? cx + c.w - pad : c.align === 'center' ? cx + c.w / 2 : cx + pad;
          this.text(cells[i] ?? '', tx, ty(y), { size, bold, align: c.align ?? 'left', maxWidth: c.w - 2 * pad });
          cx += c.w;
          if (i < cols.length - 1) this.line(cx, y, cx, y - rowH, { w: 0.15 });
        });
      }
      this.line(x, y - rowH, x + width, y - rowH, { w: 0.15 });
    };
    this.line(x, yTop, x + width, yTop, { w: 0.3 });
    drawRow(cols.map((c) => c.title), yTop, true, LIGHT);
    let y = yTop - rowH;
    for (const r of rows) {
      drawRow(r.cells, y, !!r.bold, r.fill);
      y -= rowH;
    }
    this.line(x, yTop, x, y, { w: 0.3 });
    this.line(x + width, yTop, x + width, y, { w: 0.3 });
    this.line(x, y, x + width, y, { w: 0.3 });
    return y;
  }
}
