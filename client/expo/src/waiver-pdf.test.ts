/**
 * The PDF link points at the API, and the download keeps the server's file name.
 */

import { pdfFileName, waiverPdfUrl } from './waiver-pdf';

describe('waiver PDF', () => {
  it('builds the link under the API base', () => {
    expect(waiverPdfUrl('abc_-1', 'https://gameplan.example/api')).toBe('https://gameplan.example/api/teams/waiver-pdf/abc_-1');
  });

  it('reads the file name the API sends', () => {
    expect(pdfFileName('inline; filename="season-release-kid.pdf"')).toBe('season-release-kid.pdf');
    expect(pdfFileName(null)).toBe('waiver.pdf');
  });
});
