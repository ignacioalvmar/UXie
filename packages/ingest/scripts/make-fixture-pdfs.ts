/**
 * Builds the synthetic fixture PDFs used by ingestion tests and `pnpm uxie ingest --local`
 * (PRD §13.5, ADR-017, ADR-021). Run: `pnpm --filter @uxie/ingest fixtures:pdf`.
 *
 * - visible-cues/source.pdf: the visible-cues pages.json typeset one PDF page per page, with a
 *   running header and a page-number footer that extraction must strip.
 * - scanned-page/source.pdf: a short synthetic paper whose page 3 is figure-only (vector
 *   drawing, no text layer beyond a caption), which must raise a `scanned_or_figure_only` warning.
 * - injected/source.pdf: a synthetic paper whose page 3 embeds an instruction aimed at AI tutors,
 *   for the doc-injection eval profile (PRD §13.1).
 *
 * Output is deterministic (fixed dates, no random ids), so re-running produces identical files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const root = resolve(import.meta.dirname, "../../../fixtures/papers");
const FIXED_DATE = new Date("2026-10-03T00:00:00Z");
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 64;
const SIZE = 10;
const LEADING = 13.5;

/** Standard PDF fonts only encode WinAnsi; replace anything else. */
function sanitize(text: string, font: PDFFont): string {
  const map: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "−": "-", "×": "x" };
  return [...text]
    .map((ch) => {
      if (ch === "\n") return ch;
      const c = map[ch] ?? ch;
      try {
        font.encodeText(c);
        return c;
      } catch {
        return "?";
      }
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

interface Chrome {
  header: string;
  pageNo: number;
}

function drawChrome(page: PDFPage, font: PDFFont, c: Chrome) {
  const [w, h] = A4;
  page.drawText(c.header, { x: MARGIN, y: h - 36, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  const footer = `Page ${c.pageNo}`;
  page.drawText(footer, {
    x: (w - font.widthOfTextAtSize(footer, 8)) / 2,
    y: 30,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

function drawBody(page: PDFPage, font: PDFFont, text: string) {
  const [w, h] = A4;
  let y = h - MARGIN - 10;
  for (const line of wrap(sanitize(text, font), font, SIZE, w - 2 * MARGIN)) {
    if (y < MARGIN) throw new Error(`Text overflows the page: "${line.slice(0, 40)}…"`);
    if (line) page.drawText(line, { x: MARGIN, y, size: SIZE, font });
    y -= LEADING;
  }
}

async function newDoc(title: string, authors: string[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(authors.join("; "));
  doc.setCreator("UXie fixture generator");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica) };
}

async function save(doc: PDFDocument, path: string) {
  writeFileSync(path, await doc.save({ useObjectStreams: false }));
  console.log(`wrote ${path}`);
}

/** Typeset a hand-written `pages.json` one PDF page per page. */
async function fromPagesJson(slug: string, header: string) {
  const dir = resolve(root, slug);
  const src = JSON.parse(readFileSync(resolve(dir, "pages.json"), "utf8")) as {
    title: string;
    authors: string[];
    pages: { n: number; text: string }[];
  };
  const { doc, font } = await newDoc(src.title, src.authors);
  for (const p of src.pages) {
    const page = doc.addPage(A4);
    drawChrome(page, font, { header, pageNo: p.n });
    drawBody(page, font, p.text);
  }
  await save(doc, resolve(dir, "source.pdf"));
}

const SCANNED_TITLE = "Waiting Out Loud: Progress Feedback in Voice Assistants";
const SCANNED_AUTHORS = ["C. Fixture", "D. Synthetic"];
const SCANNED_PAGES = [
  `${SCANNED_TITLE}
C. Fixture, D. Synthetic. SYNTHETIC TEST PAPER written for the UXie test suite; the study, data and references are fictional.

Abstract
Voice assistants often need several seconds to complete a request, but unlike a screen they cannot show a spinner. We compared three ways of filling that silence in a between-subjects online study (N = 90): silence, a short earcon repeated every two seconds, and a spoken progress phrase ("Still checking your calendar"). Participants rated the spoken phrase as the most transparent, but it also made waits feel longer than the earcon did. Repeated requests ("Hello? Are you there?") were most frequent after silence. We argue that progress feedback in voice interfaces must signal that work is happening without occupying the same channel the user needs for speaking.

1 Introduction
On a screen, designers can show that a system is busy with a spinner, a progress bar or a skeleton layout. Each of these occupies a visual channel the user is not using to give input. A voice assistant has only one channel: sound. Any progress cue competes with the user's own speech and with the answer that is about to arrive. This paper asks how voice interfaces should communicate progress during waits of three to eight seconds.`,
  `2 Related work
Research on graphical interfaces has long recommended feedback for any wait longer than about one second, and progress indicators with an estimate for waits longer than about ten seconds. Fictional prior work by Ortega (2023) found that animated progress bars reduce perceived waiting time compared with static ones. For voice, Lindqvist (2024) reported that users interpret silence of more than two seconds as a failure. Earcons, short non-speech sounds, are cheap to produce and language-independent, but their meaning must be learned. Spoken phrases need no learning but take time to say and can mask the start of the real answer.

3 Method
Ninety adult participants were recruited through an online panel and randomly assigned to one of three conditions (30 each). Each participant made twelve requests to a simulated assistant, such as adding an event or checking the weather. Response delays were fixed at 3, 5 or 8 seconds in a balanced order. In the silence condition nothing played during the delay. In the earcon condition a soft two-tone sound played every two seconds. In the spoken condition the assistant said a short phrase naming the task after two seconds. We logged repeated requests during the delay and asked participants after each request how long the wait felt (in seconds) and how well they understood what the assistant was doing (1-7 scale).`,
  `Figure 2.`,
  `4 Results
Repeated requests occurred in 31% of silent waits, 9% of earcon waits and 4% of spoken waits. Understanding ratings were highest for the spoken phrase (mean 6.1), followed by the earcon (4.8) and silence (2.9). Perceived wait was shortest with the earcon: on average participants overestimated an 8-second wait by 1.2 s with the earcon, by 2.6 s with the spoken phrase and by 3.4 s with silence. Figure 2 summarises the pattern across delay lengths.

5 Discussion and limitations
Spoken phrases explain best but make waits feel longer, perhaps because the user listens to them and counts the time. Earcons keep users from repeating themselves while staying out of the way. A practical design may combine both: one short spoken phrase for waits that are expected to be long, then a quiet earcon. The study used a simulated assistant, a fixed set of tasks, an online sample and only English. We measured perceived time by self-report immediately after each request. Real assistants have variable delays, and users at home may not be paying full attention.

References
Lindqvist, M. (2024). Silence as failure in conversational agents. Fictional Journal of Voice Interaction, 2, 14-29.
Ortega, R. (2023). Animated progress and perceived waiting. Fictional Proceedings on Interface Timing, 101-110.`,
];

async function scannedPage() {
  const dir = resolve(root, "scanned-page");
  const { doc, font } = await newDoc(SCANNED_TITLE, SCANNED_AUTHORS);
  SCANNED_PAGES.forEach((text, i) => {
    const page = doc.addPage(A4);
    drawChrome(page, font, {
      header: "Waiting Out Loud - UXie synthetic test paper",
      pageNo: i + 1,
    });
    if (i === 2) {
      // Figure-only page: a bar chart drawn as vector shapes, no text layer except the caption.
      const base = 300;
      const bars = [
        [31, 0.75],
        [9, 0.55],
        [4, 0.35],
      ] as const;
      bars.forEach(([value, shade], j) => {
        page.drawRectangle({
          x: 150 + j * 110,
          y: base,
          width: 70,
          height: value * 10,
          color: rgb(shade, shade, shade),
        });
      });
      page.drawLine({ start: { x: 120, y: base }, end: { x: 480, y: base }, thickness: 1 });
      page.drawLine({ start: { x: 120, y: base }, end: { x: 120, y: base + 340 }, thickness: 1 });
    }
    drawBody(page, font, text);
  });
  await save(doc, resolve(dir, "source.pdf"));
}

await fromPagesJson("visible-cues", "Visible Cues - UXie synthetic test paper");
await scannedPage();
await fromPagesJson("injected", "Blame-Free Errors - UXie synthetic test paper");
