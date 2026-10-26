/**
 * A small PDF writer for text documents: headings, paragraphs, and a footer
 * with page numbers, on US Letter pages.
 *
 * It uses the built-in Helvetica fonts, so nothing is embedded and no library
 * is bundled into the Lambda. Text is encoded as WinAnsi, which covers English
 * and Spanish; a character outside it prints as `?`.
 */

/** One run of text. Paragraphs wrap to the page width; a newline starts a new line. */
export type PdfBlock = {
  text: string;
  bold?: boolean;
  /** Font size in points. */
  size?: number;
  /** Space above, in points. */
  gapBefore?: number;
  /** Gray instead of black. */
  muted?: boolean;
  /** Draws a rule above the block. */
  ruleBefore?: boolean;
};

/** Document metadata and content. */
export type PdfDocument = {
  title: string;
  blocks: readonly PdfBlock[];
  /** Printed at the bottom of every page, before the page number. */
  footer?: string;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const FOOTER_SIZE = 8;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const DEFAULT_SIZE = 11;
const LINE_SPACING = 1.35;

/** Helvetica advance widths for ASCII 32–126, in 1/1000 em. */
const REGULAR_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

/** Helvetica-Bold advance widths for ASCII 32–126, in 1/1000 em. */
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

/** Width used for accented letters and symbols outside ASCII; on the wide side so lines never overrun. */
const WIDE_FALLBACK = 667;

/** WinAnsi bytes for the characters it adds beyond Latin-1. */
const WIN_ANSI_EXTRAS: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * Maps text to WinAnsi bytes, one character per byte, as a latin1 string.
 *
 * @param text - Any text.
 * @returns The encodable text; anything else becomes `?`.
 */
export const toWinAnsi = (text: string): string =>
  [...text.normalize('NFC')]
    .map((char) => {
      const code = char.codePointAt(0) ?? 63;
      if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) return char;
      const extra = WIN_ANSI_EXTRAS[char];
      return extra === undefined ? '?' : String.fromCharCode(extra);
    })
    .join('');

/**
 * Width of WinAnsi text in points.
 *
 * @param text - Text from {@link toWinAnsi}.
 * @param size - Font size.
 * @param bold - Whether it is set in bold.
 * @returns The advance width.
 */
const textWidth = (text: string, size: number, bold: boolean): number => {
  const widths = bold ? BOLD_WIDTHS : REGULAR_WIDTHS;
  let total = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    total += code >= 32 && code <= 126 ? (widths[code - 32] ?? WIDE_FALLBACK) : WIDE_FALLBACK;
  }
  return (total * size) / 1000;
};

/**
 * Breaks one paragraph into lines that fit the text width. A word longer than
 * a line is split.
 *
 * @param paragraph - WinAnsi text with no newlines.
 * @param size - Font size.
 * @param bold - Whether it is set in bold.
 * @returns The lines; an empty paragraph is one empty line.
 */
export const wrapParagraph = (paragraph: string, size: number, bold: boolean): string[] => {
  const words = paragraph.split(/ +/u).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  const push = (word: string): void => {
    let rest = word;
    while (textWidth(rest, size, bold) > TEXT_WIDTH) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > TEXT_WIDTH) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (textWidth(candidate, size, bold) <= TEXT_WIDTH) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    push(word);
  }
  lines.push(line);
  return lines;
};

/**
 * Escapes text for a PDF literal string.
 *
 * @param text - WinAnsi text.
 * @returns The text with `\`, `(`, and `)` escaped.
 */
const escapePdf = (text: string): string => text.replace(/[\\()]/gu, (char) => `\\${char}`);

/** One placed line of text on a page. */
type PlacedLine = { text: string; x: number; y: number; size: number; bold: boolean; muted: boolean };

/** One rule across the text width. */
type PlacedRule = { y: number };

type Page = { lines: PlacedLine[]; rules: PlacedRule[] };

/**
 * Lays blocks out on pages, top to bottom.
 *
 * @param blocks - The document content.
 * @returns Pages with every line placed.
 */
const layout = (blocks: readonly PdfBlock[]): Page[] => {
  const pages: Page[] = [{ lines: [], rules: [] }];
  const bottom = MARGIN + FOOTER_SIZE * 3;
  let y = PAGE_HEIGHT - MARGIN;
  const current = (): Page => pages[pages.length - 1] as Page;
  const newPage = (): void => {
    pages.push({ lines: [], rules: [] });
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const block of blocks) {
    const size = block.size ?? DEFAULT_SIZE;
    const bold = block.bold === true;
    const leading = size * LINE_SPACING;
    y -= block.gapBefore ?? 0;
    if (block.ruleBefore === true) {
      if (y - leading < bottom) newPage();
      current().rules.push({ y: y + 2 });
      y -= 8;
    }
    // Split before encoding: a newline is not printable WinAnsi and would become `?`.
    const paragraphs = block.text
      .replace(/\r\n?/gu, '\n')
      .replace(/\t/gu, '    ')
      .split('\n')
      .map(toWinAnsi);
    for (const paragraph of paragraphs) {
      for (const text of wrapParagraph(paragraph, size, bold)) {
        if (y - size < bottom) newPage();
        y -= size;
        current().lines.push({ text, x: MARGIN, y, size, bold, muted: block.muted === true });
        y -= leading - size;
      }
    }
  }
  return pages;
};

/**
 * The content stream for one page.
 *
 * @param page - The placed lines and rules.
 * @param footer - Footer text, already WinAnsi.
 * @returns PDF drawing operators.
 */
const pageContent = (page: Page, footer: string): string => {
  const ops: string[] = [];
  for (const rule of page.rules) {
    ops.push(`0.75 G 0.5 w ${MARGIN} ${rule.y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${rule.y.toFixed(2)} l S`);
  }
  for (const line of page.lines) {
    if (line.text.length === 0) continue;
    ops.push(
      `BT ${line.muted ? '0.4 g' : '0 g'} /${line.bold ? 'F2' : 'F1'} ${line.size} Tf ${line.x} ${line.y.toFixed(2)} Td (${escapePdf(line.text)}) Tj ET`,
    );
  }
  ops.push(`BT 0.4 g /F1 ${FOOTER_SIZE} Tf ${MARGIN} ${MARGIN} Td (${escapePdf(footer)}) Tj ET`);
  return ops.join('\n');
};

/**
 * Formats a date the way a PDF `Info` dictionary expects.
 *
 * @param date - The time.
 * @returns `D:YYYYMMDDHHmmSSZ`.
 */
const pdfDate = (date: Date): string => `D:${date.toISOString().replace(/[-:T]/gu, '').slice(0, 14)}Z`;

/**
 * Renders a text document as a PDF file.
 *
 * @param doc - Title, blocks, and an optional footer.
 * @param now - The creation time recorded in the file.
 * @returns The PDF bytes.
 */
export const renderPdf = (doc: PdfDocument, now: Date = new Date()): Buffer => {
  const pages = layout(doc.blocks);
  const footerText = toWinAnsi(doc.footer ?? '');
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add('');
  const pagesId = add('');
  const regularId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = pages.map((page, index) => {
    const label = `${footerText}${footerText.length > 0 ? '    ' : ''}Page ${index + 1} of ${pages.length}`;
    const content = pageContent(page, label);
    const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const infoId = add(
    `<< /Title (${escapePdf(toWinAnsi(doc.title))}) /Producer (GamePlan) /CreationDate (${pdfDate(now)}) >>`,
  );

  let file = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(file, 'latin1'));
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(file, 'latin1');
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(file, 'latin1');
};
